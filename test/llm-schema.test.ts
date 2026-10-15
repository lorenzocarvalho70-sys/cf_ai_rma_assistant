import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { TOOL_SPECS } from "../src/tool-specs.ts";

// Real argument shapes Llama 3.3 produced in the tool-selection eval.
test("stringified numbers, booleans and nulls are coerced", () => {
  assert.deepEqual(
    TOOL_SPECS.listExceptions.inputSchema.parse({
      partner: "FastFreight",
      since_days: "7",
      include_resolved: "false",
      shipment_id: "null"
    }),
    {
      partner: "FastFreight",
      since_days: 7,
      include_resolved: false,
      shipment_id: null
    }
  );
  assert.deepEqual(
    TOOL_SPECS.updateException.inputSchema.parse({
      exception_id: "7",
      status: "resolved",
      note: "replacement shipped under RMA-889"
    }),
    {
      exception_id: 7,
      status: "resolved",
      note: "replacement shipped under RMA-889"
    }
  );
  assert.deepEqual(
    TOOL_SPECS.revokeCode.inputSchema.parse({ shipment_id: "12" }),
    {
      shipment_id: 12
    }
  );
  assert.deepEqual(
    TOOL_SPECS.draftClaim.inputSchema.parse({
      partner: "FastFreight Couriers",
      exception_ids: "null",
      shipment_id: "null"
    }),
    { partner: "FastFreight Couriers", exception_ids: null, shipment_id: null }
  );
});

test("arrays sent as JSON strings are parsed", () => {
  const r = TOOL_SPECS.recordDelivery.inputSchema.parse({
    shipment_id: "12",
    items:
      '[{"serial_number":"A123","condition":"ok"},{"part_number":"F-200","qty":"3"}]'
  });
  assert.equal(r.shipment_id, 12);
  assert.deepEqual(r.items[1], { part_number: "F-200", qty: 3 });
  assert.deepEqual(
    TOOL_SPECS.draftClaim.inputSchema.parse({ exception_ids: "[7, 8]" })
      .exception_ids,
    [7, 8]
  );
});

test("genuinely wrong values still fail", () => {
  assert.equal(
    TOOL_SPECS.revokeCode.inputSchema.safeParse({ shipment_id: "twelve" })
      .success,
    false
  );
  assert.equal(
    TOOL_SPECS.updateException.inputSchema.safeParse({
      exception_id: 7,
      status: "closed"
    }).success,
    false
  );
});

test("the model still sees plain number / boolean / array types", () => {
  const schema = z.toJSONSchema(TOOL_SPECS.listExceptions.inputSchema) as {
    properties: Record<string, { anyOf?: { type: string }[] }>;
  };
  assert.deepEqual(
    schema.properties.since_days.anyOf?.map((t) => t.type),
    ["number", "null"]
  );
  assert.deepEqual(
    schema.properties.include_resolved.anyOf?.map((t) => t.type),
    ["boolean", "null"]
  );
});
