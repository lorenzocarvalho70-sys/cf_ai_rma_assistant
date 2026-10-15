// Delivery lifecycle operations (spec sections 5–8). The Workflow decides
// *when* each runs; these decide *what* happens, using plain code only.

import { checkCode, generateCode, hashCode, type CodeCheck } from "./codes.ts";
import {
  AWAITING_DELIVERY,
  closeCode,
  flagOverdue,
  getReceipts,
  getShipment,
  insertCode,
  insertException,
  insertOutbox,
  insertReceipts,
  latestCode,
  listExceptions,
  listShipments,
  overdueUnflagged,
  setShipmentStatus,
  updateException,
  awaitingDelivery,
  type Exec,
  type ExceptionFilter,
  type Row,
  type ShipmentStatus,
  type ShipmentWithItems
} from "./db.ts";
import {
  resolveDelivery,
  type DeliveryInput,
  type OpenShipment
} from "./deliveries.ts";
import { SIM_WEEKS, weekStart, type ProcessRecord } from "./sim.ts";
import {
  reconcile,
  SEVERITY,
  SLA_HOURS,
  type ExceptionType,
  type ManifestLine
} from "./reconcile.ts";

/** How far ahead of the delivery window the entry code is issued, in spec hours. */
export const CODE_LEAD_HOURS = 12;

export type Ctx = {
  exec: Exec;
  now: () => Date;
  /** Length of one spec "hour" in ms: 3_600_000 in production, seconds in demos. */
  hourMs: number;
  /** Secret mixed into code hashes (Wrangler secret CODE_PEPPER). */
  pepper: string;
  /** Called with the plaintext code when demo logging is on; never stored. */
  onCodeIssued?: (shipmentId: number, code: string) => void;
};

const iso = (d: Date) => d.toISOString();
const isAwaiting = (s: ShipmentWithItems) =>
  AWAITING_DELIVERY.includes(s.status as ShipmentStatus);

function openException(
  ctx: Ctx,
  s: ShipmentWithItems,
  type: ExceptionType,
  detail: string
): number {
  const severity = SEVERITY[type];
  const now = ctx.now();
  return insertException(
    ctx.exec,
    {
      shipment_id: Number(s.id),
      type,
      detail,
      severity,
      owner: String(s.partner),
      due_by: iso(new Date(now.getTime() + SLA_HOURS[severity] * ctx.hourMs))
    },
    now
  );
}

/** Earliest due time among a shipment's open, not-yet-flagged exceptions. */
function nextDue(ctx: Ctx, shipmentId: number): string | null {
  const open = listExceptions(ctx.exec, { shipmentId }).filter(
    (e) => e.overdue_flagged_at == null
  );
  const dues = open.map((e) => String(e.due_by)).sort();
  return dues[0] ?? null;
}

export function lifecyclePlan(ctx: Ctx, shipmentId: number) {
  const s = getShipment(ctx.exec, shipmentId);
  if (!s) return null;
  const start = new Date(String(s.eta_window_start)).getTime();
  return {
    codeIssueAt: iso(new Date(start - CODE_LEAD_HOURS * ctx.hourMs)),
    windowEnd: String(s.eta_window_end)
  };
}

export async function issueEntryCode(ctx: Ctx, shipmentId: number) {
  const s = getShipment(ctx.exec, shipmentId);
  if (!s || !isAwaiting(s))
    return { issued: false, reason: "not awaiting delivery" };
  if (latestCode(ctx.exec, shipmentId)?.status === "issued") {
    return { issued: false, reason: "code already issued" };
  }

  const now = ctx.now();
  const code = generateCode();
  const hash = await hashCode(ctx.pepper, shipmentId, code);
  insertCode(
    ctx.exec,
    shipmentId,
    hash,
    String(s.eta_window_start),
    String(s.eta_window_end),
    now
  );
  insertOutbox(
    ctx.exec,
    {
      shipment_id: shipmentId,
      to: String(s.partner_contact),
      subject: `Site entry code: shipment #${shipmentId} to ${s.site}`,
      body: [
        `Hello ${s.partner},`,
        ``,
        `Your one-time site entry code for shipment #${shipmentId}${s.rma_ref ? ` (${s.rma_ref})` : ""} at ${s.site} is ready.`,
        `Valid from ${s.eta_window_start} to ${s.eta_window_end} (UTC). Single use.`,
        ``,
        `Code: ••••••••`,
        ``,
        `(The code went to the partner only. This record keeps no copy; the system stores just its hash.)`
      ].join("\n"),
      status: "sent"
    },
    now
  );
  setShipmentStatus(ctx.exec, shipmentId, "code_issued", ["booked"]);
  ctx.onCodeIssued?.(shipmentId, code);
  // Never return the code: workflow step results are persisted.
  return { issued: true, sentTo: String(s.partner_contact), sentAt: iso(now) };
}

