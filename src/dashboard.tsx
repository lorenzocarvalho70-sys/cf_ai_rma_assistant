import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge, Button } from "@cloudflare/kumo";
import {
  ArrowCounterClockwiseIcon,
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CheckCircleIcon,
  LightbulbIcon,
  PlayIcon,
  PlusIcon,
  WarningIcon,
  XIcon
} from "@phosphor-icons/react";
import {
  ControlChart,
  Heatmap,
  Pareto,
  RateVsBaseline,
  Sparkline,
  StackedWeeks,
  TYPE_COLOR,
  TYPE_LABEL
} from "./charts";
import { band, NetworkMap, type LiveSiteStatus } from "./network-map";
import { Exceptions, Outbox, Shipments } from "./ops-panel";
import { InventorySection, type InventoryActions } from "./inventory-panel";
import { LogisticsView, type LogisticsActions } from "./logistics-panel";
import type { Analytics, DashboardState } from "./server";

export type View = "tower" | "logistics" | "kaizen" | "shipments" | "outbox";

export type DashboardActions = {
  sendDraft: (id: number) => void;
  seedDemo: () => Promise<void>;
  reset: () => Promise<void>;
  explainSignal: (key: string) => Promise<string>;
  openKaizen: (key: string, hypothesis?: string) => Promise<void>;
  advanceKaizen: (id: number) => Promise<void>;
} & InventoryActions &
  LogisticsActions;

const EMPTY: DashboardState = {
  shipments: [],
  exceptions: [],
  outbox: [],
  hourSeconds: 3600,
  analytics: null,
  inventory: null,
  logistics: []
};

function useNow(ms = 10_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

// ── Building blocks ──────────────────────────────────────────────────

function Card({
  title,
  subtitle,
  action,
  children,
  className = ""
}: {
  title?: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`viz-card p-4 ${className}`}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            {title && (
              <h2
                className="text-sm font-semibold"
                style={{ color: "var(--text-primary)" }}
              >
                {title}
              </h2>
            )}
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
      )}
      {children}
    </section>
  );
}

function SimulatedTag() {
  return (
    <span
      className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
      style={{
        border: "1px solid var(--axis)",
        color: "var(--text-secondary)"
      }}
      title="Fictional, simulated data"
    >
      Simulated
    </span>
  );
}

type Kpi = Analytics["kpis"][number];

function StatTile({ kpi }: { kpi: Kpi }) {
  const delta =
    kpi.value != null && kpi.previous != null
      ? Math.round((kpi.value - kpi.previous) * 10) / 10
      : null;
  const good =
    delta == null || delta === 0 ? null : delta > 0 === kpi.higherIsBetter;
  return (
    <div className="viz-card p-3.5 min-w-0">
      <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
        {kpi.label}
      </div>
      <div className="flex items-end justify-between gap-2 mt-1">
        <div>
          <div
            className="text-2xl font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {kpi.value ?? "–"}
            <span
              className="text-sm font-normal ml-0.5"
              style={{ color: "var(--text-secondary)" }}
            >
              {kpi.unit}
            </span>
          </div>
          {delta != null && (
            <div
              className="text-xs flex items-center gap-0.5 mt-0.5"
              style={{
                color:
                  good == null
                    ? "var(--text-secondary)"
                    : good
                      ? "var(--delta-good)"
                      : "var(--status-critical)"
              }}
            >
              {delta > 0 ? (
                <ArrowUpIcon size={11} weight="bold" />
              ) : delta < 0 ? (
                <ArrowDownIcon size={11} weight="bold" />
              ) : null}
              {delta > 0 ? "+" : ""}
              {delta}
              {kpi.unit === "%" ? " pts" : kpi.unit} vs prior 4 wks
            </div>
          )}
        </div>
        <Sparkline values={kpi.series} width={96} />
      </div>
    </div>
  );
}

