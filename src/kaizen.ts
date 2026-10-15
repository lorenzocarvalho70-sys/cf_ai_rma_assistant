// Process-health analytics for the Kaizen view. Plain statistics only: the
// LLM may later *explain* a signal, but it never finds or ranks them.

import {
  SEVERITY_RANK,
  type ExceptionType,
  type Severity
} from "./reconcile.ts";
import { PARTNERS, SITES } from "./shipments.ts";
import { SIM_WEEKS, weekStartOf, type ProcessRecord } from "./sim.ts";

export const EXCEPTION_TYPES: ExceptionType[] = [
  "DAMAGED_IN_TRANSIT",
  "MISSED_DELIVERY",
  "SERIAL_MISMATCH",
  "QTY_VARIANCE",
  "SHORT_SHIPMENT",
  "UNEXPECTED_ITEM",
  "ACCESS_VIOLATION"
];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const round = (x: number, dp = 1) => Math.round(x * 10 ** dp) / 10 ** dp;
const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

export function windowBand(hour: number) {
  return hour < 8 ? "before 08:00" : hour >= 16 ? "after 16:00" : "08:00–16:00";
}

const hasException = (r: ProcessRecord) => r.exceptions.length > 0;
const hasType = (t: ExceptionType) => (r: ProcessRecord) =>
  r.exceptions.some((e) => e.type === t);

// ---- Weekly series and KPIs -------------------------------------------------

export type WeekStats = {
  week: number;
  weekStart: string;
  shipments: number;
  withException: number;
  byType: Record<ExceptionType, number>;
  /** Share of shipments reconciled clean first time, % */
  firstTimeRight: number | null;
  /** Share of shipments delivered in their window, % */
  onTime: number | null;
  /** Mean hours to resolve exceptions closed that week */
  mttrHours: number | null;
  /** Share of resolved exceptions that breached their SLA, % */
  slaBreach: number | null;
};

export function weekly(records: ProcessRecord[], now: Date): WeekStats[] {
  const out: WeekStats[] = [];
  for (let week = 0; week <= SIM_WEEKS; week++) {
    const rs = records.filter((r) => r.week === week);
    const byType = Object.fromEntries(
      EXCEPTION_TYPES.map((t) => [t, 0])
    ) as Record<ExceptionType, number>;
    for (const r of rs) for (const e of r.exceptions) byType[e.type]++;
    const resolved = rs
      .flatMap((r) => r.exceptions)
      .filter((e) => e.resolveHours != null);
    const n = rs.length;
    out.push({
      week,
      weekStart: weekStartOf(week, now).toISOString().slice(0, 10),
      shipments: n,
      withException: rs.filter(hasException).length,
      byType,
      firstTimeRight: n
        ? round((100 * rs.filter((r) => !hasException(r)).length) / n)
        : null,
      onTime: n
        ? round(
            (100 * rs.filter((r) => !hasType("MISSED_DELIVERY")(r)).length) / n
          )
        : null,
      mttrHours: resolved.length
        ? round(mean(resolved.map((e) => e.resolveHours!))!)
        : null,
      slaBreach: resolved.length
        ? round(
            (100 * resolved.filter((e) => e.slaBreached).length) /
              resolved.length
          )
        : null
    });
  }
  return out;
}

export type Kpi = {
  key: "onTime" | "firstTimeRight" | "mttrHours" | "slaBreach";
  label: string;
  unit: "%" | "h";
  /** Last 4 complete weeks */
  value: number | null;
  /** Previous 4 weeks, for the delta */
  previous: number | null;
  higherIsBetter: boolean;
  series: (number | null)[];
};

