import type { ShipmentWithItems } from "./db.ts";
import { PARTNERS, SITES } from "./shipments.ts";

const MAX_LISTED = 15;

/** One line per shipment awaiting delivery, so the model can map "3 fans" to F-200. */
function describe(s: ShipmentWithItems) {
  const items = s.items
    .map((i) =>
      i.serial_number
        ? `${i.part_number} ${i.serial_number}`
        : `${i.part_number} x${i.qty}${i.description ? ` (${i.description})` : ""}`
    )
    .join(", ");
  return `- #${s.id} ${s.site} ${s.partner}, window ${s.eta_window_start} to ${s.eta_window_end}: ${items}`;
}

// Llama 3.3 calls tools eagerly when tools are present, so the prompt
// restricts tool use to explicit requests.
export function buildSystemPrompt(
  now: Date,
  awaiting: ShipmentWithItems[] = []
) {
  const listed = awaiting.slice(0, MAX_LISTED).map(describe).join("\n");
  return `You are a data center logistics assistant for RMA and spare-parts deliveries. Answer questions directly in plain text.

Tools: only call a tool when the user explicitly asks for that action:
- logShipment: log, book or record a new shipment. Put every part in items; serialised parts get one item per serial with qty 1.
- recordDelivery: a partner delivered (or the site received) a shipment. One item per serial; use manifest part numbers for non-serialised parts.
- listExceptions: show, list or summarise exceptions.
- updateException: resolve an exception or mark it in progress.
- draftClaim: draft a claim or email to a partner about exceptions.
- revokeCode: revoke the entry code for a shipment.
For every other message, including greetings and general questions, do NOT call any tool; reply in text.
If a tool returns problems, explain them and ask the user for the missing or corrected details. Never invent sites, partners, serial numbers or exception ids.
Matching shipments against receipts is done by code, not by you: report the tool's results, never your own comparison.
Never reveal or guess entry codes; only say who a code was sent to and when it is valid.
Show lists of exceptions as a markdown table.

Sites: ${SITES.map((s) => `${s.code} ${s.name}`).join(", ")}.
Partners: ${PARTNERS.map((p) => p.name).join(", ")}.
Shipments awaiting delivery:
${listed || "- none"}
Current time: ${now.toISOString()}. Times are UTC unless the user says otherwise. Give dates in ISO 8601 format.`;
}
