# Data Center RMA & Delivery Control Assistant — Build Spec

Give this file to Claude Code at the start of step 4 ("Read SPEC.md and build it in the phases below"). Save it in the project folder as `SPEC.md`.

---

## 1. What the app does (one paragraph for the README)

A chat-based assistant for data center hardware logistics. An operator logs RMA and spare-parts shipments in plain language. The system then:

- tracks each delivery through its lifecycle
- automatically issues a one-time security entry code to the delivery partner before the delivery window
- reconciles what was shipped against what was received (serial-level)
- raises and manages exceptions when they don't match

---

## 2. Rules before you start

- **Use fictional data only.** Make up site names (e.g. "LIS-01 Lisbon"), partners ("FastFreight Couriers") and serial numbers. Never use real client or vendor data, client names or real site access codes in a public repo.
- **Secrets stay out of GitHub.** API keys go in Wrangler secrets (`npx wrangler secret put ...`), never in code.
- **Deterministic code does the matching; the AI explains it.** The reconciliation logic (shipped vs received) is plain code. The LLM only:
  - turns chat messages into structured actions
  - summarises exceptions
  - drafts messages to partners

  This is the main design point to explain in your README and interview: AI where it helps, rules where accuracy matters.

---

## 3. Architecture (maps to Cloudflare's 4 required components)

| Requirement | How it's built |
|---|---|
| LLM | Llama 3.3 on Workers AI, via the Agents SDK. Uses tool-calling so chat messages trigger real actions. |
| Workflow / coordination | Cloudflare Workflows: one workflow instance per delivery, running the lifecycle (below) with timed steps and waits. |
| User input (chat) | Chat UI from the agents starter, plus a simple "Exceptions" panel/table. |
| Memory / state | Durable Object with its built-in SQLite storage holds shipments, items, codes, receipts, exceptions and chat history. |

---

## 4. Data model (Durable Object SQLite)

- **shipments**: id, rma_ref, site, partner, partner_contact, direction (inbound replacement / outbound return), eta_window_start, eta_window_end, status
- **shipment_items** (the manifest — what was sent): shipment_id, part_number, serial_number, description, qty
- **access_codes**: shipment_id, code_hash, valid_from, valid_to, sent_at, used_at, status (issued / used / expired / revoked)
- **receipts** (what arrived): shipment_id, part_number, serial_number, condition (ok / damaged), received_at, received_by
- **exceptions**: id, shipment_id, type, detail, severity, owner, status (open / in progress / resolved), opened_at, due_by, resolved_at, resolution_note
- **outbox**: every message the system "sends" (to, subject, body, sent_at). This doubles as the audit trail.

---

## 5. Delivery lifecycle (the Workflow)

1. **Booked**: shipment and manifest created from chat ("Log an inbound replacement to LIS-01: 2x PSU serials A123, A124, partner FastFreight, ETA tomorrow 09:00–12:00").
2. **Code issue**: the workflow sleeps until X hours before the ETA window (configurable, e.g. 12h). It then generates a one-time entry code that is:
   - random, 6–8 digits
   - stored only as a hash
   - valid only for that delivery window
   - sent to the partner contact
3. **Window open**: waits for a "delivered" event (operator says "FastFreight delivered to LIS-01, received A123 ok, A124 damaged").
4. **No-show check**: if no delivery event arrives by the end of the window, raise a `MISSED_DELIVERY` exception and expire the code.
5. **Reconcile**: compare manifest vs receipts (rules in section 7).
6. **Close or escalate**:
   - all matched → shipment closed, code marked used
   - otherwise → exceptions opened with owner and due date, and a follow-up step re-checks open exceptions after their SLA

---

## 6. Security entry codes — design notes

- **Delivery:**
  - *Demo:* "sending" = writing the message to the outbox table and showing it in the UI.
  - *Optional real send:* Cloudflare's Email Workers `send_email` binding to a verified address of your own. Don't email anyone else.
