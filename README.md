# cf_ai_rma_assistant: Data Center RMA & Delivery Control

**Live demo:** https://cf-ai-rma-assistant.lorenzo-carvalho70.workers.dev

An AI-assisted control tower for data center hardware logistics, built on Cloudflare Agents, Workflows, Durable Objects and **Llama 3.3 on Workers AI**.

> All sites, partners, suppliers, serial numbers, prices and contacts are fictional (`.example` email domains). The 12-week history, warehouse stock and air-freight documents are simulated. No real customer, vendor or site data is used.

## What it does, and why

When a server part fails in a data center, the replacement is an **RMA shipment**: a partner courier brings new parts to a secure site and takes the faulty ones back. Each delivery involves several things that usually live in separate email threads and spreadsheets:

- a **site entry code** for the courier, which must work only during the delivery window,
- checking **what arrived against what was shipped**, serial by serial,
- chasing **exceptions** (damaged, short, wrong serial, no-show) with the right partner within an SLA,
- the **air-freight paperwork** behind the parts (invoices, packing lists, air waybills, customs declarations),
- keeping **spares stock** lean at each warehouse without running out.

This app brings that into one place. An operator types plain language ("Log an inbound replacement to LIS-01 for FastFreight: 2 PSUs, serials A123 and A124…") and the system:

1. turns it into a structured shipment, checked by code, which the operator approves,
2. issues a one-time hashed entry code before the window, and records the delivery,
3. reconciles shipped vs received and opens exceptions with owners and SLAs,
4. escalates overdue exceptions, drafts claims, and tracks process health over time.

### The design point: AI where it helps, rules where accuracy matters

The LLM **never decides** whether a delivery matches its manifest, whether a code is valid, or whether a document is consistent. It only:

1. **turns chat messages into structured actions** (tool calls). Every extraction is checked by plain code, and writes wait for the operator's **Approve**,
2. **summarises and explains** results the database returns (exception lists, root-cause hypotheses, document reviews),
3. **drafts messages** (claims, amendment requests) from facts the database supplies. Drafts are never sent without a click.

Matching, severities, SLAs, entry codes, inventory policy, statistics and document checks are deterministic code with unit tests. A model mistake shows up as a question to the operator ("Unknown site MAD-09. Known sites: …"), never as a wrong exception.

## How the four required parts are built

| Requirement                 | How it's built                                                                                                                                                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LLM**                     | Llama 3.3 70B (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) on Workers AI through `workers-ai-provider` and the AI SDK, streamed into an `AIChatAgent`.                                                                                                |
| **Workflow / coordination** | Cloudflare Workflows: one `DeliveryWorkflow` instance per shipment runs the delivery lifecycle with durable sleeps, `waitForEvent("delivered")` and SLA follow-ups, calling back into the agent over RPC.                                             |
| **User input**              | A chat Assistant (the agents-starter chat UI) plus a dashboard: Control tower, Logistics, Kaizen, Shipments and Outbox. It updates live through the agent's state sync over WebSocket.                                                                |
| **Memory / state**          | The agent's Durable Object with its built-in SQLite holds everything: shipments, manifests, entry codes (hash only), receipts, exceptions, outbox, Kaizen log, inventory policy and orders, logistics jobs, documents and reviews, plus chat history. |

```
                         ┌──────────── Durable Object: ChatAgent (SQLite) ────────────┐
 browser ── WebSocket ──►│ chat: Llama 3.3 → tool call → code validates → Approve     │
   ▲                     │ state sync ──► dashboard (map, Kaizen, logistics, outbox)  │
   │                     └──────────▲──────────────────────────────▲──────────────────┘
   └── live state ◄──────────────── │ RPC                           │ POST /api/check-code
                         DeliveryWorkflow (one per shipment)         site gate (simulated)
```

### 1. LLM: Llama 3.3 on Workers AI

- **Six tools:** `logShipment`, `recordDelivery`, `listExceptions`, `updateException`, `draftClaim`, `revokeCode` (`src/tool-specs.ts`). Writes (`logShipment`, `recordDelivery`) need the operator's approval in the chat. The approval card shows a readable summary.
- **System prompt** (`src/prompt.ts`): tools only on explicit requests, never invent sites, serials or ids, never reveal entry codes. It lists the shipments awaiting delivery so the model can map "3 fans" to part `F-200`.
- **Tool-free calls**, where code supplies the facts and the model writes the text:
  - claim emails (`claimPrompt`),
  - Kaizen root-cause hypotheses (`hypothesisPrompt`),
  - air-freight document reviews (`docReviewPrompt`),

  all in `src/ai.ts`.

- **Two Llama 3.3 quirks**, fixed in code:
  - **Duplicated stream:** Workers AI sends each Llama 3.3 chunk in two formats at once, and `workers-ai-provider` emitted both, so every word appeared twice. `withDedupedStream` (`src/ai.ts`) keeps one copy.
  - **Stringified arguments:** Llama often sends tool arguments as strings (`"12"`, `"false"`, `"null"`, or JSON-encoded arrays). `src/llm-schema.ts` coerces them before validation without changing the JSON Schema the model sees.