export function handleNoShow(ctx: Ctx, shipmentId: number) {
  const s = getShipment(ctx.exec, shipmentId);
  if (!s || !isAwaiting(s)) return { missed: false, nextDue: null };
  const now = ctx.now();
  closeCode(ctx.exec, shipmentId, "expired", now);
  openException(
    ctx,
    s,
    "MISSED_DELIVERY",
    `${s.partner} did not deliver to ${s.site} during the window ${s.eta_window_start} to ${s.eta_window_end}.`
  );
  setShipmentStatus(ctx.exec, shipmentId, "missed");
  return { missed: true, nextDue: nextDue(ctx, shipmentId) };
}

export function reconcileShipment(ctx: Ctx, shipmentId: number) {
  const s = getShipment(ctx.exec, shipmentId);
  if (!s || s.status !== "delivered") {
    return { reconciled: false, matched: 0, exceptions: 0, nextDue: null };
  }
  const manifest = s.items as unknown as ManifestLine[];
  const result = reconcile(manifest, getReceipts(ctx.exec, shipmentId));
  for (const f of result.findings) openException(ctx, s, f.type, f.detail);

  closeCode(ctx.exec, shipmentId, "used", ctx.now());
  setShipmentStatus(
    ctx.exec,
    shipmentId,
    result.findings.length ? "exceptions_open" : "closed"
  );
  return {
    reconciled: true,
    matched: result.matched.length,
    exceptions: result.findings.length,
    nextDue: nextDue(ctx, shipmentId)
  };
}

/** The workflow's follow-up step: flag and escalate exceptions past their SLA. */
export function followUpOverdue(ctx: Ctx, shipmentId: number) {
  const now = ctx.now();
  const overdue = overdueUnflagged(ctx.exec, shipmentId, now);
  for (const e of overdue) {
    flagOverdue(ctx.exec, Number(e.id), now);
    insertOutbox(
      ctx.exec,
      {
        shipment_id: shipmentId,
        to: String(e.partner_contact),
        subject: `Overdue: exception #${e.id} (${e.type}) on shipment #${shipmentId}`,
        body: `Exception #${e.id} (${e.type}, ${e.severity}) on shipment #${shipmentId} was due by ${e.due_by} and is still ${e.status}.\n\n${e.detail}\n\nPlease respond as a priority.`,
        status: "sent"
      },
      now
    );
  }
  return { flagged: overdue.length, nextDue: nextDue(ctx, shipmentId) };
}

export function recordDelivery(ctx: Ctx, input: DeliveryInput) {
  const open: OpenShipment[] = awaitingDelivery(ctx.exec).map((s) => ({
    id: Number(s.id),
    site: String(s.site),
    partner: String(s.partner),
    items: s.items as unknown as OpenShipment["items"]
  }));
  const result = resolveDelivery(input, open);
  if (!result.ok) return result;
  insertReceipts(
    ctx.exec,
    result.shipmentId,
    result.receipts,
    input.received_by?.trim() || null,
    ctx.now()
  );
  return result;
}

export async function checkEntryCode(
  ctx: Ctx,
  shipmentId: number,
  code: string
): Promise<CodeCheck> {
  const s = getShipment(ctx.exec, shipmentId);
  if (!s)
    return { valid: false, reason: "Unknown shipment.", violation: false };
  const now = ctx.now();
  const row = latestCode(ctx.exec, shipmentId);
  const result = checkCode(
    row,
    await hashCode(ctx.pepper, shipmentId, code),
    now
  );
  if (result.valid) {
    closeCode(ctx.exec, shipmentId, "used", now);
  } else if (result.violation) {
    openException(
      ctx,
      s,
      "ACCESS_VIOLATION",
      `Entry code for shipment #${shipmentId} presented at ${s.site} at ${iso(now)}: ${result.reason}`
    );
  }
  return result;
}

