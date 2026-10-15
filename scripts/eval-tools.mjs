// Tool-selection eval for Llama 3.3: sends the spec's demo phrasings (and
// plain questions that must NOT trigger a tool) to Workers AI with the app's
// exact system prompt and tool schemas, then validates the arguments with the
// same Zod schemas and checks the extracted data with the app's own code.
//
// Usage (Node 24):
//   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... npm run eval [-- runs]
// The token needs Workers AI read permission.

import { z } from "zod";
import { TOOL_SPECS } from "../src/tool-specs.ts";
import { buildSystemPrompt } from "../src/prompt.ts";
import { validateShipment } from "../src/shipments.ts";
import { resolveDelivery } from "../src/deliveries.ts";

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token) {
  console.error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.");
  process.exit(1);
}
const runs = Number(process.argv[2] ?? 3);
const url = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast`;

const tools = Object.entries(TOOL_SPECS).map(([name, spec]) => ({
  type: "function",
  function: {
    name,
    description: spec.description,
    parameters: z.toJSONSchema(spec.inputSchema)
  }
}));

const now = new Date();
const minutes = (m) => new Date(now.getTime() + m * 60_000).toISOString();
const awaiting = [
  {
    id: 12,
    site: "LIS-01",
    partner: "FastFreight Couriers",
    status: "code_issued",
    eta_window_start: minutes(5),
    eta_window_end: minutes(65),
    items: [
      { part_number: "PSU", serial_number: "A123", description: "PSU", qty: 1 },
      { part_number: "PSU", serial_number: "A124", description: "PSU", qty: 1 },
      { part_number: "F-200", serial_number: null, description: "fan", qty: 4 }
    ]
  }
];

// [expected tool, or "text" for a plain answer; message; optional check of the arguments]
const cases = [
  [
    "logShipment",
    "Log an inbound replacement to LIS-01 for FastFreight: 2 PSUs, serials A123 and A124, plus 4 fans part F-200, delivery window in 5 minutes.",
    (a) => {
      const v = validateShipment(a, now);
      return v.ok
        ? `valid, ${v.value.items.length} items`
        : `INVALID ${v.errors.join("; ")}`;
    }
  ],
  [
    "recordDelivery",
    "FastFreight delivered to LIS-01: A123 ok, A124 damaged, 3 fans.",
    (a) => {
      const r = resolveDelivery(a, awaiting);
      return r.ok
        ? `#${r.shipmentId}: ${r.receipts.map((x) => `${x.qty}×${x.part_number}${x.serial_number ? ":" + x.serial_number : ""}${x.condition === "damaged" ? " (damaged)" : ""}`).join(", ")}`
        : `INVALID ${r.errors.join("; ")}`;
    }
  ],
  ["listExceptions", "What exceptions are open?"],
  ["listExceptions", "Summarise exceptions for FastFreight this week"],
  ["draftClaim", "Draft a claim to FastFreight for these."],
  ["updateException", "Resolve exception 7: replacement shipped under RMA-889"],
  ["revokeCode", "Revoke the code for shipment 12"],
  ["text", "What is a bill of lading?"],
  ["text", "Hi, what can you do?"]
];

let pass = 0;
let total = 0;
for (let run = 1; run <= runs; run++) {
  for (const [expect, msg, check] of cases) {
    total++;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tool_choice: "auto",
        tools,
        messages: [
          { role: "system", content: buildSystemPrompt(now, awaiting) },
          { role: "user", content: msg }
        ]
      })
    }).then((r) => r.json());
    if (!res.success) {
      console.log(`run ${run} API ERROR ${JSON.stringify(res.errors)}`);
      continue;
    }
    const m = res.result.choices[0].message;
    const call = m.tool_calls?.[0];
    const got = call ? call.function.name : "text";
    let ok = got === expect;
    let detail;
    if (call) {
      const raw = JSON.parse(call.function.arguments);
      const parsed = TOOL_SPECS[got]?.inputSchema.safeParse(raw);
      if (parsed && !parsed.success) {
        ok = false;
        detail = `schema rejected ${JSON.stringify(raw)}`;
      } else {
        detail = check ? check(parsed.data) : JSON.stringify(parsed.data);
        if (detail.startsWith("INVALID")) ok = false;
      }
    } else {
      detail = (m.content ?? "").slice(0, 70).replace(/\n/g, " ");
    }
    if (ok) pass++;
    console.log(
      `${ok ? "PASS" : "FAIL"} run ${run} ${expect.padEnd(15)} got ${got.padEnd(15)} ${msg.slice(0, 42)}… → ${detail}`
    );
  }
}
console.log(
  `\n${pass}/${total} picked the expected tool with schema-valid, usable arguments`
);
process.exit(pass === total ? 0 : 1);
