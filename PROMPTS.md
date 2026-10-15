# PROMPTS.md

AI prompts used to build `cf-ai-rma-assistant`, as required by the Cloudflare AI app assignment.

Two kinds of prompts are recorded here:

1. **Development prompts**: what was asked of AI coding assistants (Claude Code) while building the project.
2. **Runtime prompts**: the system and user prompt templates the app sends to the LLM (Workers AI) at runtime.

---

## 1. Development prompts

Log each prompt in order. Paste it verbatim and add a one-line note on what it produced.

| #   | Date       | Tool        | Prompt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Outcome                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ---------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 2026-10-15 | Claude Code | `create PROMPTS.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Created this file.                                                                                                                                                                                                                                                                                                                                                       |
| 2   | 2026-10-15 | Claude Code | `i will be doing a project using Cloudflares agent starter (npm create cloudflare@latest with the agents-starter template), specifically using thier LLama 3.3 on workers AI. my goal is to build an automated logistcis management tool, but before i get into specifics on what the tool will look like, please run 'npm run dev' locally and test whether we can chat with it?`                                                                                                                                                                                                                                            | Found Node.js missing and the project not yet created.                                                                                                                                                                                                                                                                                                                   |
| 3   | 2026-10-15 | Claude Code | `node.js is installed - please run the download`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Created the project from `cloudflare/agents-starter` and switched the model to Llama 3.3.                                                                                                                                                                                                                                                                                |
| 4   | 2026-10-15 | Claude Code | `i am getting a page not found, please take control of the browser with the skill to access the correct page and make the changes?`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Found the workers.dev subdomain already registered, got the dev server running and tested chat. It worked, but every word was doubled and the model made unwanted tool calls.                                                                                                                                                                                            |
| 5   | 2026-10-15 | Claude Code | `please mkake all fixes` / `we need to use llama 3.3 its a hard requirement`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Removed the duplicate copy of each streamed chunk, removed the demo tools, and limited tool use to explicit requests in the system prompt.                                                                                                                                                                                                                               |
| 6   | 2026-10-15 | Claude Code | `start phase 1, once done ill test in app and you test backend logic`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Phase 1 from RMA_Assistant_Build_Spec.md: the six SQLite tables from section 4, a `logShipment` tool (code-checked, then operator approval), fictional sites/partners, and 11 unit tests.                                                                                                                                                                                |
| 7   | 2026-10-15 | Claude Code | `i dont see any devlopment?`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Phase 1 had no visible UI change. Renamed the app, added demo suggestion buttons and cleared the old chat.                                                                                                                                                                                                                                                               |
| 8   | 2026-10-15 | Claude Code | `okay lets build out the rest`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Phases 2–6: per-shipment Cloudflare Workflow, hashed one-time entry codes with a check-code endpoint, deterministic reconciliation, exception tools, claim drafting, Operations panel, demo seed, README. Also fixed Llama 3.3 sending tool arguments as strings. 43 unit tests; Llama tool-selection eval 27/27.                                                        |
| 9   | 2026-10-15 | Claude Code | `okay lets develop the UI a little better- i want this to serve as a centralised logistics dashboard style, with interactive real world map design to show locational data as it relates to supply chain errors and exceptions. Furthermore i want a kaizen logger to chekc process health and where we can pick up on underlying trends and root cause analysis into errors-please simulate`                                                                                                                                                                                                                                 | Dashboard shell (Control tower, Kaizen, Shipments, Outbox) with the chat as a side Assistant; Leaflet world map of hubs, lanes and sites; 12-week deterministic simulation with four planted problems; p-chart, Pareto, heatmap, root-cause signals (z-test + drill-down + change points), PDCA Kaizen log, Llama root-cause hypotheses. 53 unit tests.                  |
| 10  | 2026-10-15 | Claude Code | `can you add a feature to the control tower where we can see all partner and owned warehouses and our stock levels at each. We want to setup EOQ and safety stocks at our warehouse locations to maintain a lean approach due to increasing storage costs create BOMs and SKUS for serverware, integrated servers etc. Items used by cloudflare`                                                                                                                                                                                                                                                                              | Warehouses on the map (3 owned, 3 partner); illustrative edge-server SKUs and BOMs (kept fictional per the spec's data rule); EOQ, safety stock and reorder point per SKU per warehouse with ABC service levels, a storage-cost what-if and cost of capital; replenishment orders via the Outbox; buildable units per BOM. 64 unit tests.                                |
| 11  | 2026-10-15 | Claude Code | `now lastly we need a logistcis management tool that works alongside shipments (including local final mile deliveries, international shipments/import/exports) these need to be seperated as they will have seperate tasks associated(consider logistics documents as per my oneswitch logistics skill(however please note that this will be for airfreight only) included must be a document warehouse per shipment (invoices, delivery notes, air waybills etc) there should exist an ai simulated functionality within the doc warehouse whereby shipping documentation can be AI reviewed to check for discrepancies etc` | Logistics view with separate Final mile / Exports / Imports workflows (lanes, task checklists, document sets adapted from the OneSwitch doc stages to air freight); a per-job document warehouse; deterministic rule checks plus a Llama 3.3 advisory review; amendment requests and simulated amended drafts; RMA shipments open linked final-mile jobs. 77 unit tests. |
| 12  | 2026-10-15 | Claude Code | `okay i am happy to deploy this live so i can save it to my github`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Renamed the worker, removed real company names from the committed spec, added tests to CI, deployed with a production CODE_PEPPER secret, committed to git for GitHub as cf_ai_rma_assistant.                                                                                                                                                                            |
| 13  | 2026-10-15 | Claude Code | `please also include a README.md covering: what the app does and why (the RMA problem from your data center work), how each of the four required parts is built, how to run it locally, and the live URL at the top. Read it yourself and correct anything inaccurate. Reviewers will ask you about it.and also include my prompt hisotry in the git repo`                                                                                                                                                                                                                                                                    | Rewrote and fact-checked README.md, added npm run eval, committed this prompt history.                                                                                                                                                                                                                                                                                   |

---

## 2. Runtime prompts

### System prompt

Defined in `src/prompt.ts` (`buildSystemPrompt`). The app and the eval scripts both use it. `${now}` is the current time in ISO format. The site and partner lists come from `src/shipments.ts`. `${awaiting}` is one line per shipment awaiting delivery (id, site, partner, window, manifest), so the model can map "3 fans" to part F-200.

```text
You are a data center logistics assistant for RMA and spare-parts deliveries. Answer questions directly in plain text.

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

Sites: LIS-01 Lisbon, AMS-02 Amsterdam, DUB-03 Dublin, FRA-01 Frankfurt.
Partners: FastFreight Couriers, Nimbus Logistics, BlueLine Express.
Shipments awaiting delivery:
${awaiting}
Current time: ${now}. Times are UTC unless the user says otherwise. Give dates in ISO 8601 format.
```

### Claim-drafting prompt

Defined in `src/ai.ts` (`claimPrompt`) and sent by the `draftClaim` tool as a separate, tool-free call. The facts come from the exceptions table, not from the chat.

```text
Write a short, professional claim email to ${partner} from the RMA desk at ${site}.

Facts (use only these; do not invent part numbers, serials, amounts or dates):
- Exception #${id} ${type}: ${detail} Response due by ${due}.
  (one line per exception)
Shipments: ${shipments}

Ask for a replacement or credit for each item and a response by the earliest due time. Plain text only. Start with "Hello ${partner}," and sign off as "RMA Desk, ${site}". Output only the email body.
```

### Root-cause hypothesis prompt

Defined in `src/ai.ts` (`hypothesisPrompt`), sent from the Kaizen view's "Root-cause hypotheses" button as a separate, tool-free call. The signal and the breakdown of its hits by part, partner, site, window, weekday and week come from `src/kaizen.ts`. The answer is shown and stored labelled "Hypotheses (AI, unverified)".

```text
You are a lean / Kaizen practitioner in data center logistics. A statistical root-cause scan found this signal:

${problem}

How the ${hits} affected shipments in this segment spread over other factors (hits, shipments, rate %):
${context JSON}

Give 3 short root-cause hypotheses an operations team could test this week. For each: one line for the hypothesis, then "Check:" with one concrete way to confirm or rule it out using shipment data, a site visit or a partner question. Use only the facts above; do not invent numbers. Plain text, numbered 1-3, no preamble.
```

### Document review prompt

Defined in `src/ai.ts` (`docReviewPrompt`) and sent from the Logistics view's "AI review" button as a separate, tool-free call. The rendered documents come from `renderDoc` and the confirmed discrepancies from `checkDocuments` (both in `src/logistics.ts`).

```text
You are an air-freight documentation controller reviewing a shipment's document set before it moves to the next stage.

Shipment: ${ref · kind · route · forwarder · Incoterm · stage}

Discrepancies already found by automated rule checks (treat these as confirmed; do not repeat them):
${rule findings}

Documents:
${rendered documents}

Write three short sections in plain text:
1. Summary: one or two sentences on whether this set is ready, and what blocks it.
2. Other observations: anything the rule checks would not catch (vague goods descriptions, missing signatures, Incoterm or address inconsistencies, customs or dangerous-goods risks). Only state what the documents show; write "None" if nothing stands out.
3. Amendment request: bullet points the forwarder or broker should correct.
Do not invent numbers that are not in the documents.
```

### Tool descriptions

Defined in `src/tool-specs.ts`, so the app and the eval send identical descriptions and schemas. Each tool's description says when to use it (e.g. "Use only when the user asks to log, book or record a shipment").

### User prompt template

None. The user's chat messages are sent as-is.

### Model and settings

- Model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (Workers AI, `AI` binding)
- Temperature / max tokens: model defaults
- Tools: `logShipment`, `recordDelivery`, `listExceptions`, `updateException`, `draftClaim`, `revokeCode`, plus tools from any connected MCP servers
- Where it is defined: `src/server.ts` (model, tools), `src/tool-specs.ts` (tool schemas), `src/prompt.ts` (system prompt), `src/ai.ts` (claim prompt)