- **Limits:** one code per delivery, with a time window, single use, revocable ("revoke the code for shipment 12").
- **Never shown again:** codes are never shown in chat after sending (only "code sent to X at 03:00, valid 09:00–12:00"). Store only the hash.
- **Code is a valid entry:** if a partner arrives outside the window or after revocation, the code-check endpoint returns invalid and logs an exception.
- **README note:** in production this would integrate with the site's physical access-control system. The demo simulates it.

---

## 7. Reconciliation rules (plain code, not AI)

Match on serial number first, then part number + qty for non-serialised parts.

| Result | Exception type | Default severity |
|---|---|---|
| Shipped and received, condition ok | — (matched) | — |
| Shipped, not received | `SHORT_SHIPMENT` | High |
| Received, not on manifest | `OVER_RECEIPT / UNEXPECTED_ITEM` | Medium |
| Serial differs from manifest | `SERIAL_MISMATCH` | High |
| Received damaged | `DAMAGED_IN_TRANSIT` | High |
| Quantity differs (non-serialised) | `QTY_VARIANCE` | Medium |
| No delivery in window | `MISSED_DELIVERY` | High |
| Code used outside window / revoked | `ACCESS_VIOLATION` | Critical |

Each exception gets an owner (default: the partner), an SLA (e.g. 24h for High, 4h for Critical), and status tracking.

---

## 8. Exception management (what the chat can do)

- "What exceptions are open?" → table sorted by severity and due time
- "Summarise exceptions for FastFreight this week" → LLM summary from the exceptions table
- "Draft a claim to FastFreight for the damaged PSU on shipment 12" → LLM drafts the email and puts it in the outbox as a draft, not sent until confirmed
- "Resolve exception 7: replacement shipped under RMA-889" → status update with a note
- Overdue exceptions are flagged automatically by the workflow's follow-up step

---

## 9. Build in phases (one Claude Code prompt per phase, test each before moving on)

1. **Phase 1, foundation:** "Read SPEC.md. Using the agents starter already in this project, switch the model to Llama 3.3 on Workers AI and create the SQLite tables in section 4 inside the agent's Durable Object. Add a tool to log a shipment with its manifest from a chat message. Use fictional sample data only."
2. **Phase 2, lifecycle:** "Implement the delivery lifecycle in section 5 as a Cloudflare Workflow, one instance per shipment, started when a shipment is logged. Add a 'mark delivered' tool that records receipts and sends the event to the workflow."
3. **Phase 3, entry codes:** "Implement section 6: one-time hashed entry codes issued by the workflow before the ETA window, sent via the outbox, with revoke and a check-code endpoint. Never display a code in chat after sending."
4. **Phase 4, reconciliation:** "Implement the reconciliation rules in section 7 as deterministic code with unit tests, and open exceptions per the table. The LLM must not do the matching."
5. **Phase 5, exception management:** "Implement section 8: chat tools to list, summarise, draft claims, and resolve exceptions, plus the overdue check. Add an Exceptions panel and an Outbox panel to the UI."
6. **Phase 6, polish:** "Seed a demo scenario (3 shipments: one clean, one with a damaged and a missing item, one no-show), write README.md per the spec, and make sure PROMPTS.md is complete."

For quick testing, ask Claude Code to make the workflow timings configurable (minutes instead of hours) so you can watch the whole lifecycle run in a few minutes.

---

## 10. Demo script (test this before submitting, and use it in the interview)

1. "Log an inbound replacement to LIS-01 for FastFreight: 2 PSUs, serials A123 and A124, plus 4 fans part F-200, delivery window in 5 minutes."
2. Watch the Outbox: the entry-code message to FastFreight appears before the window.
3. "FastFreight delivered to LIS-01: A123 ok, A124 damaged, 3 fans."
4. "What exceptions are open?" → expect `DAMAGED_IN_TRANSIT` (A124) and `QTY_VARIANCE` (fans 4 vs 3).
5. "Draft a claim to FastFreight for these." → draft in the outbox.
6. Let a second shipment pass its window with no delivery → `MISSED_DELIVERY` appears automatically.
