import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@cloudflare/kumo";
import {
  AirplaneTiltIcon,
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  CheckSquareIcon,
  EnvelopeSimpleIcon,
  FileTextIcon,
  RobotIcon,
  SquareIcon,
  TruckIcon,
  WarningIcon
} from "@phosphor-icons/react";
import type { JobView } from "./logistics-db";
import {
  DOC_LABEL,
  DOC_REQUIREMENTS,
  KIND_LABEL,
  type DocType,
  type Finding,
  type Kind
} from "./logistics";

export type LogisticsActions = {
  toggleTask: (taskId: number) => Promise<void>;
  setDocStatus: (docId: number, status: "draft" | "final") => Promise<void>;
  review: (jobId: number) => Promise<void>;
  requestAmendments: (jobId: number) => Promise<void>;
  simulateAmended: (jobId: number) => Promise<void>;
};

const SEV = {
  blocker: { label: "Blocker", bg: "var(--status-critical)", ink: "#ffffff" },
  major: { label: "Major", bg: "var(--status-serious)", ink: "#0b0b0b" },
  minor: { label: "Minor", bg: "var(--status-warning)", ink: "#0b0b0b" }
} as const;

function SevChip({ s }: { s: Finding["severity"] }) {
  return (
    <span
      className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0"
      style={{ background: SEV[s].bg, color: SEV[s].ink }}
    >
      {SEV[s].label}
    </span>
  );
}

function DocStatusChip({ status }: { status: "draft" | "final" | "missing" }) {
  const style =
    status === "final"
      ? { background: "var(--status-good)", color: "#ffffff" }
      : status === "draft"
        ? {
            background: "transparent",
            color: "var(--text-secondary)",
            border: "1px solid var(--axis)"
          }
        : {
            background: "transparent",
            color: "var(--status-critical)",
            border: "1px dashed var(--status-critical)"
          };
  return (
    <span
      className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
      style={style}
    >
      {status}
    </span>
  );
}