export function revokeEntryCode(ctx: Ctx, shipmentId: number) {
  const s = getShipment(ctx.exec, shipmentId);
  if (!s)
    return { revoked: false, reason: `Shipment ${shipmentId} not found.` };
  const revoked = closeCode(ctx.exec, shipmentId, "revoked", ctx.now());
  return revoked
    ? {
        revoked: true,
        reason: `Entry code for shipment #${shipmentId} revoked.`
      }
    : {
        revoked: false,
        reason: `Shipment #${shipmentId} has no active entry code.`
      };
}

export function changeException(
  ctx: Ctx,
  id: number,
  status: "in_progress" | "resolved",
  note: string | null
) {
  if (status === "resolved" && !note?.trim()) {
    return {
      ok: false as const,
      error: "A resolution note is required to resolve an exception."
    };
  }
  const row = updateException(
    ctx.exec,
    id,
    status,
    note?.trim() || null,
    ctx.now()
  );
  if (!row) return { ok: false as const, error: `Exception ${id} not found.` };

  // Close the shipment once its last exception is resolved.
  const shipmentId = Number(row.shipment_id);
  if (listExceptions(ctx.exec, { shipmentId }).length === 0) {
    setShipmentStatus(ctx.exec, shipmentId, "closed", [
      "exceptions_open",
      "missed"
    ]);
  }
  return { ok: true as const, exception: row };
}

export type ExceptionView = Row & { overdue: boolean };

/** Exceptions with an `overdue` flag computed against now. */
export function exceptionsView(
  ctx: Ctx,
  filter: ExceptionFilter = {}
): ExceptionView[] {
  const now = iso(ctx.now());
  return listExceptions(ctx.exec, filter).map(
    (e: Row) =>
      ({
        ...e,
        overdue:
          e.status !== "resolved" && e.due_by != null && String(e.due_by) <= now
      }) as ExceptionView
  );
}

const WEEK_MS = 7 * 86_400_000;
const FINISHED: ShipmentStatus[] = ["closed", "exceptions_open", "missed"];

/**
 * Finished live shipments in the same shape as the simulated history, so the
 * Kaizen analytics treat real activity as the most recent weeks.
 */
export function liveProcessRecords(ctx: Ctx): ProcessRecord[] {
  const now = ctx.now();
  const current = weekStart(now).getTime();
  const exceptions = listExceptions(ctx.exec, { includeResolved: true });
  return listShipments(ctx.exec)
    .filter((s) => FINISHED.includes(s.status as ShipmentStatus))
    .flatMap((s) => {
      const start = new Date(String(s.eta_window_start));
      const week =
        SIM_WEEKS -
        Math.round((current - weekStart(start).getTime()) / WEEK_MS);
      if (week < 0 || week > SIM_WEEKS) return [];
      const first = s.items[0];
      return [
        {
          id: `live-${s.id}`,
          simulated: false,
          week,
          site: String(s.site),
          partner: String(s.partner),
          part: String(first?.part_number ?? "UNKNOWN"),
          serialised: first?.serial_number != null,
          windowHour: start.getUTCHours(),
          weekday: (start.getUTCDay() + 6) % 7,
          exceptions: exceptions
            .filter((e) => e.shipment_id === s.id)
            .map((e) => {
              const resolvedAt = e.resolved_at
                ? new Date(String(e.resolved_at))
                : null;
              const opened = new Date(String(e.opened_at));
              return {
                type: e.type as ExceptionType,
                severity: SEVERITY[e.type as ExceptionType],
                resolveHours: resolvedAt
                  ? Math.round(
                      ((resolvedAt.getTime() - opened.getTime()) / ctx.hourMs) *
                        10
                    ) / 10
                  : null,
                slaBreached:
                  (resolvedAt ?? now).toISOString() > String(e.due_by)
              };
            })
        }
      ];
    });
}
