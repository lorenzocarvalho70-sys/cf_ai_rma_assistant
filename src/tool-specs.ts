import { z } from "zod";
import { llm } from "./llm-schema.ts";
import { deliveryInputSchema } from "./deliveries.ts";
import { shipmentInputSchema } from "./shipments.ts";

// What Llama 3.3 sees for each tool. Kept apart from the execute functions so
// the extraction tests send the model exactly what the app does.
export const TOOL_SPECS = {
  logShipment: {
    description:
      "Log a new RMA or spare-parts shipment and its manifest. Use only when the user asks to log, book or record a shipment.",
    inputSchema: shipmentInputSchema
  },
  recordDelivery: {
    description:
      "Record what a partner delivered for a shipment awaiting delivery. Use only when the user reports a delivery or receipt.",
    inputSchema: deliveryInputSchema
  },
  listExceptions: {
    description:
      "List exceptions, sorted by severity then due time. Use for showing, listing or summarising exceptions.",
    inputSchema: z.object({
      partner: llm.optString().describe("Only this partner's exceptions"),
      shipment_id: llm.optNumber().describe("Only this shipment's exceptions"),
      include_resolved: llm
        .optBoolean()
        .describe(
          "Also include resolved exceptions, e.g. for a weekly summary"
        ),
      since_days: llm
        .optNumber()
        .describe("Only exceptions opened in the last N days")
    })
  },
  updateException: {
    description:
      "Resolve an exception or mark it in progress. Resolving needs a note, e.g. 'replacement shipped under RMA-889'.",
    inputSchema: z.object({
      exception_id: llm.number(),
      status: llm.enum(["in_progress", "resolved"]),
      note: llm.optString().describe("What was done; required to resolve")
    })
  },
  draftClaim: {
    description:
      "Draft a claim email to a partner about open exceptions. Saves a draft in the Outbox; nothing is sent until the operator presses Send.",
    inputSchema: z.object({
      partner: llm.optString().describe("Partner the claim is for"),
      shipment_id: llm.optNumber().describe("Only exceptions on this shipment"),
      exception_ids: llm
        .optArray(llm.number())
        .describe("Specific exception ids")
    })
  },
  revokeCode: {
    description: "Revoke the site entry code for a shipment.",
    inputSchema: z.object({ shipment_id: llm.number() })
  }
} as const;