function Card({
  title,
  subtitle,
  action,
  children
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="viz-card p-4 min-w-0">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <h3
            className="text-sm font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {title}
          </h3>
          {subtitle && (
            <p
              className="text-xs mt-0.5"
              style={{ color: "var(--text-secondary)" }}
            >
              {subtitle}
            </p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const worst = (fs: Finding[]) =>
  fs.some((f) => f.severity === "blocker")
    ? "blocker"
    : fs.some((f) => f.severity === "major")
      ? "major"
      : fs.length
        ? "minor"
        : null;

function docCounts(job: JobView) {
  const req = DOC_REQUIREMENTS[job.kind].filter(
    (r) => !r.optional && job.lane >= r.fromLane
  );
  const have = req.filter((r) =>
    job.docs.some((d) => d.type === r.type)
  ).length;
  const drafts = job.docs.filter((d) => d.status === "draft").length;
  return { due: req.length, have, drafts };
}

// ── Board ─────────────────────────────────────────────────────────────

function JobCard({
  job,
  selected,
  onSelect
}: {
  job: JobView;
  selected: boolean;
  onSelect: () => void;
}) {
  const w = worst(job.findings);
  const c = docCounts(job);
  const next = job.tasks.find((t) => !t.done);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="viz-card p-2.5 text-left w-full text-xs space-y-1"
      style={
        selected ? { boxShadow: "0 0 0 2px var(--text-primary)" } : undefined
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="font-semibold text-sm"
          style={{ color: "var(--text-primary)" }}
        >
          {job.ref}
        </span>
        {w ? (
          <span
            className="inline-flex items-center gap-1 font-semibold"
            style={{ color: SEV[w].bg }}
          >
            <WarningIcon size={12} weight="bold" /> {job.findings.length}
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1 font-semibold"
            style={{ color: "var(--delta-good)" }}
          >
            <CheckCircleIcon size={12} weight="bold" /> Docs OK
          </span>
        )}
      </div>
      <div style={{ color: "var(--text-primary)" }}>
        {job.origin} → {job.destination}
      </div>
      <div style={{ color: "var(--text-secondary)" }}>
        {job.forwarder}
        {job.rmaShipmentId ? ` · RMA #${job.rmaShipmentId}` : ""}
      </div>
      <div style={{ color: "var(--text-secondary)" }}>
        Docs {c.have}/{c.due} due{c.drafts ? ` · ${c.drafts} draft` : ""}
      </div>
      {next && (
        <div
          className="truncate"
          style={{ color: "var(--text-muted)" }}
          title={next.title}
        >
          Next: {next.title}
        </div>
      )}
    </button>
  );
}

function Board({
  jobs,
  kind,
  selected,
  onSelect
}: {
  jobs: JobView[];
  kind: Kind;
  selected: number | null;
  onSelect: (id: number) => void;
}) {
  const lanes = jobs[0]?.lanes ?? [];
  const byLane = (i: number) => jobs.filter((j) => j.lane === i + 1);
  if (jobs.length === 0) {
    return (
      <p
        className="text-sm py-6 text-center"
        style={{ color: "var(--text-secondary)" }}
      >
        No {KIND_LABEL[kind].toLowerCase()} jobs.
      </p>
    );
  }
  return (
    <div className="flex gap-2.5 overflow-x-auto pb-1">
      {lanes.map((lane, i) => (
        <div
          key={lane}
          className="rounded-lg p-2 min-w-[200px] flex-1"
          style={{ background: "var(--grid)" }}
        >
          <div className="flex items-baseline justify-between mb-2 px-0.5">
            <span
              className="text-xs font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              {i + 1} · {lane}
            </span>
            <span
              className="text-[11px]"
              style={{ color: "var(--text-secondary)" }}
            >
              {byLane(i).length}
            </span>
          </div>
          <div className="space-y-2">
            {byLane(i).map((j) => (
              <JobCard
                key={j.id}
                job={j}
                selected={selected === j.id}
                onSelect={() => onSelect(j.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Document viewer ─────────────────────────────────────────────────────

type Fields = Record<string, unknown>;
const P = (p: unknown) => {
  const x = p as { name: string; address: string; country: string };
  return x ? `${x.name}, ${x.address}, ${x.country}` : "";
};

function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt style={{ color: "var(--text-secondary)" }}>{k}</dt>
          <dd style={{ color: "var(--text-primary)" }}>{v || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <table
      className="w-full text-xs mt-2"
      style={{
        fontVariantNumeric: "tabular-nums",
        color: "var(--text-primary)"
      }}
    >
      <thead style={{ color: "var(--text-secondary)" }}>
        <tr>
          {head.map((h) => (
            <th key={h} className="text-left font-medium py-1 pr-2">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} style={{ borderTop: "1px solid var(--grid)" }}>
            {r.map((c, k) => (
              <td key={k} className="py-1 pr-2">
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DocBody({ type, f }: { type: DocType; f: Fields }) {
  switch (type) {
    case "COMMERCIAL_INVOICE": {
      const lines = f.lines as {
        sku: string;
        description: string;
        hs: string;
        origin: string;
        qty: number;
        unitPrice: number;
      }[];
      return (
        <>
          <KV
            rows={[
              ["Invoice no", String(f.number)],
              ["Date", String(f.date)],
              ["Shipper", P(f.shipper)],
              ["Consignee", P(f.consignee)],
              ["Incoterm", String(f.incoterm)],
              ["Export control", String(f.exportControl ?? "")],
              ["Signed", String(f.signedBy ?? "")]
            ]}
          />
          <Table
            head={[
              "SKU",
              "Description",
              "HS",
              "Origin",
              "Qty",
              "Unit",
              "Amount"
            ]}
            rows={lines.map((l) => [
              l.sku,
              l.description,
              l.hs,
              l.origin,
              l.qty,
              l.unitPrice.toLocaleString("en-GB"),
              (l.qty * l.unitPrice).toLocaleString("en-GB")
            ])}
          />
          <div
            className="text-right text-xs font-semibold mt-1"
            style={{ color: "var(--text-primary)" }}
          >
            Total {String(f.currency)} {Number(f.total).toLocaleString("en-GB")}
          </div>
        </>
      );
    }
    case "PACKING_LIST": {
      const pieces = f.pieces as {
        no: number;
        l: number;
        w: number;
        h: number;
        grossKg: number;
        contents: string;
      }[];
      return (
        <>
          <KV
            rows={[
              ["Packing list no", String(f.number)],
              ["Date", String(f.date)],
              ["Shipper", P(f.shipper)],
              ["Consignee", P(f.consignee)]
            ]}
          />
          <Table
            head={["Piece", "Dimensions (cm)", "Gross kg", "Contents"]}
            rows={pieces.map((p) => [
              p.no,
              `${p.l}×${p.w}×${p.h}`,
              p.grossKg,
              p.contents
            ])}
          />
          <div
            className="text-right text-xs font-semibold mt-1"
            style={{ color: "var(--text-primary)" }}
          >
            {String(f.totalPieces)} pieces · {String(f.totalGrossKg)} kg gross
          </div>
        </>
      );
    }
    case "AIR_WAYBILL":
      return (
        <KV
          rows={[
            [
              "AWB no",
              <span key="awb" className="font-mono">
                {String(f.number)}
              </span>
            ],
            [
              "Route",
              `${String(f.origin)} → ${String(f.destination)} · flight ${String(f.flight)}`
            ],
            ["Date", String(f.date)],
            ["Shipper", P(f.shipper)],
            ["Consignee", P(f.consignee)],
            ["Pieces", String(f.pieces)],
            ["Gross weight", `${String(f.grossKg)} kg`],
            ["Chargeable weight", `${String(f.chargeableKg)} kg`],
            ["Nature of goods", String(f.natureOfGoods)],
            ["Handling information", String(f.handling)]
          ]}
        />
      );
    case "DELIVERY_NOTE": {
      const lines = f.lines as {
        sku: string;
        description: string;
        qty: number;
      }[];
      return (
        <>
          <KV
            rows={[
              ["Delivery note", String(f.number)],
              ["Date", String(f.date)],
              ["From", String(f.from)],
              ["To", String(f.to)]
            ]}
          />
          <Table
            head={["SKU", "Description", "Qty"]}
            rows={lines.map((l) => [l.sku, l.description, l.qty])}
          />
        </>
      );
    }
    default:
      return (
        <KV
          rows={Object.entries(f).map(([k, v]) => [
            k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
            Array.isArray(v)
              ? v.join(", ")
              : typeof v === "number"
                ? v.toLocaleString("en-GB")
                : String(v ?? "")
          ])}
        />
      );
  }
}

// ── Job detail ─────────────────────────────────────────────────────────────

function JobDetail({
  job,
  actions
}: {
  job: JobView;
  actions: LogisticsActions;
}) {
  const [viewing, setViewing] = useState<DocType | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = (key: string, fn: () => Promise<void>) => async () => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };
  const flagged = new Set(job.findings.flatMap((f) => f.docs));
  const slots = DOC_REQUIREMENTS[job.kind];
  const doc = viewing ? job.docs.find((d) => d.type === viewing) : undefined;
  const reviewFresh =
    job.review &&
    JSON.stringify(job.review.findings) === JSON.stringify(job.findings);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2
          className="text-base font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          {job.ref}
        </h2>
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {KIND_LABEL[job.kind]} · {job.origin} → {job.destination} ·{" "}
          {job.forwarder}
          {job.incoterm ? ` · ${job.incoterm}` : ""} · stage {job.lane}:{" "}
          <b style={{ color: "var(--text-primary)" }}>{job.laneLabel}</b>
          {job.rmaShipmentId
            ? ` · linked to RMA shipment #${job.rmaShipmentId}`
            : ""}
        </span>
        {job.simulated && (
          <span
            className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded"
            style={{
              border: "1px solid var(--axis)",
              color: "var(--text-secondary)"
            }}
          >
            Simulated
          </span>
        )}
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)_minmax(0,1.2fr)]">
        <Card
          title="Tasks"
          subtitle="The job moves lane when a lane's tasks are done"
        >
          <div className="space-y-2.5">
            {job.lanes.map((lane, i) => {
              const ts = job.tasks.filter((t) => t.lane === i + 1);
              if (!ts.length) return null;
              return (
                <div key={lane}>
                  <div
                    className="text-[11px] font-semibold mb-1"
                    style={{
                      color:
                        i + 1 === job.lane
                          ? "var(--text-primary)"
                          : "var(--text-muted)"
                    }}
                  >
                    {i + 1} · {lane}
                  </div>
                  {ts.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => void actions.toggleTask(t.id)}
                      className="flex items-start gap-1.5 text-xs text-left w-full py-0.5"
                      style={{
                        color: t.done
                          ? "var(--text-muted)"
                          : "var(--text-primary)"
                      }}
                    >
                      {t.done ? (
                        <CheckSquareIcon
                          size={15}
                          weight="fill"
                          style={{ color: "var(--status-good)" }}
                        />
                      ) : (
                        <SquareIcon size={15} />
                      )}
                      <span
                        style={{
                          textDecoration: t.done ? "line-through" : undefined
                        }}
                      >
                        {t.title}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </Card>

        <Card
          title="Document warehouse"
          subtitle="Air-freight set for this job; click a document to open it"
        >
          <div className="space-y-1.5">
            {slots.map((slot) => {
              const d = job.docs.find((x) => x.type === slot.type);
              const due = job.lane >= slot.fromLane;
              return (
                <div
                  key={slot.type}
                  className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5"
                  style={{
                    border: `1px solid ${flagged.has(slot.type) ? "var(--status-serious)" : "var(--grid)"}`,
                    background:
                      viewing === slot.type ? "var(--grid)" : undefined
                  }}
                >
                  <button
                    type="button"
                    disabled={!d}
                    onClick={() =>
                      setViewing(viewing === slot.type ? null : slot.type)
                    }
                    className="flex items-center gap-1.5 text-xs text-left min-w-0"
                    style={{
                      color: d ? "var(--text-primary)" : "var(--text-muted)"
                    }}
                  >
                    <FileTextIcon size={14} />
                    <span className="truncate">
                      {DOC_LABEL[slot.type]}
                      {slot.optional ? " (optional)" : ""}
                      {d
                        ? ` · v${d.version}`
                        : due
                          ? ""
                          : ` · due at stage ${slot.fromLane}`}
                    </span>
                    {flagged.has(slot.type) && (
                      <WarningIcon
                        size={12}
                        weight="bold"
                        style={{ color: "var(--status-serious)" }}
                      />
                    )}
                  </button>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {d ? (
                      <DocStatusChip status={d.status} />
                    ) : due && !slot.optional ? (
                      <DocStatusChip status="missing" />
                    ) : (
                      <span
                        className="text-[10px] uppercase"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {slot.optional ? "optional" : "not due"}
                      </span>
                    )}
                    {d?.status === "draft" && (
                      <button
                        type="button"
                        className="text-[11px] font-medium"
                        style={{ color: "var(--series-1)" }}
                        onClick={() => void actions.setDocStatus(d.id, "final")}
                      >
                        Approve final
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {doc && (
            <div
              className="mt-3 rounded-lg p-3"
              style={{ border: "1px solid var(--axis)" }}
            >
              <div className="flex items-center justify-between mb-2">
                <span
                  className="text-xs font-semibold uppercase tracking-wide"
                  style={{ color: "var(--text-primary)" }}
                >
                  {DOC_LABEL[doc.type]}
                </span>
                <span
                  className="text-[11px]"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {doc.status} · v{doc.version}
                </span>
              </div>
              <DocBody type={doc.type} f={doc.fields as Fields} />
            </div>
          )}
        </Card>

        <Card
          title="Document review"
          subtitle="Rule checks run in code on every change; the AI review is advisory"
          action={
            <Button
              size="sm"
              variant="primary"
              icon={<RobotIcon size={12} />}
              disabled={busy != null}
              onClick={run("review", () => actions.review(job.id))}
            >
              {busy === "review" ? "Reviewing…" : "AI review"}
            </Button>
          }
        >
          {job.findings.length === 0 ? (
            <p
              className="text-xs flex items-center gap-1.5"
              style={{ color: "var(--delta-good)" }}
            >
              <CheckCircleIcon size={14} weight="bold" /> No discrepancies: the
              set is consistent for this stage.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {job.findings.map((f, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-xs"
                  style={{ color: "var(--text-primary)" }}
                >
                  <SevChip s={f.severity} />
                  <span>
                    {f.message}
                    <span style={{ color: "var(--text-muted)" }}>
                      {" "}
                      · {f.docs.map((d) => DOC_LABEL[d]).join(", ")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {job.review?.aiText && (
            <div
              className="mt-3 rounded-lg p-2.5 text-xs whitespace-pre-wrap"
              style={{
                background: "var(--grid)",
                color: "var(--text-primary)"
              }}
            >
              <div className="font-semibold mb-1 flex items-center gap-1">
                <RobotIcon size={13} /> Llama 3.3 review (advisory)
                <span
                  className="font-normal"
                  style={{ color: "var(--text-secondary)" }}
                >
                  ·{" "}
                  {new Date(job.review.runAt).toLocaleString(undefined, {
                    dateStyle: "short",
                    timeStyle: "short"
                  })}
                  {reviewFresh ? "" : " · documents changed since; run again"}
                </span>
              </div>
              {job.review.aiText}
            </div>
          )}

          <div className="flex flex-wrap gap-1.5 mt-3">
            <Button
              size="sm"
              variant="secondary"
              icon={<EnvelopeSimpleIcon size={12} />}
              disabled={
                busy != null ||
                job.findings.every((f) => f.rule === "STILL_DRAFT")
              }
              onClick={run("amend", () => actions.requestAmendments(job.id))}
            >
              Request amendments
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<ArrowsClockwiseIcon size={12} />}
              disabled={
                busy != null ||
                job.findings.every(
                  (f) => f.rule === "STILL_DRAFT" || f.rule === "MISSING"
                )
              }
              onClick={run("sim", () => actions.simulateAmended(job.id))}
              title="Demo: the forwarder's corrected drafts arrive"
            >
              Simulate amended drafts
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── View ─────────────────────────────────────────────────────────────────

const KIND_ICON: Record<Kind, ReactNode> = {
  final_mile: <TruckIcon size={14} />,
  export: <AirplaneTiltIcon size={14} />,
  import: <AirplaneTiltIcon size={14} style={{ transform: "scaleX(-1)" }} />
};

export function LogisticsView({
  jobs,
  actions
}: {
  jobs: JobView[];
  actions: LogisticsActions;
}) {
  const [kind, setKind] = useState<Kind>("export");
  const [selected, setSelected] = useState<number | null>(null);
  const ofKind = useMemo(
    () => jobs.filter((j) => j.kind === kind),
    [jobs, kind]
  );
  const job =
    ofKind.find((j) => j.id === selected) ??
    ofKind.find((j) => j.findings.length > 0) ??
    ofKind[0];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h1
          className="text-lg font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          Logistics · air freight
        </h1>
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Final-mile deliveries, exports and imports each run their own tasks
          and document set. Simulated jobs use fictional companies and values.
        </span>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {(["final_mile", "export", "import"] as const).map((k) => {
          const js = jobs.filter((j) => j.kind === k);
          const issues = js.filter((j) => j.findings.length > 0).length;
          return (
            <button
              key={k}
              type="button"
              onClick={() => {
                setKind(k);
                setSelected(null);
              }}
              aria-pressed={kind === k}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm"
              style={{
                background:
                  kind === k ? "var(--text-primary)" : "var(--surface-1)",
                color: kind === k ? "var(--surface-1)" : "var(--text-primary)",
                border: "1px solid var(--grid)"
              }}
            >
              {KIND_ICON[k]} {KIND_LABEL[k]}{" "}
              <span style={{ opacity: 0.7 }}>{js.length}</span>
              {issues > 0 && (
                <span
                  className="text-[10px] font-bold rounded-full px-1.5"
                  style={{
                    background: "var(--status-critical)",
                    color: "#ffffff"
                  }}
                >
                  {issues} with issues
                </span>
              )}
            </button>
          );
        })}
      </div>

      <Card
        title={`${KIND_LABEL[kind]} board`}
        subtitle="Click a job to open its tasks, documents and review"
      >
        <Board
          jobs={ofKind}
          kind={kind}
          selected={job?.id ?? null}
          onSelect={setSelected}
        />
      </Card>

      {job && <JobDetail key={job.id} job={job} actions={actions} />}
    </div>
  );
}
