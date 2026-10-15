import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  ensureSchema,
  getShipment,
  insertShipment,
  listOutbox,
  type Exec,
  type Row
} from "../src/db.ts";
import {
  changeException,
  checkEntryCode,
  exceptionsView,
  followUpOverdue,
  handleNoShow,
  issueEntryCode,
  lifecyclePlan,
  reconcileShipment,
  recordDelivery,
  revokeEntryCode,
  type Ctx
} from "../src/lifecycle.ts";
import { validateShipment, type ShipmentInput } from "../src/shipments.ts";

const HOUR = 1000; // one spec hour = 1s of fake time

function setup() {
  const db = new DatabaseSync(":memory:");
  const exec: Exec = (q, ...b) =>
    db
      .prepare(q)
      .all(...b)
      .map((r) => ({ ...r }) as Row);
  ensureSchema(exec);
  let clock = new Date("2026-10-16T08:00:00Z").getTime();
  const codes = new Map<number, string>();
  const ctx: Ctx = {
    exec,
    now: () => new Date(clock),
    hourMs: HOUR,
    pepper: "test-pepper",
    onCodeIssued: (id, code) => codes.set(id, code)
  };
  const at = (isoTime: string) => (clock = new Date(isoTime).getTime());
  const advance = (ms: number) => (clock += ms);
  const log = (input: ShipmentInput) => {
    const v = validateShipment(input, ctx.now());
    assert.ok(v.ok, JSON.stringify(v));
    return insertShipment(exec, v.value, ctx.now());
  };
  return { ctx, exec, codes, at, advance, log };
}

const demoShipment: ShipmentInput = {
  site: "LIS-01",
  partner: "FastFreight",
  direction: "inbound_replacement",
  eta_window_start: "2026-10-16T09:00:00Z",
  eta_window_end: "2026-10-16T12:00:00Z",
  items: [
    { part_number: "PSU", serial_number: "A123" },
    { part_number: "PSU", serial_number: "A124" },
    { part_number: "F-200", qty: 4, description: "fan" }
  ]
};

test("spec demo: code issued, delivery reconciled, exceptions opened, escalated, resolved", async () => {
  const { ctx, exec, codes, advance, log } = setup();
  const id = log(demoShipment);

  // Code goes out 12 spec-hours before the window.
  assert.deepEqual(lifecyclePlan(ctx, id), {
    codeIssueAt: new Date(
      new Date("2026-10-16T09:00:00Z").getTime() - 12 * HOUR
    ).toISOString(),
    windowEnd: "2026-10-16T12:00:00.000Z"
  });
  const issued = await issueEntryCode(ctx, id);
  assert.equal(issued.issued, true);
  assert.equal(
    JSON.stringify(issued).includes(codes.get(id)!),
    false,
    "result must not contain the code"
  );
  assert.equal(
    (await issueEntryCode(ctx, id)).issued,
    false,
    "only one live code per delivery"
  );

  const [codeMsg] = listOutbox(exec);
  assert.equal(codeMsg.to, "dispatch@fastfreight.example");
  assert.equal(
    String(codeMsg.body).includes(codes.get(id)!),
    false,
    "outbox must not store the code"
  );
  assert.equal(
    exec(`SELECT code_hash FROM access_codes`)[0].code_hash === codes.get(id),
    false,
    "only the hash is stored"
  );
  assert.equal(getShipment(exec, id)!.status, "code_issued");

  // "FastFreight delivered to LIS-01: A123 ok, A124 damaged, 3 fans."
  const delivered = recordDelivery(ctx, {
    site: "LIS-01",
    partner: "FastFreight",
    items: [
      { serial_number: "A123" },
      { serial_number: "A124", condition: "damaged" },
      { part_number: "fans", qty: 3 }
    ]
  });
  assert.ok(delivered.ok && delivered.shipmentId === id);

  const rec = reconcileShipment(ctx, id);
  assert.equal(rec.exceptions, 2);
  assert.equal(getShipment(exec, id)!.status, "exceptions_open");
  assert.equal(exec(`SELECT status FROM access_codes`)[0].status, "used");

  const open = exceptionsView(ctx);
  assert.deepEqual(open.map((e) => e.type).sort(), [
    "DAMAGED_IN_TRANSIT",
    "QTY_VARIANCE"
  ]);
  assert.equal(open[0].severity, "high", "sorted by severity first");
  assert.equal(open[0].owner, "FastFreight Couriers");

  // Follow-up before the SLA flags nothing; after the 24h high SLA it escalates the damage only.
  assert.equal(followUpOverdue(ctx, id).flagged, 0);
  advance(25 * HOUR);
  const follow = followUpOverdue(ctx, id);
  assert.equal(follow.flagged, 1);
  assert.match(
    String(listOutbox(exec)[0].subject),
    /Overdue: exception #\d+ \(DAMAGED_IN_TRANSIT\)/
  );
  assert.equal(
    followUpOverdue(ctx, id).flagged,
    0,
    "never flags the same exception twice"
  );
  assert.equal(
    exceptionsView(ctx).find((e) => e.type === "DAMAGED_IN_TRANSIT")!.overdue,
    true
  );

  // Resolving needs a note; the shipment closes when the last one is resolved.
  const [first, second] = open.map((e) => Number(e.id));
  assert.equal(changeException(ctx, first, "resolved", null).ok, false);
  assert.ok(
    changeException(ctx, first, "resolved", "Replacement shipped under RMA-889")
      .ok
  );
  assert.equal(getShipment(exec, id)!.status, "exceptions_open");
  assert.ok(
    changeException(ctx, second, "resolved", "Partner credited 1 fan").ok
  );
  assert.equal(getShipment(exec, id)!.status, "closed");
  assert.equal(exceptionsView(ctx).length, 0);
});

