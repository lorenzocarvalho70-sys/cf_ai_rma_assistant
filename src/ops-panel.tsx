import { Badge, Button } from "@cloudflare/kumo";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react";
import { TYPE_LABEL } from "./charts";
import type { DashboardState } from "./server";

// ── Formatting ───────────────────────────────────────────────────────

/** "in 4m", "12m ago": the lifecycle runs in minutes during demos. */
export function relative(iso: unknown, now: number) {
  if (typeof iso !== "string") return "";
  const diff = Math.round((new Date(iso).getTime() - now) / 60_000);
  const abs = Math.abs(diff);
  const span =
    abs < 60
      ? `${abs}m`
      : abs < 2880
        ? `${Math.round(abs / 60)}h`
        : `${Math.round(abs / 1440)}d`;
  if (abs === 0) return "just now";
  return diff > 0 ? `in ${span}` : `${span} ago`;
}

function clock(iso: unknown) {
  if (typeof iso !== "string") return "";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

const SEVERITY_STYLE: Record<string, { background: string; color: string }> = {
  critical: { background: "var(--status-critical)", color: "#ffffff" },
  high: { background: "var(--status-serious)", color: "#0b0b0b" },
  medium: { background: "var(--status-warning)", color: "#0b0b0b" }
};

const STATUS_LABEL: Record<string, string> = {
  booked: "Booked",
  code_issued: "Code issued",
  delivered: "Reconciling",
  closed: "Closed",
  exceptions_open: "Exceptions open",
  missed: "Missed"
};

function statusVariant(
  status: unknown
): "primary" | "secondary" | "destructive" {
  if (status === "closed") return "primary";
  if (status === "exceptions_open" || status === "missed") return "destructive";
  return "secondary";
}

function itemsLine(items: DashboardState["shipments"][number]["items"]) {
  return items
    .map((i) =>
      i.serial_number
        ? `${i.part_number} ${i.serial_number}`
        : `${i.qty}× ${i.part_number}`
    )
    .join(", ");
}

// ── Panels ───────────────────────────────────────────────────────────

export function Exceptions({
  state,
  now,
  site
}: {
  state: DashboardState;
  now: number;
  /** Only this site's exceptions (map selection) */
  site?: string | null;
}) {
  const all = state.exceptions.filter((e) => !site || e.site === site);
  const open = all.filter((e) => e.status !== "resolved");
  const resolved = all.filter((e) => e.status === "resolved");
  if (all.length === 0) {
    return (
      <Empty text="No exceptions. Deliveries that don't match their manifest show up here." />
    );
  }
  return (
    <div className="space-y-2">
      {open.map((e) => {
        const overdue =
          typeof e.due_by === "string" && new Date(e.due_by).getTime() <= now;
        return (
          <div
            key={String(e.id)}
            className="rounded-lg border border-kumo-line bg-kumo-base p-3"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
                style={SEVERITY_STYLE[String(e.severity)]}
              >
                {String(e.severity)}
              </span>
              <span className="text-xs font-semibold text-kumo-default">
                {TYPE_LABEL[String(e.type)] ?? String(e.type)}
              </span>
              <span className="text-xs text-kumo-subtle">
                #{String(e.id)} · shipment #{String(e.shipment_id)} ·{" "}
                {String(e.site)}
              </span>
              {e.status === "in_progress" && (
                <Badge variant="secondary">In progress</Badge>
              )}
            </div>
            <p className="text-sm text-kumo-default mt-1.5">
              {String(e.detail)}
            </p>
            <div className="flex items-center justify-between mt-1.5 text-xs">
              <span className="text-kumo-subtle">Owner: {String(e.owner)}</span>
              <span
                className={overdue ? "font-semibold" : "text-kumo-subtle"}
                style={
                  overdue ? { color: "var(--status-critical)" } : undefined
                }
              >
                {overdue
                  ? `⚠ Overdue · was due ${relative(e.due_by, now)}`
                  : `Due ${relative(e.due_by, now)}`}
                {e.overdue_flagged_at ? " · escalated" : ""}
              </span>
            </div>
          </div>
        );
      })}
      {resolved.length > 0 && (
        <details className="pt-1">
          <summary className="text-xs text-kumo-subtle cursor-pointer select-none">
            Resolved ({resolved.length})
          </summary>
          <div className="space-y-1.5 mt-2">
            {resolved.map((e) => (
              <div
                key={String(e.id)}
                className="rounded-lg border border-kumo-line p-2.5 text-xs text-kumo-subtle"
              >
                <span className="font-mono font-semibold">
                  {String(e.type)}
                </span>{" "}
                #{String(e.id)} · shipment #{String(e.shipment_id)}:{" "}
                {String(e.resolution_note ?? "")}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

export function Shipments({
  state,
  now
}: {
  state: DashboardState;
  now: number;
}) {
  if (state.shipments.length === 0) {
    return (
      <Empty text="No shipments yet. Log one in chat, or load the demo scenario." />
    );
  }
  return (
    <div className="space-y-2">
      {state.shipments.map((s) => {
        const open = s.status === "booked" || s.status === "code_issued";
        const end =
          typeof s.eta_window_end === "string" ? s.eta_window_end : "";
        return (
          <div
            key={String(s.id)}
            className="rounded-lg border border-kumo-line bg-kumo-base p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-semibold text-kumo-default">
                  #{String(s.id)}
                </span>
                <span className="text-sm text-kumo-default truncate">
                  {String(s.site)} · {String(s.partner)}
                </span>
              </div>
              <Badge variant={statusVariant(s.status)}>
                {STATUS_LABEL[String(s.status)] ?? String(s.status)}
              </Badge>
            </div>
            <div className="text-xs text-kumo-subtle mt-1">
              {s.direction === "outbound_return"
                ? "Outbound return"
                : "Inbound replacement"}
              {s.rma_ref ? ` · ${String(s.rma_ref)}` : ""} · window{" "}
              {clock(s.eta_window_start)}–
              {clock(s.eta_window_end).split(", ").pop()}
              {open && end ? ` (closes ${relative(end, now)})` : ""}
            </div>
            <div className="text-xs text-kumo-default mt-1 font-mono">
              {itemsLine(s.items)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Outbox({
  state,
  now,
  onSend
}: {
  state: DashboardState;
  now: number;
  onSend: (id: number) => void;
}) {
  if (state.outbox.length === 0) {
    return (
      <Empty text="Nothing sent yet. Entry codes, escalations and claim drafts appear here." />
    );
  }
  return (
    <div className="space-y-2">
      {state.outbox.map((m) => {
        const draft = m.status === "draft";
        return (
          <details
            key={String(m.id)}
            className={`rounded-lg border bg-kumo-base p-3 ${draft ? "border-kumo-warning ring-1 ring-kumo-warning" : "border-kumo-line"}`}
            open={draft}
          >
            <summary className="cursor-pointer select-none list-none">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-kumo-default truncate">
                  {String(m.subject)}
                </span>
                <Badge variant={draft ? "destructive" : "secondary"}>
                  {draft ? "Draft" : "Sent"}
                </Badge>
              </div>
              <div className="text-xs text-kumo-subtle mt-0.5">
                To {String(m.to)}
                {m.sent_at ? ` · ${relative(m.sent_at, now)}` : ""}
              </div>
            </summary>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-kumo-default border-t border-kumo-line pt-2">
              {String(m.body)}
            </pre>
            {draft && (
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  variant="primary"
                  icon={<PaperPlaneTiltIcon size={14} />}
                  onClick={() => onSend(Number(m.id))}
                >
                  Send
                </Button>
              </div>
            )}
          </details>
        );
      })}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="text-sm text-kumo-subtle text-center py-10 px-6">{text}</p>
  );
}

// ── Approval card summaries ──────────────────────────────────────────

type Item = {
  part_number?: string | null;
  serial_number?: string | null;
  qty?: number | null;
  condition?: string | null;
};

/** Readable summary of a tool call waiting for approval, instead of raw JSON. */
export function ApprovalSummary({
  toolName,
  input
}: {
  toolName: string;
  input: unknown;
}) {
  const i = (input ?? {}) as Record<string, unknown> & { items?: Item[] };
  const items = (i.items ?? []).map((it, n) => (
    <li key={n} className="font-mono">
      {it.serial_number
        ? `${it.part_number ?? ""} ${it.serial_number}`.trim()
        : `${it.qty ?? 1}× ${it.part_number}`}
      {it.condition === "damaged" ? " — damaged" : ""}
    </li>
  ));
  if (toolName === "logShipment") {
    return (
      <div className="text-sm text-kumo-default space-y-1">
        <div>
          <b>
            {i.direction === "outbound_return"
              ? "Outbound return"
              : "Inbound replacement"}
          </b>{" "}
          to <b>{String(i.site)}</b> with <b>{String(i.partner)}</b>
          {i.rma_ref ? ` (${String(i.rma_ref)})` : ""}
        </div>
        <div className="text-xs text-kumo-subtle">
          Window {clock(i.eta_window_start)} – {clock(i.eta_window_end)}
        </div>
        <ul className="text-xs list-disc pl-5">{items}</ul>
      </div>
    );
  }
  if (toolName === "recordDelivery") {
    return (
      <div className="text-sm text-kumo-default space-y-1">
        <div>
          Delivery{" "}
          {i.shipment_id ? <b>for shipment #{String(i.shipment_id)}</b> : null}
          {i.site ? ` at ${String(i.site)}` : ""}
          {i.partner ? ` by ${String(i.partner)}` : ""}
        </div>
        <ul className="text-xs list-disc pl-5">{items}</ul>
      </div>
    );
  }
  return null;
}