/** KPIs over complete weeks only; the live week is too partial to compare. */
export function kpis(weeks: WeekStats[]): Kpi[] {
  const complete = weeks.filter((w) => w.week < SIM_WEEKS);
  const last = complete.slice(-4);
  const prev = complete.slice(-8, -4);
  const avg = (ws: WeekStats[], k: Kpi["key"]) => {
    const m = mean(ws.map((w) => w[k]).filter((v): v is number => v != null));
    return m == null ? null : round(m);
  };
  const defs: Omit<Kpi, "value" | "previous" | "series">[] = [
    {
      key: "onTime",
      label: "On-time delivery",
      unit: "%",
      higherIsBetter: true
    },
    {
      key: "firstTimeRight",
      label: "First-time-right",
      unit: "%",
      higherIsBetter: true
    },
    {
      key: "mttrHours",
      label: "Mean time to resolve",
      unit: "h",
      higherIsBetter: false
    },
    {
      key: "slaBreach",
      label: "SLA breaches",
      unit: "%",
      higherIsBetter: false
    }
  ];
  return defs.map((d) => ({
    ...d,
    value: avg(last, d.key),
    previous: avg(prev, d.key),
    series: complete.map((w) => w[d.key])
  }));
}

// ---- Control chart (p-chart of shipments with ≥1 exception) ---------------

export type ControlPoint = {
  week: number;
  weekStart: string;
  n: number;
  p: number | null;
  ucl: number | null;
  lcl: number | null;
  signal: "above UCL" | "below LCL" | "run above centre" | null;
};

export function controlChart(weeks: WeekStats[]) {
  const complete = weeks.filter((w) => w.week < SIM_WEEKS && w.shipments > 0);
  const total = complete.reduce((a, w) => a + w.shipments, 0);
  const defects = complete.reduce((a, w) => a + w.withException, 0);
  const pBar = total ? defects / total : 0;

  const points: ControlPoint[] = complete.map((w) => {
    const p = w.withException / w.shipments;
    const sigma = Math.sqrt((pBar * (1 - pBar)) / w.shipments);
    const ucl = Math.min(1, pBar + 3 * sigma);
    const lcl = Math.max(0, pBar - 3 * sigma);
    return {
      week: w.week,
      weekStart: w.weekStart,
      n: w.shipments,
      p: round(100 * p),
      ucl: round(100 * ucl),
      lcl: round(100 * lcl),
      signal: p > ucl ? "above UCL" : p < lcl ? "below LCL" : null
    };
  });

  // Western Electric rule 2: 7+ consecutive points above the centre line.
  let run: ControlPoint[] = [];
  for (const pt of points) {
    if (pt.p != null && pt.p > 100 * pBar) {
      run.push(pt);
      if (run.length >= 7) for (const r of run) r.signal ??= "run above centre";
    } else {
      run = [];
    }
  }
  return { centre: round(100 * pBar), points };
}

// ---- Pareto -------------------------------------------------------------------

export function pareto(records: ProcessRecord[]) {
  const counts = new Map<ExceptionType, number>();
  for (const r of records)
    for (const e of r.exceptions)
      counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  let cum = 0;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => {
      cum += count;
      return {
        type,
        count,
        share: round((100 * count) / total),
        cumShare: round((100 * cum) / total)
      };
    });
}

// ---- Root-cause signals ---------------------------------------------------------

type Dimension = {
  name: string;
  label: string;
  of: (r: ProcessRecord) => string;
};

const DIMENSIONS: Dimension[] = [
  { name: "lane", label: "Lane", of: (r) => `${r.partner} → ${r.site}` },
  { name: "partner", label: "Partner", of: (r) => r.partner },
  { name: "site", label: "Site", of: (r) => r.site },
  { name: "part", label: "Part", of: (r) => r.part },
  { name: "window", label: "Window", of: (r) => windowBand(r.windowHour) },
  {
    name: "partner-window",
    label: "Partner × window",
    of: (r) => `${r.partner} · ${windowBand(r.windowHour)}`
  },
  { name: "weekday", label: "Weekday", of: (r) => WEEKDAYS[r.weekday] }
];

export type Signal = {
  key: string;
  type: ExceptionType;
  dimension: string;
  segment: string;
  shipments: number;
  hits: number;
  /** % of segment shipments with this exception type */
  rate: number;
  /** % in all other shipments */
  baseline: number;
  lift: number;
  z: number;
  /** Exceptions above what the baseline rate would predict */
  excess: number;
  /** When the rate changed, if it did */
  change: {
    direction: "started" | "stopped";
    weekStart: string;
    before: number;
    after: number;
  } | null;
  /** % in the last 4 complete weeks */
  recent: number | null;
  status: "active" | "improving";
};

