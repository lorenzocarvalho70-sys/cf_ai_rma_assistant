import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findPartner,
  findSite,
  validateShipment,
  type ShipmentInput
} from "../src/shipments.ts";

const NOW = new Date("2026-10-15T08:00:00Z");

// The spec's demo request: 2 PSUs A123/A124 plus 4 fans F-200 to LIS-01.
const demo = (): ShipmentInput => ({
  site: "LIS-01",
  partner: "FastFreight",
  direction: "inbound_replacement",
  eta_window_start: "2026-10-16T09:00:00Z",
  eta_window_end: "2026-10-16T12:00:00Z",
  items: [
    { part_number: "psu", serial_number: "a123", qty: 1 },
    { part_number: "PSU", serial_number: "A124" },
    { part_number: "F-200", qty: 4 }
  ]
});

const errorsOf = (input: ShipmentInput) => {
  const r = validateShipment(input, NOW);
  assert.equal(r.ok, false);
  return r.ok ? [] : r.errors;
};

test("valid demo shipment is normalised", () => {
  const r = validateShipment(demo(), NOW);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.site, "LIS-01");
  assert.equal(r.value.partner, "FastFreight Couriers");
  assert.equal(r.value.partner_contact, "dispatch@fastfreight.example");
  assert.equal(r.value.eta_window_start, "2026-10-16T09:00:00.000Z");
  assert.deepEqual(r.value.items, [
    { part_number: "PSU", serial_number: "A123", description: null, qty: 1 },
    { part_number: "PSU", serial_number: "A124", description: null, qty: 1 },
    { part_number: "F-200", serial_number: null, description: null, qty: 4 }
  ]);
});

test("site matches by code, city or both", () => {
  assert.equal(findSite("lis01")?.code, "LIS-01");
  assert.equal(findSite("Lisbon")?.code, "LIS-01");
  assert.equal(findSite("LIS-01 Lisbon")?.code, "LIS-01");
  assert.equal(findSite("MAD-09"), undefined);
  assert.equal(findSite(""), undefined);
});

test("partner matches by prefix, not by an empty string", () => {
  assert.equal(findPartner("fastfreight")?.name, "FastFreight Couriers");
  assert.equal(findPartner("Nimbus")?.name, "Nimbus Logistics");
  assert.equal(findPartner("ACME Freight"), undefined);
  assert.equal(findPartner(""), undefined);
});

test("unknown site and partner are rejected with the known lists", () => {
  const errors = errorsOf({ ...demo(), site: "MAD-09", partner: "ACME" });
  assert.match(errors[0], /Unknown site "MAD-09".*LIS-01 Lisbon/);
  assert.match(errors[1], /Unknown partner "ACME".*FastFreight Couriers/);
});

test("explicit partner contact overrides the directory but must be an email", () => {
  const r = validateShipment(
    { ...demo(), partner_contact: "night-desk@fastfreight.example" },
    NOW
  );
  assert.ok(
    r.ok && r.value.partner_contact === "night-desk@fastfreight.example"
  );
  assert.match(
    errorsOf({ ...demo(), partner_contact: "call Bob" })[0],
    /not an email/
  );
});

test("window must parse, end after start, and not be over", () => {
  assert.match(
    errorsOf({ ...demo(), eta_window_start: "tomorrow 9am" })[0],
    /not a valid date/
  );
  assert.match(
    errorsOf({ ...demo(), eta_window_end: "2026-10-16T08:00:00Z" })[0],
    /end must be after window start/
  );
  assert.match(
    errorsOf({
      ...demo(),
      eta_window_start: "2026-10-14T09:00:00Z",
      eta_window_end: "2026-10-14T12:00:00Z"
    })[0],
    /already ended/
  );
});

test("serialised items: one per serial, qty 1, no duplicates", () => {
  const several = errorsOf({
    ...demo(),
    items: [{ part_number: "PSU", serial_number: "A123, A124", qty: 2 }]
  });
  assert.ok(several.some((e) => /several serials/.test(e)));
  assert.ok(several.some((e) => /must have qty 1/.test(e)));

  const dupes = errorsOf({
    ...demo(),
    items: [
      { part_number: "PSU", serial_number: "A123" },
      { part_number: "PSU", serial_number: "a123" }
    ]
  });
  assert.match(dupes[0], /A123 is listed twice/);
});

test("non-serialised quantities must be whole and positive; manifest not empty", () => {
  assert.match(
    errorsOf({ ...demo(), items: [{ part_number: "F-200", qty: 0 }] })[0],
    /at least 1/
  );
  assert.match(
    errorsOf({ ...demo(), items: [{ part_number: "F-200", qty: 2.5 }] })[0],
    /whole number/
  );
  assert.match(errorsOf({ ...demo(), items: [] })[0], /no items/);
  assert.match(
    errorsOf({ ...demo(), items: [{ part_number: " " }] })[0],
    /missing part number/
  );
});
