import { test } from "node:test";
import assert from "node:assert/strict";
import {
  abcClasses,
  boms,
  buildable,
  CATALOG,
  DEFAULT_POLICY,
  eoq,
  rollupCost,
  safetyStock,
  SERVERS,
  stockPolicy,
  summarise,
  WAREHOUSES,
  zFor
} from "../src/inventory.ts";

const NOW = new Date("2026-10-15T12:00:00Z");
const lines = stockPolicy(DEFAULT_POLICY, [], NOW);
const line = (wh: string, sku: string, ls = lines) =>
  ls.find((l) => l.warehouse === wh && l.sku === sku)!;
const close = (a: number, b: number, tol = 1e-3) =>
  assert.ok(Math.abs(a - b) < tol, `${a} ≉ ${b}`);

test("z for common service levels matches the normal table", () => {
  close(zFor(0.5), 0, 1e-9);
  close(zFor(0.9), 1.2816);
  close(zFor(0.95), 1.6449);
  close(zFor(0.98), 2.0537);
  close(zFor(0.99), 2.3263);
  close(zFor(0.01), -2.3263);
  assert.throws(() => zFor(1));
});

test("EOQ and safety-stock formulas", () => {
  // Textbook: D = 1,000/yr, S = 100, H = 5 → √(2·1000·100/5) = 200.
  close(eoq(1000, 100, 5), 200);
  assert.equal(eoq(1000, 100, 0), 0);
  // z = 2, d = 4/day, σd = 2, L = 9 d, σL = 0 → 2·√(9·4) = 12
  close(safetyStock(2, 4, 2, 9, 0), 12);
  // Lead-time variability adds: + d²σL² = 16·4 = 64 → 2·√(36 + 64) = 20
  close(safetyStock(2, 4, 2, 9, 2), 20);
});

test("every stock line obeys the policy maths", () => {
  for (const l of lines) {
    assert.ok(l.eoq >= 1, `${l.sku} EOQ`);
    assert.ok(l.reorderPoint >= l.safetyStock, `${l.sku} ROP ≥ SS`);
    assert.equal(l.maxStock, l.safetyStock + l.eoq);
    const sku = CATALOG.find((c) => c.sku === l.sku)!;
    assert.equal(l.eoq % sku.pack, 0, `${l.sku} EOQ is a pack multiple`);
    if (l.status === "reorder") {
      assert.ok(l.onHand + l.onOrder <= l.reorderPoint);
      assert.ok(l.suggestedQty >= l.eoq && l.suggestedQty % l.eoq === 0);
      assert.ok(
        l.onHand + l.onOrder + l.suggestedQty > l.reorderPoint,
        "order lifts position above ROP"
      );
    }
    if (l.status === "excess") assert.ok(l.excessUnits > 0);
  }
});

test("planted stock problems show up", () => {
  assert.equal(line("WH-ZAZ", "F-200").status, "reorder"); // fans short at Zaragoza
  assert.equal(line("WH-ZAZ", "PSU").status, "reorder");
  assert.equal(line("WH-SIN", "GPU").status, "excess"); // expensive GPU overhang
  for (const sku of ["DIMM-32", "DIMM-64", "HDD-20T"])
    assert.equal(line("WH-UTR", sku).status, "excess");
  const sin = summarise(lines, DEFAULT_POLICY).find(
    (w) => w.code === "WH-SIN"
  )!;
  assert.ok(sin.excessValue > 500_000);
});

test("higher storage cost shrinks orders of bulky items, not dense ones", () => {
  const dearer = stockPolicy(
    { ...DEFAULT_POLICY, storageCostChangePct: 200 },
    [],
    NOW
  );
  // Rails are mostly storage cost; DIMMs are mostly capital.
  assert.ok(
    line("WH-UTR", "RAIL-KIT", dearer).eoq < line("WH-UTR", "RAIL-KIT").eoq
  );
  assert.equal(
    line("WH-UTR", "DIMM-32", dearer).eoq,
    line("WH-UTR", "DIMM-32").eoq
  );
  assert.ok(line("WH-UTR", "RAIL-KIT").storageShare > 50);
  assert.ok(line("WH-UTR", "DIMM-32").storageShare < 5);
});