/** Two-proportion z-test. */
function zScore(x1: number, n1: number, x2: number, n2: number) {
  const p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  return se === 0 ? 0 : (x1 / n1 - x2 / n2) / se;
}

/** Finds the week split that best separates a low and a high period. */
function changePoint(
  seg: ProcessRecord[],
  hit: (r: ProcessRecord) => boolean,
  now: Date
) {
  let best: Signal["change"] = null;
  let bestGap = 0;
  for (let k = 2; k <= SIM_WEEKS - 2; k++) {
    const a = seg.filter((r) => r.week < k);
    const b = seg.filter((r) => r.week >= k && r.week < SIM_WEEKS);
    if (a.length < 8 || b.length < 8) continue;
    const ra = a.filter(hit).length / a.length;
    const rb = b.filter(hit).length / b.length;
    const z = Math.abs(
      zScore(a.filter(hit).length, a.length, b.filter(hit).length, b.length)
    );
    const gap = Math.abs(rb - ra);
    // The segment is already significant overall, so a one-sided 95% bar suffices here.
    if (
      z >= 1.65 &&
      gap > bestGap &&
      Math.max(ra, rb) >= 3 * Math.max(Math.min(ra, rb), 0.01)
    ) {
      bestGap = gap;
      best = {
        direction: rb > ra ? "started" : "stopped",
        weekStart: weekStartOf(k, now).toISOString().slice(0, 10),
        before: round(100 * ra),
        after: round(100 * rb)
      };
    }
  }
  return best;
}

const MIN_SEGMENT = 20;
const MIN_HITS = 5;
// ~300 segment × type tests per run; z ≥ 3.5 keeps false alarms rare (Bonferroni-ish).
const MIN_Z = 3.5;
const MIN_LIFT = 2;
/** A broader segment is dropped when a stronger signal already holds this share of its hits. */
const EXPLAINED_SHARE = 0.6;
/** A narrower segment replaces a broad one when it holds this share of the broad one's hits. */
const REFINE_SHARE = 0.7;

export function signals(
  records: ProcessRecord[],
  now: Date,
  limit = 8
): Signal[] {
  const candidates: (Signal & { hitIds: Set<string> })[] = [];

  for (const type of EXCEPTION_TYPES) {
    const hit = hasType(type);
    for (const dim of DIMENSIONS) {
      const groups = new Map<string, ProcessRecord[]>();
      for (const r of records) {
        const k = dim.of(r);
        groups.set(k, [...(groups.get(k) ?? []), r]);
      }
      for (const [segment, seg] of groups) {
        const hits = seg.filter(hit);
        if (seg.length < MIN_SEGMENT || hits.length < MIN_HITS) continue;
        const restN = records.length - seg.length;
        const restX = records.filter(hit).length - hits.length;
        if (restN === 0) continue;
        const rate = hits.length / seg.length;
        const baseline = restX / restN;
        const z = zScore(hits.length, seg.length, restX, restN);
        const lift = baseline > 0 ? rate / baseline : Infinity;
        if (z < MIN_Z || lift < MIN_LIFT) continue;

        const recentRecs = seg.filter(
          (r) => r.week >= SIM_WEEKS - 4 && r.week < SIM_WEEKS
        );
        const recent = recentRecs.length
          ? round((100 * recentRecs.filter(hit).length) / recentRecs.length)
          : null;
        const change = changePoint(seg, hit, now);
        candidates.push({
          key: `${type}|${dim.name}=${segment}`,
          type,
          dimension: dim.label,
          segment,
          shipments: seg.length,
          hits: hits.length,
          rate: round(100 * rate),
          baseline: round(100 * baseline),
          lift: Number.isFinite(lift) ? round(lift) : 99,
          z: round(z),
          excess: round(hits.length - seg.length * baseline),
          change,
          recent,
          status:
            change?.direction === "stopped" ||
            (recent != null && recent < (100 * rate) / 3)
              ? "improving"
              : "active",
          hitIds: new Set(hits.map((r) => r.id))
        });
      }
    }
  }

  // Strongest first; skip segments whose hits a stronger signal already explains
  // (e.g. "Partner: FastFreight" when "Lane: FastFreight → LIS-01" holds most of them).
  candidates.sort((a, b) => b.excess - a.excess || b.z - a.z);
  const overlap = (a: Set<string>, b: Set<string>) => {
    let n = 0;
    for (const id of a) if (b.has(id)) n++;
    return n;
  };
  // Drill down: report "Nimbus · before 08:00" rather than "before 08:00" when
  // the narrower segment holds most of the broad one's hits.
  const refine = (c: (typeof candidates)[number]) =>
    candidates
      .filter(
        (r) =>
          r.type === c.type &&
          r.shipments < c.shipments &&
          overlap(r.hitIds, c.hitIds) / c.hitIds.size >= REFINE_SHARE
      )
      .sort((a, b) => b.rate - a.rate)[0] ?? c;

  const kept: typeof candidates = [];
  for (const candidate of candidates) {
    const c = refine(candidate);
    if (kept.some((k) => k.key === c.key)) continue;
    const explained = kept.some((k) => {
      if (k.type !== c.type) return false;
      return overlap(c.hitIds, k.hitIds) / c.hitIds.size >= EXPLAINED_SHARE;
    });
    if (!explained) kept.push(c);
  }
  return kept.slice(0, limit).map(({ hitIds: _hitIds, ...s }) => s);
}

