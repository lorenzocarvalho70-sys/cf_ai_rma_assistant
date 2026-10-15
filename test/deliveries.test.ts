import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveDelivery,
  resolvePart,
  type OpenShipment
} from "../src/deliveries.ts";

const lis: OpenShipment = {
  id: 12,
  site: "LIS-01",
  partner: "FastFreight Couriers",
  items: [
    { part_number: "PSU", serial_number: "A123", description: "PSU" },
    { part_number: "PSU", serial_number: "A124", description: "PSU" },
    { part_number: "F-200", serial_number: null, description: "fan" }
  ]
};
const dub: OpenShipment = {
  id: 13,
  site: "DUB-03",
  partner: "Nimbus Logistics",
  items: [{ part_number: "GPU", serial_number: "G-1", description: null }]
};

test("spec demo delivery resolves by site + partner and maps 'fans' to F-200", () => {
  const r = resolveDelivery(
    {
      site: "LIS-01",
      partner: "FastFreight",
      items: [
        { serial_number: "a123", condition: "ok" },
        { serial_number: "A124", condition: "damaged" },
        { part_number: "fans", qty: 3 }
      ]
    },
    [lis, dub]
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.shipmentId, 12);
  assert.deepEqual(r.receipts, [
    { part_number: "PSU", serial_number: "A123", qty: 1, condition: "ok" },
    { part_number: "PSU", serial_number: "A124", qty: 1, condition: "damaged" },
    { part_number: "F-200", serial_number: null, qty: 3, condition: "ok" }
  ]);
});

test("explicit shipment id wins; unknown id is an error", () => {
  const r = resolveDelivery(
    { shipment_id: 13, items: [{ serial_number: "G-1" }] },
    [lis, dub]
  );
  assert.ok(r.ok && r.shipmentId === 13);
  const bad = resolveDelivery(
    { shipment_id: 99, items: [{ serial_number: "G-1" }] },
    [lis, dub]
  );
  assert.ok(!bad.ok && /not awaiting delivery/.test(bad.errors[0]));
});

test("ambiguous or unmatched site/partner asks for the shipment number", () => {
  const twoAtLis = [lis, { ...lis, id: 14 }];
  const r = resolveDelivery(
    { site: "Lisbon", items: [{ serial_number: "A123" }] },
    twoAtLis
  );
  assert.ok(!r.ok && /#12.*#14.*Which shipment/.test(r.errors[0]));
  const none = resolveDelivery(
    { site: "AMS-02", items: [{ serial_number: "A123" }] },
    [lis]
  );
  assert.ok(!none.ok && /No shipment awaiting delivery/.test(none.errors[0]));
});

test("serials not on the manifest keep their serial and become UNKNOWN parts", () => {
  const r = resolveDelivery(
    { shipment_id: 12, items: [{ serial_number: "Z9" }] },
    [lis]
  );
  assert.ok(r.ok);
  if (r.ok)
    assert.deepEqual(r.receipts[0], {
      part_number: "UNKNOWN",
      serial_number: "Z9",
      qty: 1,
      condition: "ok"
    });
});

test("rejects items with neither serial nor part, bad quantities and duplicate serials", () => {
  const r = resolveDelivery(
    {
      shipment_id: 12,
      items: [
        { qty: 2 },
        { part_number: "F-200", qty: 0 },
        { serial_number: "A123" },
        { serial_number: "a123" }
      ]
    },
    [lis]
  );
  assert.ok(!r.ok);
  if (!r.ok) {
    assert.equal(r.errors.length, 3);
    assert.match(
      r.errors.join(" "),
      /serial number or a part number.*at least 1.*A123 is listed twice/
    );
  }
});

test("resolvePart matches part number or description, singular or plural", () => {
  assert.equal(resolvePart("f200", lis.items), "F-200");
  assert.equal(resolvePart("Fans", lis.items), "F-200");
  assert.equal(resolvePart("PSUs", lis.items), "PSU");
  assert.equal(resolvePart("cable", lis.items), "CABLE");
});