const SEVERITY_CHIP = {
  critical: { label: "Critical", bg: "var(--status-critical)", ink: "#ffffff" },
  high: { label: "High", bg: "var(--status-serious)", ink: "#0b0b0b" },
  medium: { label: "Medium", bg: "var(--status-warning)", ink: "#0b0b0b" }
} as const;

function OpenExceptionsHero({ state }: { state: DashboardState }) {
  const open = state.exceptions.filter((e) => e.status !== "resolved");
  const now = Date.now();
  const overdue = open.filter(
    (e) => typeof e.due_by === "string" && new Date(e.due_by).getTime() <= now
  ).length;
  const inFlight = state.shipments.filter(
    (s) => s.status === "booked" || s.status === "code_issued"
  ).length;
  return (
    <div className="viz-card p-4 flex flex-col justify-between">
      <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
        Open exceptions · live
      </div>
      <div
        className="text-5xl font-semibold leading-none my-2"
        style={{ color: "var(--text-primary)" }}
      >
        {open.length}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(["critical", "high", "medium"] as const).map((sev) => {
          const n = open.filter((e) => e.severity === sev).length;
          if (!n) return null;
          const c = SEVERITY_CHIP[sev];
          return (
            <span
              key={sev}
              className="text-[11px] font-semibold px-1.5 py-0.5 rounded"
              style={{ background: c.bg, color: c.ink }}
            >
              {n} {c.label}
            </span>
          );
        })}
        {overdue > 0 && (
          <span
            className="text-[11px] font-semibold inline-flex items-center gap-0.5"
            style={{ color: "var(--status-critical)" }}
          >
            <WarningIcon size={12} weight="bold" /> {overdue} overdue
          </span>
        )}
      </div>
      <div className="text-xs mt-2" style={{ color: "var(--text-secondary)" }}>
        {inFlight} shipment{inFlight === 1 ? "" : "s"} awaiting delivery
      </div>
    </div>
  );
}

// ── Control tower ────────────────────────────────────────────────────

function SiteDetail({
  analytics,
  site,
  live,
  onClose
}: {
  analytics: Analytics;
  site: string;
  live: LiveSiteStatus;
  onClose: () => void;
}) {
  const s = analytics.network.sites.find((x) => x.code === site);
  if (!s) return null;
  const lanes = analytics.network.lanes
    .filter((l) => l.site === site)
    .sort((a, b) => b.rate - a.rate);
  const b = band(s.rate);
  const siteSignals = analytics.signals.filter((g) => g.segment.includes(site));
  return (
    <Card
      title={`${s.code} · ${s.name}`}
      subtitle={`${s.shipments} shipments in 12 weeks · ${s.rate}% with an exception`}
      action={
        <button
          type="button"
          onClick={onClose}
          aria-label="Clear site selection"
          style={{ color: "var(--text-secondary)" }}
        >
          <XIcon size={14} />
        </button>
      }
    >
      <div
        className="flex items-center gap-1.5 text-xs mb-3"
        style={{ color: "var(--text-secondary)" }}
      >
        <span
          className="inline-block w-2.5 h-2.5 rounded-full"
          style={{ background: b.color }}
        />
        {b.label}
        {s.topIssue && <> · top issue: {TYPE_LABEL[s.topIssue]}</>}
        {live[site]?.open ? <> · {live[site].open} open live</> : null}
      </div>
      <div
        className="text-xs font-semibold mb-1"
        style={{ color: "var(--text-primary)" }}
      >
        Inbound lanes
      </div>
      <div className="space-y-1 mb-3">
        {lanes.map((l) => (
          <div
            key={l.partner}
            className="flex items-center justify-between text-xs"
          >
            <span
              className="flex items-center gap-1.5"
              style={{ color: "var(--text-primary)" }}
            >
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: band(l.rate).color }}
              />
              {l.partner}
            </span>
            <span
              style={{
                color: "var(--text-secondary)",
                fontVariantNumeric: "tabular-nums"
              }}
            >
              {l.rate}% of {l.shipments}
            </span>
          </div>
        ))}
      </div>
      {siteSignals.length > 0 && (
        <div
          className="text-xs rounded-lg p-2"
          style={{ background: "var(--grid)", color: "var(--text-primary)" }}
        >
          <span className="font-semibold">Root-cause signal: </span>
          {siteSignals
            .map(
              (g) =>
                `${TYPE_LABEL[g.type]} on ${g.segment} (${g.rate}% vs ${g.baseline}%)`
            )
            .join("; ")}
        </div>
      )}
    </Card>
  );
}