### 2. Workflow / coordination: Cloudflare Workflows

`src/workflow.ts`: one `DeliveryWorkflow` per shipment, started when the shipment is logged.

1. **Code issue:** sleep until 12 (spec) hours before the window, then issue a random 8-digit entry code. It is stored only as a peppered SHA-256 hash, valid only inside the window, and recorded in the Outbox with the digits masked.
2. **Window open:** `waitForEvent("delivered")` with the window end as the timeout. Status checks before and after waiting cover a delivery recorded while the workflow wasn't waiting.
3. **No-show:** no delivery by the window end → `MISSED_DELIVERY` exception, code expired.
4. **Reconcile:** manifest vs receipts in plain code (`src/reconcile.ts`).
5. **Close or escalate:** all matched → closed and code marked used. Otherwise exceptions open with an owner (the partner) and an SLA (critical 4 h, high 24 h, medium 48 h). Up to three follow-up steps sleep until the next due time, then flag overdue exceptions and send an escalation to the Outbox.

`HOUR_SECONDS` in `wrangler.jsonc` sets the length of one spec "hour". It is **15** in this demo, so the 12 h code lead is 3 minutes and a 24 h SLA is 6 minutes. Delivery windows are always real clock time.

**Entry-code gate:** `POST /api/check-code` with `{ "shipment_id": 12, "code": "12345678" }` returns `{ valid, reason }`. A wrong code is just invalid. A _correct_ code used outside the window, after revocation or a second time opens a critical `ACCESS_VIOLATION`.

### 3. User input: chat + dashboard

- **Assistant:** chat with Llama 3.3; tool calls show as collapsible cards, and writes show an Approve / Reject card.
- **Control tower:**
  - KPI tiles: live open exceptions, plus on-time delivery, first-time-right, mean time to resolve and SLA breaches (last 4 weeks vs the 4 before),
  - an interactive world map (Leaflet): partner hubs → data center sites along great-circle lanes coloured by exception rate, with warehouses and pulsing rings for live exceptions,
  - the live exception feed,
  - **warehouses & lean replenishment**: EOQ, safety stock and reorder point per SKU per warehouse, a storage-cost what-if, replenishment orders, and **bills of materials** for three server builds with buildable units.
- **Logistics (air freight):** separate **Final mile**, **Exports** and **Imports** workflows, each with its own lanes, task checklist and required documents.
  - **Document warehouse per job:** draft/final status, versions and a rendered viewer.
  - **Rule checks in code**, for example:
    - air waybill check digit (IATA standard)
    - chargeable weight vs volumetric weight
    - pieces and weight: packing list vs AWB
    - value and HS codes: invoice vs declaration
    - certificate of origin vs the invoice's country of origin
    - lithium-battery statement, export-control statement
    - delivery note vs manifest
  - **AI review:** Llama 3.3 adds an advisory review on top of the rule checks.
  - **Amendments:** "Request amendments" drafts the forwarder email; "Simulate amended drafts" demos the loop.
  - **RMA link:** every RMA shipment opens a final-mile job, and the RMA lifecycle ticks its tasks.
- **Kaizen:** process health over 12 simulated weeks plus every finished live shipment:
  - a p-chart with control limits,
  - root-cause signals (each segment vs the rest of the network, two-proportion z-test with z ≥ 3.5 and ≥ 2× baseline, drilled down to the narrowest explaining segment, dated by change-point detection),
  - a Pareto chart, a missed-delivery heatmap,
  - a PDCA Kaizen log,
  - Llama-proposed hypotheses, labelled _unverified_.
- **Shipments / Outbox:** every shipment's status, and every message the system sent or drafted (the audit trail).

### 4. Memory / state: Durable Object SQLite

A single `ChatAgent` Durable Object owns the SQLite database (`src/db.ts`, `src/logistics-db.ts`). Multi-row writes run inside `transactionSync` transactions, and after every change the agent pushes a fresh dashboard state to all connected clients with `setState`, so the UI never polls. The Workflow keeps no business data: each step is an RPC into the agent, and only small plain values are persisted as step results. Plaintext entry codes are never returned from a step and never stored.

## Run it locally

Requirements:

- **Node.js 24**: the tests use `node:sqlite` and run TypeScript natively.
- **A Cloudflare account**: Workers AI runs remotely even in local dev.

```bash
npm install
npx wrangler login
```

Create `.dev.vars` (git-ignored):

```bash
CODE_PEPPER="<64 random hex chars>"
# Optional: print each plaintext entry code to the dev console so you can test /api/check-code.
DEMO_LOG_CODES="true"
```

```bash
npm run dev      # http://localhost:5173
npm test         # 77 unit tests (Node's built-in runner, no extra packages)
npm run check    # format check, lint, typecheck
```

If `npm run dev` asks you to register a workers.dev subdomain, do that once in the Cloudflare dashboard.

### Deploy

```bash
npx wrangler secret put CODE_PEPPER   # a different random value from local; never committed
npm run deploy
```