test("higher service level raises safety stock", () => {
  const strict = stockPolicy(
    { ...DEFAULT_POLICY, serviceLevel: { A: 0.995, B: 0.99, C: 0.98 } },
    [],
    NOW
  );
  const sum = (ls: typeof lines) => ls.reduce((a, l) => a + l.safetyStock, 0);
  assert.ok(sum(strict) > sum(lines));
  // The shelves don't move when the policy does.
  assert.deepEqual(
    strict.map((l) => l.onHand),
    lines.map((l) => l.onHand)
  );
});

test("replenishment orders count as on order, then as stock once they arrive", () => {
  const before = line("WH-ZAZ", "F-200");
  const order = {
    warehouse: "WH-ZAZ",
    sku: "F-200",
    qty: before.suggestedQty,
    eta: "2026-10-30T00:00:00Z"
  };
  const pending = line(
    "WH-ZAZ",
    "F-200",
    stockPolicy(DEFAULT_POLICY, [order], NOW)
  );
  assert.equal(pending.onOrder, before.suggestedQty);
  assert.equal(pending.onHand, before.onHand);
  assert.notEqual(pending.status, "reorder");
  const arrived = line(
    "WH-ZAZ",
    "F-200",
    stockPolicy(DEFAULT_POLICY, [order], new Date("2026-11-01T00:00:00Z"))
  );
  assert.equal(arrived.onOrder, 0);
  assert.equal(arrived.onHand, before.onHand + before.suggestedQty);
});

test("ABC: servers and GPUs are A items; cables are C", () => {
  const abc = abcClasses();
  for (const s of SERVERS) assert.equal(abc[s.sku], "A");
  assert.equal(abc.GPU, "A");
  assert.equal(abc["CABLE-QSFP"], "C");
});

test("BOM roll-up and buildable units", () => {
  const edge = SERVERS.find((s) => s.sku === "SRV-EDGE-1U")!;
  const manual = edge.bom.reduce(
    (a, l) => a + CATALOG.find((c) => c.sku === l.sku)!.unitCost * l.qty,
    edge.assembly
  );
  assert.equal(rollupCost(edge), manual);
  assert.equal(
    boms()[0].lines.reduce((a, l) => a + l.extended, 0) + boms()[0].assembly,
    boms()[0].cost
  );

  for (const b of buildable(lines)) {
    const server = SERVERS.find((s) => s.sku === b.server)!;
    for (const l of server.bom) {
      assert.ok(
        line(b.warehouse, l.sku).onHand >= b.units * l.qty,
        `${b.warehouse} ${b.server} ${l.sku}`
      );
    }
    const lim = server.bom.find((l) => l.sku === b.limiting)!;
    assert.ok(
      line(b.warehouse, lim.sku).onHand < (b.units + 1) * lim.qty,
      "limiting component blocks one more"
    );
  }
});

test("lean policy costs less than holding today's stock, network-wide", () => {
  const s = summarise(lines, DEFAULT_POLICY);
  assert.equal(s.length, WAREHOUSES.length);
  const holding = s.reduce((a, w) => a + w.holdingCost, 0);
  const lean = s.reduce((a, w) => a + w.leanCost, 0);
  assert.ok(lean < holding * 0.8);
});

test("warehouse health: urgent A/B or many reorders, else meaningful excess, else ok", () => {
  const s = summarise(lines, DEFAULT_POLICY);
  const health = Object.fromEntries(s.map((w) => [w.code, w.health]));
  assert.equal(health["WH-SIN"], "excess"); // €1M GPU overhang, nothing urgent to reorder
  assert.equal(health["WH-ZAZ"], "reorder"); // planted fan / PSU shortage
  assert.ok(
    new Set(Object.values(health)).size >= 2,
    "the map should separate warehouses"
  );
  for (const w of s) {
    const ls = lines.filter((l) => l.warehouse === w.code);
    if (w.health === "ok")
      assert.ok(!ls.some((l) => l.status === "reorder" && l.abc !== "C"));
  }
});
