import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  ensureSchema,
  insertShipment,
  listShipments,
  type Exec,
  type Row
} from "../src/db.ts";
import { validateShipment } from "../src/shipments.ts";

// Same Exec contract as the agent's ctx.storage.sql wrapper, backed by node:sqlite.
const memoryDb = (): Exec => {
  const db = new DatabaseSync(":memory:");
  // node:sqlite rows have a null prototype; copy them so deepEqual compares plain objects.
  return (query, ...bindings) =>
    db
      .prepare(query)
      .all(...bindings)
      .map((r) => ({ ...r }) as Row);
};

const NOW = new Date("2026-10-15T08:00:00Z");

const shipment = () => {
  const r = validateShipment(
    {
      site: "Lisbon",
      partner: "FastFreight",
      direction: "inbound_replacement",
      eta_window_start: "2026-10-16T09:00:00Z",
      eta_window_end: "2026-10-16T12:00:00Z",
      rma_ref: "rma-889",
      items: [
        { part_number: "PSU", serial_number: "A123" },
        { part_number: "PSU", serial_number: "A124" },
        { part_number: "F-200", qty: 4, description: "Chassis fan" }
      ]
    },
    NOW
  );
  assert.ok(r.ok);
  return r.value;
};

test("schema creates the six spec tables plus the kaizen log, idempotently", () => {
  const exec = memoryDb();
  ensureSchema(exec);
  ensureSchema(exec);
  const tables = exec(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
  ).map((r) => r.name);
  assert.deepEqual(tables, [
    "access_codes",
    "exceptions",
    "kaizen_log",
    "lg_docs",
    "lg_jobs",
    "lg_reviews",
    "lg_tasks",
    "outbox",
    "receipts",
    "replenishment_orders",
    "settings",
    "shipment_items",
    "shipments"
  ]);
});

test("insert then list round-trips a shipment with its manifest", () => {
  const exec = memoryDb();
  ensureSchema(exec);
  const id = insertShipment(exec, shipment(), NOW);
  assert.equal(id, 1);
  assert.equal(insertShipment(exec, shipment(), NOW), 2);

  const [latest, first] = listShipments(exec);
  assert.equal(latest.id, 2);
  assert.equal(first.status, "booked");
  assert.equal(first.rma_ref, "RMA-889");
  assert.equal(first.site, "LIS-01");
  assert.equal(first.partner_contact, "dispatch@fastfreight.example");
  assert.equal(first.created_at, NOW.toISOString());
  assert.deepEqual(first.items, [
    { part_number: "PSU", serial_number: "A123", description: null, qty: 1 },
    { part_number: "PSU", serial_number: "A124", description: null, qty: 1 },
    {
      part_number: "F-200",
      serial_number: null,
      description: "Chassis fan",
      qty: 4
    }
  ]);
});

test("database rejects values the spec does not allow", () => {
  const exec = memoryDb();
  ensureSchema(exec);
  insertShipment(exec, shipment(), NOW);
  assert.throws(() =>
    exec(`UPDATE shipments SET direction = 'sideways' WHERE id = 1`)
  );
  assert.throws(() =>
    exec(
      `INSERT INTO shipment_items (shipment_id, part_number, qty) VALUES (1, 'F-200', 0)`
    )
  );
});