Leave `DEMO_LOG_CODES` unset in production.

## Demo script

**Load demo** (Control tower → Live exceptions) seeds three shipments: one clean, one damaged + missing, and one no-show that fires after about 3 minutes. Or drive it by chat:

1. "Log an inbound replacement to LIS-01 for FastFreight: 2 PSUs, serials A123 and A124, plus 4 fans part F-200, delivery window starts in 4 minutes and lasts 1 hour." → **Approve**.
2. **Outbox**: the masked entry-code message to FastFreight appears 3 minutes before the window.
3. "FastFreight delivered to LIS-01: A123 ok, A124 damaged, 3 fans." → **Approve**. The workflow reconciles within seconds.
4. "What exceptions are open?" → `DAMAGED_IN_TRANSIT` (A124) and `QTY_VARIANCE` (fans 4 vs 3).
5. "Draft a claim to FastFreight for these." → a draft in the Outbox; press **Send**.
6. "Resolve exception <id>: FastFreight credited the missing fan." (ids are shown in the Exceptions list).
7. **Logistics → Exports → EXP-2601** → **AI review**, then **Request amendments** and **Simulate amended drafts**.
8. **Kaizen** → **Root-cause hypotheses** on the FastFreight → LIS-01 signal, then **Open kaizen**.

## Testing and evaluation

- **`npm test`: 77 unit tests**, all in plain TypeScript with real SQLite (`node:sqlite`) and a fake clock:
  - the full delivery lifecycle,
  - reconciliation rules, entry codes (hashing, window, reuse, revocation),
  - delivery-to-manifest matching, shipment validation, coercion of Llama's stringified arguments,
  - inventory maths (z-values, EOQ, safety stock, ABC, BOM roll-up),
  - Kaizen analytics: the four problems planted in the simulation are found exactly, with the right onset dates, and a clean process gives no signals,
  - air-freight document checks: each planted discrepancy is found, clean sets pass, and amend-then-approve clears findings.
- **`npm run eval`**: sends the spec's demo phrasings, plus questions that must _not_ trigger a tool, to Llama 3.3 with the app's exact system prompt and tool schemas, then validates the arguments with the same code (needs `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`). In development it scored 27 of 27 across three runs.
- **CI** (`.github/workflows/sanity-check.yml`): format check, lint, typecheck and tests on Node 24.

## Limitations and production notes

- **No login.** The live demo is open by design so reviewers can try it; anyone with the URL can chat (Workers AI free-tier limits cap usage) or press Reset. Production would sit behind Cloudflare Access.
- **The gate endpoint is simulated.** In production `/api/check-code` would be called by the site's access-control system, with authentication and rate limiting.
- **One agent instance (`default`)** holds all data: fine for a demo, while a real deployment would partition per tenant or region.
- **Times are UTC.**
- **No-shows and final mile:** after a no-show, the linked final-mile job stays at "Out for delivery". The exception is raised in the Control tower, but the job doesn't move to a failed state.
- **Illustrative data:** prices, SKUs and document contents are simulated, and Esri map tiles need checking against Esri's terms for production use.

## Project layout

| Path                                                                                             | What                                                                                        |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `src/server.ts`                                                                                  | `ChatAgent`: tools, lifecycle RPC methods, state sync, dashboard actions, `/api/check-code` |
| `src/workflow.ts`                                                                                | `DeliveryWorkflow`: the per-shipment lifecycle                                              |
| `src/lifecycle.ts`, `src/reconcile.ts`, `src/codes.ts`                                           | Lifecycle operations, matching rules and SLAs, entry codes                                  |
| `src/shipments.ts`, `src/deliveries.ts`                                                          | Fictional reference data; validation of what the LLM extracted                              |
| `src/db.ts`, `src/logistics-db.ts`                                                               | SQLite schema and queries                                                                   |
| `src/prompt.ts`, `src/tool-specs.ts`, `src/ai.ts`, `src/llm-schema.ts`                           | System prompt, tool schemas, Llama helpers and prompts                                      |
| `src/logistics*.ts`, `src/logistics-panel.tsx`                                                   | Air-freight jobs, document rule checks, simulated jobs, Logistics view                      |
| `src/inventory.ts`, `src/inventory-panel.tsx`                                                    | Illustrative catalogue, BOMs, warehouses, EOQ / safety stock policy                         |
| `src/sim.ts`, `src/kaizen.ts`                                                                    | Simulated 12-week history and process analytics                                             |
| `src/app.tsx`, `src/dashboard.tsx`, `src/network-map.tsx`, `src/charts.tsx`, `src/ops-panel.tsx` | UI shell, dashboard views, Leaflet map, SVG charts                                          |
| `test/`, `scripts/eval-tools.mjs`                                                                | Unit tests; Llama tool-selection eval                                                       |
| `PROMPTS.md`                                                                                     | Every prompt used to build the app, and the runtime prompts                                 |
| `RMA_Assistant_Build_Spec.md`                                                                    | The original build spec                                                                     |