// ---- Heatmap: missed deliveries by weekday × window hour ----------------------

export function missedHeatmap(records: ProcessRecord[]) {
  const hours = [...new Set(records.map((r) => r.windowHour))].sort(
    (a, b) => a - b
  );
  const days = [0, 1, 2, 3, 4];
  return {
    hours,
    days: days.map((d) => WEEKDAYS[d]),
    cells: days.flatMap((d) =>
      hours.map((h) => {
        const rs = records.filter((r) => r.weekday === d && r.windowHour === h);
        const missed = rs.filter(hasType("MISSED_DELIVERY")).length;
        return {
          day: WEEKDAYS[d],
          hour: h,
          n: rs.length,
          rate: rs.length ? round((100 * missed) / rs.length) : null
        };
      })
    )
  };
}

// ---- Network view for the map ----------------------------------------------------

export function network(records: ProcessRecord[]) {
  const rate = (rs: ProcessRecord[]) =>
    rs.length ? round((100 * rs.filter(hasException).length) / rs.length) : 0;
  const topType = (rs: ProcessRecord[]) => {
    const c = new Map<ExceptionType, number>();
    for (const r of rs)
      for (const e of r.exceptions) c.set(e.type, (c.get(e.type) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  return {
    sites: SITES.map((s) => {
      const rs = records.filter((r) => r.site === s.code);
      return {
        code: s.code,
        name: s.name,
        lat: s.lat,
        lng: s.lng,
        shipments: rs.length,
        rate: rate(rs),
        topIssue: topType(rs)
      };
    }),
    hubs: PARTNERS.map((p) => ({
      partner: p.name,
      city: p.hub.city,
      lat: p.hub.lat,
      lng: p.hub.lng
    })),
    lanes: PARTNERS.flatMap((p) =>
      p.sites.map((code) => {
        const rs = records.filter(
          (r) => r.partner === p.name && r.site === code
        );
        return {
          partner: p.name,
          site: code,
          shipments: rs.length,
          rate: rate(rs),
          topIssue: topType(rs)
        };
      })
    )
  };
}

/** Worst severity among a list, for map rings and badges. */
export function worstSeverity(severities: string[]): Severity | null {
  const known = severities.filter((s): s is Severity => s in SEVERITY_RANK);
  return known.sort((a, b) => SEVERITY_RANK[a] - SEVERITY_RANK[b])[0] ?? null;
}

// ---- Signal follow-up: tracking, context for hypotheses, kaizen seeds ----------

/** Parses "TYPE|dimension=segment" back into its parts. */
export function parseSignalKey(key: string) {
  const [type, rest = ""] = key.split("|");
  const eq = rest.indexOf("=");
  return {
    type: type as ExceptionType,
    dimension: rest.slice(0, eq),
    segment: rest.slice(eq + 1)
  };
}

function segmentOf(records: ProcessRecord[], key: string) {
  const { type, dimension, segment } = parseSignalKey(key);
  const dim = DIMENSIONS.find((d) => d.name === dimension);
  if (!dim) return null;
  return {
    type,
    dim,
    records: records.filter((r) => dim.of(r) === segment),
    hit: hasType(type)
  };
}

/**
 * The tracked metric for a kaizen entry: the segment's rate for the first
 * 8 weeks vs the last 4 complete weeks, so Check can see if it worked.
 */
export function trackSignal(records: ProcessRecord[], key: string) {
  const s = segmentOf(records, key);
  if (!s) return null;
  const pct = (rs: ProcessRecord[]) =>
    rs.length ? round((100 * rs.filter(s.hit).length) / rs.length) : null;
  const recentFrom = SIM_WEEKS - 4;
  return {
    before: pct(s.records.filter((r) => r.week < recentFrom)),
    recent: pct(
      s.records.filter((r) => r.week >= recentFrom && r.week < SIM_WEEKS)
    ),
    series: Array.from({ length: SIM_WEEKS }, (_, w) =>
      pct(s.records.filter((r) => r.week === w))
    )
  };
}

/** How the signal's hits are spread over other dimensions: the facts behind any hypothesis. */
export function signalContext(records: ProcessRecord[], key: string) {
  const s = segmentOf(records, key);
  if (!s) return null;
  const hits = s.records.filter(s.hit);
  const spread = (of: (r: ProcessRecord) => string) => {
    const c = new Map<string, { hits: number; n: number }>();
    for (const r of s.records) {
      const k = of(r);
      const v = c.get(k) ?? { hits: 0, n: 0 };
      v.n++;
      if (s.hit(r)) v.hits++;
      c.set(k, v);
    }
    return [...c.entries()]
      .map(([value, v]) => ({
        value,
        hits: v.hits,
        shipments: v.n,
        rate: round((100 * v.hits) / v.n)
      }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 5);
  };
  return {
    hits: hits.length,
    shipments: s.records.length,
    byPart: spread((r) => r.part),
    byPartner: spread((r) => r.partner),
    bySite: spread((r) => r.site),
    byWindow: spread((r) => windowBand(r.windowHour)),
    byWeekday: spread((r) => WEEKDAYS[r.weekday]),
    byWeek: spread((r) => `week ${r.week + 1}`)
  };
}

export function describeSignal(s: Signal) {
  const label = s.type.replaceAll("_", " ").toLowerCase();
  return {
    title: `${s.segment}: ${label}`,
    problem:
      `${s.type} on ${s.rate}% of shipments in ${s.dimension.toLowerCase()} "${s.segment}" vs ${s.baseline}% elsewhere ` +
      `(${s.lift}×, z=${s.z}, ${s.hits} of ${s.shipments} shipments)` +
      (s.change
        ? `; ${s.change.direction} week of ${s.change.weekStart} (${s.change.before}% → ${s.change.after}%)`
        : "") +
      "."
  };
}

/** Simulated kaizen entries that match the planted history (fictional). */
export function seedKaizen(now: Date) {
  const at = (w: number) => weekStartOf(w, now).toISOString();
  return [
    {
      title: "DUB-03 goods-in: serial mismatches",
      problem:
        "SERIAL_MISMATCH on ~14% of DUB-03 receipts in weeks 1–8, against under 1% at other sites.",
      root_cause:
        "5 Whys: serials keyed by hand from paper packing lists → no scanner at goods-in → DUB-03 missed the 2025 scanner rollout.",
      countermeasure:
        "Handheld barcode scanning with a scan-to-manifest check at receipt; paper keying stopped.",
      owner: "DUB-03 site lead",
      stage: "act" as const,
      signal_key: "SERIAL_MISMATCH|site=DUB-03",
      opened_at: at(7)
    },
    {
      title: "Nimbus no-shows on early windows",
      problem:
        "Nimbus Logistics misses about a third of delivery windows that open before 08:00.",
      root_cause:
        "Rotterdam hub driver shifts start 07:30, so early windows can't be reached on time.",
      countermeasure:
        "Trial from week 13: book Nimbus windows from 08:00 only; review no-shows after 4 weeks.",
      owner: "Logistics planning",
      stage: "do" as const,
      signal_key:
        "MISSED_DELIVERY|partner-window=Nimbus Logistics · before 08:00",
      opened_at: at(10)
    }
  ];
}
