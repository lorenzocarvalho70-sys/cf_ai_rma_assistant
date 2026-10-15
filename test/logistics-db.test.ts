import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ensureSchema, type Exec, type Row } from "../src/db.ts";
import {
  completeTask,
  insertJob,
  insertReview,
  listJobs,
  nextRef,
  setDocStatus,
  toggleTask,
  upsertDoc
} from "../src/logistics-db.ts";
import { applyAmendments } from "../src/logistics.ts";
import { logisticsScenario } from "../src/logistics-seed.ts";

const NOW = new Date("2026-10-15T12:00:00Z");

function seeded() {
  const db = new DatabaseSync(":memory:");
  const exec: Exec = (q, ...b) =>
    db
      .prepare(q)
      .all(...b)
      .map((r) => ({ ...r }) as Row);
  ensureSchema(exec);
  for (const s of logisticsScenario(NOW)) {
    const id = insertJob(exec, { ...s.job, simulated: true }, NOW, s.tasksDone);
    for (const d of s.docs) upsertDoc(exec, id, d, NOW);
  }
  return exec;
}

test("seeded jobs round-trip with lanes and live findings", () => {
  const exec = seeded();
  const jobs = listJobs(exec);
  assert.equal(jobs.length, 6);
  const exp = jobs.find((j) => j.ref === "EXP-2601")!;
  assert.equal(exp.lane, 3);
  assert.equal(exp.laneLabel, "Handed to forwarder");
  assert.equal(exp.docs.length, 4);
  assert.deepEqual(exp.findings.map((f) => f.rule).sort(), [
    "CHARGEABLE_WEIGHT",
    "LITHIUM",
    "PIECES"
  ]);
  assert.equal(jobs.find((j) => j.ref === "IMP-2602")!.findings.length, 0);
});

test("ticking tasks moves the job between lanes", () => {
  const exec = seeded();
  const fm = listJobs(exec).find((j) => j.ref === "FM-2601")!;
  assert.equal(fm.lane, 2);
  for (const t of fm.tasks.filter((t) => t.lane === 2))
    toggleTask(exec, t.id, NOW);
  const moved = listJobs(exec).find((j) => j.ref === "FM-2601")!;
  assert.equal(moved.lane, 3);
  // ...and the delivery note, still a draft, is now flagged.
  assert.ok(moved.findings.some((f) => f.rule === "STILL_DRAFT"));
  // Untick one task: back to lane 2.
  toggleTask(exec, fm.tasks.find((t) => t.lane === 2)!.id, NOW);
  assert.equal(listJobs(exec).find((j) => j.ref === "FM-2601")!.lane, 2);
  // completeTask is idempotent and keyed by title.
  completeTask(exec, fm.id, "Book courier and delivery window", NOW);
  completeTask(exec, fm.id, "Book courier and delivery window", NOW);
  assert.ok(
    listJobs(exec)
      .find((j) => j.ref === "FM-2601")!
      .tasks.find((t) => t.title === "Book courier and delivery window")!.done
  );
});

test("amend → approve clears an import's findings in the database", () => {
  const exec = seeded();
  const imp = listJobs(exec).find((j) => j.ref === "IMP-2601")!;
  for (const d of applyAmendments(imp, imp.docs, imp.findings))
    upsertDoc(exec, imp.id, d, NOW);
  let after = listJobs(exec).find((j) => j.ref === "IMP-2601")!;
  assert.ok(after.findings.every((f) => f.rule === "STILL_DRAFT"));
  assert.equal(after.docs.find((d) => d.type === "AIR_WAYBILL")!.version, 2);
  for (const d of after.docs) setDocStatus(exec, d.id, "final", NOW);
  after = listJobs(exec).find((j) => j.ref === "IMP-2601")!;
  assert.deepEqual(after.findings, []);
});

test("reviews are stored with the latest first; refs count up per kind", () => {
  const exec = seeded();
  const job = listJobs(exec)[0];
  insertReview(exec, job.id, job.findings, "first", NOW);
  insertReview(exec, job.id, [], "second", NOW);
  assert.equal(listJobs(exec)[0].review!.aiText, "second");
  assert.equal(nextRef(exec, "export", NOW), "EXP-2603");
  assert.equal(nextRef(exec, "final_mile", NOW), "FM-2603");
});
