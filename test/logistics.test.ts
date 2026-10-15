import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyAmendments,
  awbValid,
  awbWithCheckDigit,
  chargeableKg,
  checkDocuments,
  DOC_REQUIREMENTS,
  laneFromTasks,
  LANES,
  renderDoc,
  TASK_TEMPLATES,
  volumetricKg
} from "../src/logistics.ts";
import { logisticsScenario } from "../src/logistics-seed.ts";

const NOW = new Date("2026-10-15T12:00:00Z");
const scenario = logisticsScenario(NOW);
const byRef = (ref: string) => scenario.find((s) => s.job.ref === ref)!;
const rules = (ref: string) => {
  const s = byRef(ref);
  return checkDocuments(s.job, s.docs)
    .map((f) => f.rule)
    .sort();
};

test("IATA air waybill check digit (serial mod 7)", () => {
  assert.equal(awbWithCheckDigit("961", "4402187"), "961-44021876"); // 4402187 mod 7 = 6
  assert.ok(awbValid("961-44021876"));
  assert.ok(awbValid("96144021876"));
  assert.ok(!awbValid("961-44021873"));
  assert.ok(!awbValid("950-73005165")); // planted typo: should end in 6
  assert.ok(awbValid("950-73005166"));
  assert.ok(!awbValid("not-an-awb"));
});

test("chargeable weight = max(gross, volumetric/6000), rounded up to 0.5 kg", () => {
  assert.equal(volumetricKg(100, 70, 40), 280000 / 6000);
  // Two 100×70×40 crates (46.7 kg vol each) + one 40×30×20 carton (4 kg vol) vs 94 kg gross
  const pieces = [
    { l: 100, w: 70, h: 40, grossKg: 44 },
    { l: 100, w: 70, h: 40, grossKg: 44 },
    { l: 40, w: 30, h: 20, grossKg: 6 }
  ];
  assert.equal(chargeableKg(pieces), 97.5);
  // Dense cargo bills on gross weight.
  assert.equal(chargeableKg([{ l: 80, w: 60, h: 50, grossKg: 52 }]), 52);
});

test("planted discrepancies are found; clean sets pass", () => {
  assert.deepEqual(rules("EXP-2601"), [
    "CHARGEABLE_WEIGHT",
    "LITHIUM",
    "PIECES"
  ]);
  assert.deepEqual(rules("EXP-2602"), ["DECL_VALUE", "EXPORT_CONTROL"]);
  assert.deepEqual(rules("IMP-2601"), [
    "AWB_CHECK_DIGIT",
    "COO_ORIGIN",
    "HS_MISMATCH"
  ]);
  assert.deepEqual(rules("FM-2601"), ["DN_QTY"]);
  assert.deepEqual(rules("IMP-2602"), []);
  assert.deepEqual(rules("FM-2602"), []);
});

test("findings are sorted blockers first and name the documents involved", () => {
  const s = byRef("IMP-2601");
  const f = checkDocuments(s.job, s.docs);
  assert.equal(f[0].rule, "AWB_CHECK_DIGIT");
  assert.equal(f[0].severity, "blocker");
  assert.deepEqual(f.find((x) => x.rule === "COO_ORIGIN")!.docs, [
    "CERTIFICATE_OF_ORIGIN",
    "COMMERCIAL_INVOICE"
  ]);
  assert.match(
    byRef("EXP-2601") &&
      checkDocuments(byRef("EXP-2601").job, byRef("EXP-2601").docs).find(
        (x) => x.rule === "CHARGEABLE_WEIGHT"
      )!.message,
    /should be 97.5 kg/
  );
});

test("missing and still-draft documents depend on the lane", () => {
  const s = byRef("EXP-2602");
  // At lane 2 the AWB isn't due yet; at lane 4 it is, and the draft CI is overdue.
  assert.ok(!rules("EXP-2602").includes("MISSING"));
  const later = checkDocuments({ ...s.job, lane: 4 }, s.docs).map(
    (f) => f.rule
  );
  assert.ok(later.includes("MISSING"));
  assert.ok(later.includes("STILL_DRAFT"));
  // Delivered final-mile job without a POD.
  const fm = byRef("FM-2602");
  const noPod = checkDocuments(
    fm.job,
    fm.docs.filter((d) => d.type !== "PROOF_OF_DELIVERY")
  );
  assert.equal(noPod[0].rule, "MISSING");
});

test("fixing a planted issue clears its finding", () => {
  const s = byRef("EXP-2601");
  const fixed = s.docs.map((d) =>
    d.type === "AIR_WAYBILL"
      ? {
          ...d,
          fields: {
            ...(d.fields as object),
            pieces: 3,
            chargeableKg: 97.5,
            handling:
              "Lithium ion batteries in compliance with Section II of PI967"
          }
        }
      : d
  ) as typeof s.docs;
  assert.deepEqual(checkDocuments(s.job, fixed), []);
});

test("lane follows the first open task; seeds are consistent with their lanes", () => {
  for (const s of scenario) {
    const tasks = TASK_TEMPLATES[s.job.kind].map((t, i) => ({
      lane: t.lane,
      done: i < s.tasksDone
    }));
    assert.equal(laneFromTasks(s.job.kind, tasks), s.job.lane, s.job.ref);
    assert.ok(s.job.lane >= 1 && s.job.lane <= LANES[s.job.kind].length);
  }
  assert.equal(
    laneFromTasks(
      "final_mile",
      TASK_TEMPLATES.final_mile.map((t) => ({ lane: t.lane, done: true }))
    ),
    4
  );
});

test("every kind has a required document set and every seed renders as text", () => {
  for (const kind of ["final_mile", "export", "import"] as const) {
    assert.ok(DOC_REQUIREMENTS[kind].some((r) => !r.optional));
  }
  for (const s of scenario)
    for (const d of s.docs) assert.ok(renderDoc(d).length > 30);
  assert.match(renderDoc(byRef("EXP-2601").docs[0]), /ECCN 5A992/);
});

test("simulated amendments fix every fixable planted finding and bump versions", () => {
  for (const s of scenario) {
    const before = checkDocuments(s.job, s.docs);
    const amended = applyAmendments(s.job, s.docs, before);
    // Amended documents arrive as drafts: only "approve the finals" remains...
    assert.ok(
      checkDocuments(s.job, amended).every((f) => f.rule === "STILL_DRAFT"),
      s.job.ref
    );
    // ...and once the operator marks them final, the set is clean.
    const approved = amended.map((d) => ({ ...d, status: "final" as const }));
    assert.deepEqual(checkDocuments(s.job, approved), [], s.job.ref);
    for (const d of amended) {
      const orig = s.docs.find((x) => x.type === d.type)!;
      if (d.version > orig.version) assert.equal(d.status, "draft");
    }
  }
  // Originals are untouched.
  assert.deepEqual(rules("EXP-2601"), [
    "CHARGEABLE_WEIGHT",
    "LITHIUM",
    "PIECES"
  ]);
});
