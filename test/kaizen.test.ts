import { test } from "node:test";
import assert from "node:assert/strict";
import {
  controlChart,
  kpis,
  missedHeatmap,
  network,
  pareto,
  signals,
  weekly
} from "../src/kaizen.ts";
import {
  simulateHistory,
  SIM_WEEKS,
  weekStart,
  type ProcessRecord
} from "../src/sim.ts";

const NOW = new Date("2026-10-15T12:00:00Z");
const history = simulateHistory(NOW);

test("simulation is deterministic and covers 12 complete weeks", () => {
  assert.deepEqual(simulateHistory(NOW), history);
  assert.equal(new Set(history.map((r) => r.week)).size, SIM_WEEKS);
  assert.ok(history.length > 500);
  assert.equal(weekStart(NOW).toISOString(), "2026-10-12T00:00:00.000Z");
});

test("root-cause signals find exactly the four planted problems, at the right level", () => {
  const found = signals(history, NOW).map((s) => s.key);
  assert.deepEqual(found.sort(), [
    "DAMAGED_IN_TRANSIT|lane=FastFreight Couriers → LIS-01",
    "MISSED_DELIVERY|partner-window=Nimbus Logistics · before 08:00",
    "QTY_VARIANCE|part=F-200",
    "SERIAL_MISMATCH|site=DUB-03"
  ]);
});

test("onset detection dates the damage spike and the DUB-03 fix", () => {
  const byKey = new Map(signals(history, NOW).map((s) => [s.key, s]));
  const damage = byKey.get(
    "DAMAGED_IN_TRANSIT|lane=FastFreight Couriers → LIS-01"
  )!;
  assert.equal(damage.change?.direction, "started");
  assert.equal(damage.change?.weekStart, "2026-08-31"); // planted from week index 6
  assert.equal(damage.status, "active");

  const serial = byKey.get("SERIAL_MISMATCH|site=DUB-03")!;
  assert.equal(serial.change?.direction, "stopped");
  assert.equal(serial.change?.weekStart, "2026-09-14"); // barcode scanning from week index 8
  assert.equal(serial.status, "improving");
});

test("no signals in a process without planted problems", () => {
  // Same volume and base rates, but every record's exceptions drawn uniformly.
  const flat: ProcessRecord[] = history.map((r, i) => ({
    ...r,
    exceptions:
      i % 7 === 0
        ? [
            {
              type: "SHORT_SHIPMENT",
              severity: "high",
              resolveHours: 10,
              slaBreached: false
            }
          ]
        : []
  }));
  assert.deepEqual(signals(flat, NOW), []);
});

test("Pareto is sorted and its cumulative share ends at 100%", () => {
  const p = pareto(history);
  for (let i = 1; i < p.length; i++) assert.ok(p[i - 1].count >= p[i].count);
  assert.equal(p.at(-1)!.cumShare, 100);
  const total = history.reduce((a, r) => a + r.exceptions.length, 0);
  assert.equal(
    p.reduce((a, x) => a + x.count, 0),
    total
  );
});

test("control chart: centre line is the pooled rate and limits bracket it", () => {
  const weeks = weekly(history, NOW);
  const cc = controlChart(weeks);
  assert.equal(
    cc.points.length,
    SIM_WEEKS,
    "the partial live week is excluded"
  );
  const n = history.length;
  const defects = history.filter((r) => r.exceptions.length > 0).length;
  assert.equal(cc.centre, Math.round((1000 * defects) / n) / 10);
  for (const pt of cc.points)
    assert.ok(pt.lcl! <= cc.centre && cc.centre <= pt.ucl!);
});

test("control chart flags a week far above its limit", () => {
  const spiked = history.map((r) =>
    r.week === 5
      ? {
          ...r,
          exceptions: [
            {
              type: "SHORT_SHIPMENT" as const,
              severity: "high" as const,
              resolveHours: 5,
              slaBreached: false
            }
          ]
        }
      : r
  );
  const cc = controlChart(weekly(spiked, NOW));
  assert.equal(cc.points.find((p) => p.week === 5)!.signal, "above UCL");
});

test("KPIs compare the last 4 complete weeks with the 4 before", () => {
  const k = kpis(weekly(history, NOW));
  assert.deepEqual(
    k.map((x) => x.key),
    ["onTime", "firstTimeRight", "mttrHours", "slaBreach"]
  );
  for (const x of k) {
    assert.equal(x.series.length, SIM_WEEKS);
    assert.ok(x.value != null && x.previous != null);
  }
});

test("missed-delivery heatmap shows the early-window problem", () => {
  const h = missedHeatmap(history);
  const early = h.cells.filter((c) => c.hour < 8);
  const late = h.cells.filter((c) => c.hour >= 8);
  const avg = (cs: typeof early) =>
    cs.reduce((a, c) => a + (c.rate ?? 0), 0) / cs.length;
  assert.ok(avg(early) > 2 * avg(late));
});

test("network view covers every site and lane with rates", () => {
  const net = network(history);
  assert.equal(net.sites.length, 6);
  assert.equal(net.lanes.length, 13);
  const lis = net.lanes.find(
    (l) => l.partner === "FastFreight Couriers" && l.site === "LIS-01"
  )!;
  assert.equal(lis.topIssue, "DAMAGED_IN_TRANSIT");
  assert.ok(net.sites.every((s) => s.shipments > 0 && s.rate >= 0));
});