test("clean delivery closes the shipment with no exceptions", async () => {
  const { ctx, exec, log } = setup();
  const id = log(demoShipment);
  await issueEntryCode(ctx, id);
  recordDelivery(ctx, {
    shipment_id: id,
    items: [
      { serial_number: "A123" },
      { serial_number: "A124" },
      { part_number: "F-200", qty: 4 }
    ]
  });
  assert.deepEqual(reconcileShipment(ctx, id), {
    reconciled: true,
    matched: 3,
    exceptions: 0,
    nextDue: null
  });
  assert.equal(getShipment(exec, id)!.status, "closed");
});

test("no-show: MISSED_DELIVERY, code expired; a late delivery report is refused", async () => {
  const { ctx, exec, log, at } = setup();
  const id = log(demoShipment);
  await issueEntryCode(ctx, id);
  at("2026-10-16T12:00:01Z");
  const r = handleNoShow(ctx, id);
  assert.equal(r.missed, true);
  assert.equal(getShipment(exec, id)!.status, "missed");
  assert.equal(exec(`SELECT status FROM access_codes`)[0].status, "expired");
  assert.deepEqual(
    exceptionsView(ctx).map((e) => e.type),
    ["MISSED_DELIVERY"]
  );
  assert.equal(
    recordDelivery(ctx, { shipment_id: id, items: [{ serial_number: "A123" }] })
      .ok,
    false
  );
});

test("no-show check after a delivery was already recorded does nothing", async () => {
  const { ctx, log } = setup();
  const id = log(demoShipment);
  recordDelivery(ctx, { shipment_id: id, items: [{ serial_number: "A123" }] });
  assert.equal(handleNoShow(ctx, id).missed, false);
});

test("check-code endpoint logic: valid once in window, then violations are logged", async () => {
  const { ctx, codes, log, at } = setup();
  const id = log(demoShipment);
  await issueEntryCode(ctx, id);
  const code = codes.get(id)!;

  at("2026-10-16T08:30:00Z");
  assert.deepEqual(await checkEntryCode(ctx, id, code), {
    valid: false,
    reason: "Code used outside its delivery window.",
    violation: true
  });
  at("2026-10-16T10:00:00Z");
  assert.equal((await checkEntryCode(ctx, id, "00000000")).valid, false);
  assert.deepEqual(await checkEntryCode(ctx, id, code), { valid: true });
  assert.equal(
    (await checkEntryCode(ctx, id, code)).valid,
    false,
    "single use"
  );

  const violations = exceptionsView(ctx).filter(
    (e) => e.type === "ACCESS_VIOLATION"
  );
  assert.equal(
    violations.length,
    2,
    "early use + reuse; a wrong code is not a violation"
  );
  assert.equal(violations[0].severity, "critical");
});

test("revoked code is rejected and logged", async () => {
  const { ctx, codes, log, at } = setup();
  const id = log(demoShipment);
  await issueEntryCode(ctx, id);
  assert.equal(revokeEntryCode(ctx, id).revoked, true);
  assert.equal(
    revokeEntryCode(ctx, id).revoked,
    false,
    "nothing left to revoke"
  );
  at("2026-10-16T10:00:00Z");
  const r = await checkEntryCode(ctx, id, codes.get(id)!);
  assert.ok(!r.valid && /revoked/.test(r.reason));
  assert.equal(exceptionsView(ctx)[0].type, "ACCESS_VIOLATION");
});
