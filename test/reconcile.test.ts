import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reconcile,
  type ManifestLine,
  type ReceiptLine
} from "../src/reconcile.ts";

const serial = (part: string, s: string): ManifestLine => ({
  part_number: part,
  serial_number: s,
  qty: 1
});
const bulk = (part: string, qty: number): ManifestLine => ({
  part_number: part,
  serial_number: null,
  qty
});
const got = (
  line: ManifestLine,
  condition: ReceiptLine["condition"] = "ok"
): ReceiptLine => ({ ...line, condition });

const types = (r: ReturnType<typeof reconcile>) =>
  r.findings.map((f) => f.type).sort();

// Spec demo: 2 PSUs A123/A124 + 4x F-200.
const demoManifest = [
  serial("PSU", "A123"),
  serial("PSU", "A124"),
  bulk("F-200", 4)
];

test("everything received in good condition matches with no findings", () => {
  const r = reconcile(
    demoManifest,
    demoManifest.map((m) => got(m))
  );
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.matched, ["PSU A123", "PSU A124", "F-200 x4"]);
});

test("spec demo: A124 damaged and 3 of 4 fans -> DAMAGED_IN_TRANSIT + QTY_VARIANCE", () => {
  const r = reconcile(demoManifest, [
    got(serial("PSU", "A123")),
    got(serial("PSU", "A124"), "damaged"),
    got(bulk("F-200", 3))
  ]);
  assert.deepEqual(types(r), ["DAMAGED_IN_TRANSIT", "QTY_VARIANCE"]);
  assert.match(
    r.findings.find((f) => f.type === "DAMAGED_IN_TRANSIT")!.detail,
    /A124/
  );
  assert.match(
    r.findings.find((f) => f.type === "QTY_VARIANCE")!.detail,
    /4 shipped, 3 received/
  );
  assert.deepEqual(r.matched, ["PSU A123"]);
});

test("serial shipped but not received -> SHORT_SHIPMENT", () => {
  const r = reconcile(demoManifest, [
    got(serial("PSU", "A123")),
    got(bulk("F-200", 4))
  ]);
  assert.deepEqual(types(r), ["SHORT_SHIPMENT"]);
  assert.match(r.findings[0].detail, /A124 shipped but not received/);
});

test("non-serialised part with nothing received -> SHORT_SHIPMENT, not QTY_VARIANCE", () => {
  const r = reconcile(demoManifest, [
    got(serial("PSU", "A123")),
    got(serial("PSU", "A124"))
  ]);
  assert.deepEqual(types(r), ["SHORT_SHIPMENT"]);
  assert.match(r.findings[0].detail, /F-200: 4 shipped, none received/);
});

test("different serial of the same part -> one SERIAL_MISMATCH, not short + unexpected", () => {
  const r = reconcile(demoManifest, [
    got(serial("PSU", "A123")),
    got(serial("PSU", "A999")),
    got(bulk("F-200", 4))
  ]);
  assert.deepEqual(types(r), ["SERIAL_MISMATCH"]);
  assert.match(r.findings[0].detail, /expected serial A124, received A999/);
});

test("mismatched serial that is also damaged reports both", () => {
  const r = reconcile(
    [serial("PSU", "A124")],
    [got(serial("PSU", "A999"), "damaged")]
  );
  assert.deepEqual(types(r), ["DAMAGED_IN_TRANSIT", "SERIAL_MISMATCH"]);
});

test("extra serial of a different part -> UNEXPECTED_ITEM", () => {
  const r = reconcile(
    [serial("PSU", "A123")],
    [got(serial("PSU", "A123")), got(serial("SSD", "S1"))]
  );
  assert.deepEqual(types(r), ["UNEXPECTED_ITEM"]);
  assert.match(
    r.findings[0].detail,
    /SSD serial S1 received but not on the manifest/
  );
});

test("non-serialised part not on the manifest -> UNEXPECTED_ITEM", () => {
  const r = reconcile(
    [bulk("F-200", 4)],
    [got(bulk("F-200", 4)), got(bulk("CABLE-1", 2))]
  );
  assert.deepEqual(types(r), ["UNEXPECTED_ITEM"]);
});

test("over-delivery of a non-serialised part -> QTY_VARIANCE", () => {
  const r = reconcile([bulk("F-200", 4)], [got(bulk("F-200", 5))]);
  assert.deepEqual(types(r), ["QTY_VARIANCE"]);
});

test("right quantity but some damaged -> DAMAGED_IN_TRANSIT only; quantities add across rows", () => {
  const r = reconcile(
    [bulk("F-200", 4)],
    [got(bulk("F-200", 3)), got(bulk("F-200", 1), "damaged")]
  );
  assert.deepEqual(types(r), ["DAMAGED_IN_TRANSIT"]);
  assert.match(r.findings[0].detail, /1 received damaged/);
});

test("nothing received at all -> SHORT_SHIPMENT for every line", () => {
  const r = reconcile(demoManifest, []);
  assert.deepEqual(types(r), [
    "SHORT_SHIPMENT",
    "SHORT_SHIPMENT",
    "SHORT_SHIPMENT"
  ]);
});