function ControlTower({
  state,
  actions,
  now
}: {
  state: DashboardState;
  actions: DashboardActions;
  now: number;
}) {
  const [site, setSite] = useState<string | null>(null);
  const [warehouse, setWarehouse] = useState("WH-ZAZ");
  const a = state.analytics;
  const live = useMemo<LiveSiteStatus>(() => {
    const out: LiveSiteStatus = {};
    const rank = { critical: 0, high: 1, medium: 2 } as const;
    for (const e of state.exceptions) {
      if (e.status === "resolved") continue;
      const code = String(e.site);
      const sev = e.severity as keyof typeof rank;
      const cur = out[code] ?? { open: 0, worst: null };
      cur.open++;
      if (!cur.worst || rank[sev] < rank[cur.worst]) cur.worst = sev;
      out[code] = cur;
    }
    return out;
  }, [state.exceptions]);
  if (!a)
    return (
      <p className="p-6 text-sm" style={{ color: "var(--text-secondary)" }}>
        Loading analytics…
      </p>
    );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 xl:grid-cols-5">
        <div className="col-span-2 xl:col-span-1">
          <OpenExceptionsHero state={state} />
        </div>
        {a.kpis.map((k) => (
          <StatTile key={k.key} kpi={k} />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card
          title="Supply network"
          subtitle={
            <span className="inline-flex items-center gap-1.5 flex-wrap">
              Partner hubs → data center sites. Lane colour = 12-week exception
              rate; pulsing ring = open live exceptions.
              <SimulatedTag />
            </span>
          }
        >
          <NetworkMap
            data={a.network}
            live={live}
            selected={site}
            onSelect={setSite}
            warehouses={state.inventory?.warehouses ?? []}
            selectedWarehouse={warehouse}
            onSelectWarehouse={(code) => {
              setWarehouse(code);
              document
                .getElementById("inventory")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          />
        </Card>
        <div className="space-y-4 min-w-0">
          {site && (
            <SiteDetail
              analytics={a}
              site={site}
              live={live}
              onClose={() => setSite(null)}
            />
          )}
          <Card
            title={site ? `Live exceptions · ${site}` : "Live exceptions"}
            subtitle="Sorted by severity, then due time"
            action={
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<PlayIcon size={12} />}
                  onClick={() => void actions.seedDemo()}
                >
                  Load demo
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<ArrowCounterClockwiseIcon size={12} />}
                  onClick={() => void actions.reset()}
                  aria-label="Clear all live shipments, exceptions and outbox messages"
                >
                  Reset
                </Button>
              </div>
            }
          >
            <div className="max-h-[420px] overflow-y-auto pr-1">
              <Exceptions state={state} now={now} site={site} />
            </div>
          </Card>
        </div>
      </div>
      {state.inventory && (
        <div id="inventory" className="scroll-mt-4">
          <InventorySection
            inv={state.inventory}
            selected={warehouse}
            onSelect={setWarehouse}
            actions={actions}
          />
        </div>
      )}
    </div>
  );
}

// ── Kaizen ─────────────────────────────────────────────────────────────

type SignalT = Analytics["signals"][number];

function SignalCard({
  sig,
  max,
  actions
}: {
  sig: SignalT;
  max: number;
  actions: DashboardActions;
}) {
  const [hypotheses, setHypotheses] = useState<string | null>(null);
  const [busy, setBusy] = useState<"explain" | "open" | null>(null);
  const improving = sig.status === "improving";
  return (
    <div className="rounded-lg p-3" style={{ border: "1px solid var(--grid)" }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div
            className="flex items-center gap-1.5 text-xs"
            style={{ color: "var(--text-secondary)" }}
          >
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ background: TYPE_COLOR[sig.type] }}
            />
            {TYPE_LABEL[sig.type]} · {sig.dimension}
          </div>
          <div
            className="text-sm font-semibold mt-0.5"
            style={{ color: "var(--text-primary)" }}
          >
            {sig.segment}
          </div>
        </div>
        <span
          className="text-[11px] font-semibold inline-flex items-center gap-1 shrink-0"
          style={{
            color: improving ? "var(--delta-good)" : "var(--status-critical)"
          }}
        >
          {improving ? (
            <CheckCircleIcon size={13} weight="bold" />
          ) : (
            <WarningIcon size={13} weight="bold" />
          )}
          {improving ? "Improving" : "Active"}
        </span>
      </div>
      <div className="flex items-center gap-3 mt-2 flex-wrap">
        <RateVsBaseline rate={sig.rate} baseline={sig.baseline} max={max} />
        <span className="text-xs" style={{ color: "var(--text-primary)" }}>
          <b>{sig.rate}%</b> vs {sig.baseline}% elsewhere · {sig.lift}× ·{" "}
          {sig.hits}/{sig.shipments} shipments
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {sig.change
            ? `${sig.change.direction === "started" ? "Started" : "Stopped"} week of ${sig.change.weekStart}: ${sig.change.before}% → ${sig.change.after}%`
            : "Present throughout the 12 weeks"}
          {sig.recent != null && ` · last 4 wks ${sig.recent}%`} · z = {sig.z}
        </span>
        <Sparkline values={sig.series} width={90} height={22} />
      </div>
      {hypotheses && (
        <div
          className="mt-2 rounded-lg p-2.5 text-xs whitespace-pre-wrap"
          style={{ background: "var(--grid)", color: "var(--text-primary)" }}
        >
          <div className="font-semibold mb-1">
            Hypotheses from Llama 3.3: unverified, test before acting
          </div>
          {hypotheses}
        </div>
      )}
      <div className="flex gap-1.5 mt-2.5">
        <Button
          size="sm"
          variant="secondary"
          icon={<LightbulbIcon size={12} />}
          disabled={busy != null}
          onClick={async () => {
            setBusy("explain");
            try {
              setHypotheses(await actions.explainSignal(sig.key));
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy === "explain" ? "Thinking…" : "Root-cause hypotheses"}
        </Button>
        {sig.kaizenId ? (
          <Badge variant="secondary">In Kaizen log #{sig.kaizenId}</Badge>
        ) : (
          <Button
            size="sm"
            variant="primary"
            icon={<PlusIcon size={12} />}
            disabled={busy != null}
            onClick={async () => {
              setBusy("open");
              try {
                await actions.openKaizen(sig.key, hypotheses ?? undefined);
              } finally {
                setBusy(null);
              }
            }}
          >
            Open kaizen
          </Button>
        )}
      </div>
    </div>
  );
}

const STAGES = [
  { id: "plan", label: "Plan", hint: "Define problem & root cause" },
  { id: "do", label: "Do", hint: "Trial the countermeasure" },
  { id: "check", label: "Check", hint: "Did the metric move?" },
  { id: "act", label: "Act", hint: "Standardise" }
] as const;

function KaizenBoard({
  entries,
  actions
}: {
  entries: Analytics["kaizen"];
  actions: DashboardActions;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {STAGES.map((stage, i) => {
        const items = entries.filter((e) => e.stage === stage.id);
        const next = STAGES[i + 1];
        return (
          <div
            key={stage.id}
            className="rounded-lg p-2.5 min-w-0"
            style={{ background: "var(--grid)" }}
          >
            <div className="flex items-baseline justify-between mb-2 px-0.5">
              <span
                className="text-sm font-semibold"
                style={{ color: "var(--text-primary)" }}
              >
                {stage.label}
              </span>
              <span
                className="text-[11px]"
                style={{ color: "var(--text-secondary)" }}
              >
                {stage.hint}
              </span>
            </div>
            <div className="space-y-2">
              {items.length === 0 && (
                <p
                  className="text-xs px-0.5 py-3"
                  style={{ color: "var(--text-muted)" }}
                >
                  Nothing here yet.
                </p>
              )}
              {items.map((k) => (
                <div
                  key={String(k.id)}
                  className="viz-card p-2.5 text-xs space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className="font-semibold text-sm"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {String(k.title)}
                    </span>
                    {k.simulated ? <SimulatedTag /> : null}
                  </div>
                  <p style={{ color: "var(--text-secondary)" }}>
                    {String(k.problem)}
                  </p>
                  {k.root_cause && (
                    <details>
                      <summary
                        className="cursor-pointer select-none font-medium"
                        style={{ color: "var(--text-primary)" }}
                      >
                        Root cause
                      </summary>
                      <p
                        className="whitespace-pre-wrap mt-1"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {String(k.root_cause)}
                      </p>
                    </details>
                  )}
                  {k.countermeasure && (
                    <p style={{ color: "var(--text-primary)" }}>
                      <span className="font-medium">Countermeasure: </span>
                      {String(k.countermeasure)}
                    </p>
                  )}
                  {k.track && (
                    <div
                      className="flex items-center justify-between gap-2 pt-1"
                      style={{ borderTop: "1px solid var(--grid)" }}
                    >
                      <span style={{ color: "var(--text-secondary)" }}>
                        Metric: {k.track.before ?? "–"}% →{" "}
                        <b style={{ color: "var(--text-primary)" }}>
                          {k.track.recent ?? "–"}%
                        </b>{" "}
                        last 4 wks
                      </span>
                      <Sparkline
                        values={k.track.series}
                        width={70}
                        height={20}
                      />
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span style={{ color: "var(--text-muted)" }}>
                      {k.owner ? String(k.owner) : "No owner yet"}
                    </span>
                    {next && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-0.5 font-medium"
                        style={{ color: "var(--series-1)" }}
                        onClick={() => void actions.advanceKaizen(Number(k.id))}
                      >
                        Move to {next.label} <ArrowRightIcon size={11} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KaizenView({
  state,
  actions
}: {
  state: DashboardState;
  actions: DashboardActions;
}) {
  const a = state.analytics;
  if (!a)
    return (
      <p className="p-6 text-sm" style={{ color: "var(--text-secondary)" }}>
        Loading analytics…
      </p>
    );
  const flagged = a.control.points.filter((p) => p.signal);
  const maxRate = Math.max(...a.signals.map((s) => s.rate), 10);
  const liveWeek = a.weeks.at(-1)?.week ?? 12;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h1
          className="text-lg font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          Kaizen · process health
        </h1>
        <SimulatedTag />
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          12 weeks of simulated history ({a.records - a.liveRecords} shipments)
          + {a.liveRecords} finished live shipment
          {a.liveRecords === 1 ? "" : "s"}. Statistics are computed in code;
          Llama only proposes hypotheses.
        </span>
      </div>

      <div className="grid gap-3 grid-cols-2 xl:grid-cols-4">
        {a.kpis.map((k) => (
          <StatTile key={k.key} kpi={k} />
        ))}
      </div>

      <Card
        title="Is the process stable? Weekly share of shipments with an exception"
        subtitle={
          flagged.length
            ? `Special cause in ${flagged.length} week(s): ${flagged.map((p) => `${p.weekStart} (${p.signal})`).join(", ")}. Investigate those weeks.`
            : `No week outside its control limits: the network as a whole is stable at ~${a.control.centre}%. The problems sit inside specific segments, so read the root-cause signals below rather than reacting to weekly noise.`
        }
      >
        <ControlChart centre={a.control.centre} points={a.control.points} />
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card
          title="Root-cause signals"
          subtitle="Segments where an exception type is significantly above the rest of the network (z ≥ 3.5, ≥ 2× baseline), drilled down to the narrowest segment that explains it."
        >
          <div className="space-y-2.5">
            {a.signals.length === 0 && (
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                No significant segments.
              </p>
            )}
            {a.signals.map((s) => (
              <SignalCard key={s.key} sig={s} max={maxRate} actions={actions} />
            ))}
          </div>
        </Card>
        <div className="space-y-4 min-w-0">
          <Card
            title="Pareto: where exceptions come from"
            subtitle="Count · cumulative share, 12 weeks + live"
          >
            <Pareto rows={a.pareto} />
          </Card>
          <Card
            title="Missed deliveries by weekday × window start"
            subtitle="% of deliveries missed. Early windows stand out."
          >
            <Heatmap
              days={a.heatmap.days}
              hours={a.heatmap.hours}
              cells={a.heatmap.cells}
            />
          </Card>
        </div>
      </div>

      <Card
        title="Exceptions per week by type"
        subtitle="Simulated weeks, then the live week"
      >
        <StackedWeeks weeks={a.weeks} liveWeek={liveWeek} />
      </Card>

      <Card
        title="Kaizen log (PDCA)"
        subtitle="Improvement actions from Plan to Act. Each entry tracks its signal's rate: first 8 weeks → last 4 weeks."
      >
        <KaizenBoard entries={a.kaizen} actions={actions} />
      </Card>
    </div>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────

export const VIEWS: { id: View; label: string }[] = [
  { id: "tower", label: "Control tower" },
  { id: "logistics", label: "Logistics" },
  { id: "kaizen", label: "Kaizen" },
  { id: "shipments", label: "Shipments" },
  { id: "outbox", label: "Outbox" }
];

export function ViewTabs({
  view,
  onChange,
  counts
}: {
  view: View;
  onChange: (v: View) => void;
  counts: Partial<Record<View, number>>;
}) {
  return (
    <div
      className="flex gap-1 overflow-x-auto"
      role="tablist"
      aria-label="Dashboard views"
    >
      {VIEWS.map((v) => (
        <button
          key={v.id}
          role="tab"
          aria-selected={view === v.id}
          onClick={() => onChange(v.id)}
          className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
            view === v.id
              ? "bg-kumo-base text-kumo-default font-medium shadow-sm ring-1 ring-kumo-line"
              : "text-kumo-subtle hover:text-kumo-default"
          }`}
        >
          {v.label}
          {counts[v.id] ? (
            <span className="ml-1.5 text-[10px] font-bold rounded-full bg-kumo-contrast text-kumo-inverse px-1.5">
              {counts[v.id]}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function Dashboard({
  view,
  state,
  actions
}: {
  view: View;
  state: DashboardState | undefined;
  actions: DashboardActions;
}) {
  const s = state ?? EMPTY;
  const now = useNow();
  return (
    <div className="viz-root p-4 lg:p-5 max-w-[1600px] mx-auto">
      {view === "tower" && (
        <ControlTower state={s} actions={actions} now={now} />
      )}
      {view === "logistics" && (
        <LogisticsView jobs={s.logistics} actions={actions} />
      )}
      {view === "kaizen" && <KaizenView state={s} actions={actions} />}
      {view === "shipments" && (
        <Card
          title="Shipments"
          subtitle="Live shipments and where each one is in its lifecycle"
        >
          <Shipments state={s} now={now} />
        </Card>
      )}
      {view === "outbox" && (
        <Card
          title="Outbox"
          subtitle="Everything the system has sent or drafted (the audit trail). Drafts wait for Send."
        >
          <Outbox state={s} now={now} onSend={actions.sendDraft} />
        </Card>
      )}
    </div>
  );
}
