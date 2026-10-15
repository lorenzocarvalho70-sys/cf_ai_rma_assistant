// Small SVG charts for the dashboard, following the dataviz mark specs:
// 2px lines, ≤24px bars with 4px rounded data-ends and 2px surface gaps,
// ringed markers, hairline grids, text in text tokens, hover tooltips.

import { useEffect, useRef, useState, type ReactNode } from "react";

// ── Shared ───────────────────────────────────────────────────────────

export const TYPE_ORDER = [
  "DAMAGED_IN_TRANSIT",
  "MISSED_DELIVERY",
  "SERIAL_MISMATCH",
  "QTY_VARIANCE",
  "SHORT_SHIPMENT",
  "UNEXPECTED_ITEM",
  "ACCESS_VIOLATION"
] as const;

/** Exception type → categorical slot (fixed order, never by rank). */
export const TYPE_COLOR: Record<string, string> = Object.fromEntries(
  TYPE_ORDER.map((t, i) => [t, `var(--series-${i + 1})`])
);

export const TYPE_LABEL: Record<string, string> = {
  DAMAGED_IN_TRANSIT: "Damaged in transit",
  MISSED_DELIVERY: "Missed delivery",
  SERIAL_MISMATCH: "Serial mismatch",
  QTY_VARIANCE: "Qty variance",
  SHORT_SHIPMENT: "Short shipment",
  UNEXPECTED_ITEM: "Unexpected item",
  ACCESS_VIOLATION: "Access violation"
};

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) =>
      setWidth(Math.max(240, e.contentRect.width))
    );
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

const shortDate = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC"
  });

/** Rounded top only: data-end rounded, square at the baseline. */
function barPath(x: number, y: number, w: number, h: number, r = 4) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}
function barPathH(x: number, y: number, w: number, h: number, r = 4) {
  const rr = Math.min(r, h / 2, w);
  return `M${x},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} H${x} Z`;
}

function Tooltip({
  x,
  y,
  width,
  children
}: {
  x: number;
  y: number;
  width: number;
  children: ReactNode;
}) {
  const left = Math.min(Math.max(x + 12, 0), width - 190);
  return (
    <div
      className="absolute pointer-events-none z-10 rounded-lg px-2.5 py-1.5 text-xs shadow-lg"
      style={{
        left,
        top: Math.max(0, y - 10),
        background: "var(--surface-1)",
        color: "var(--text-primary)",
        border: "1px solid var(--grid)",
        minWidth: 150
      }}
    >
      {children}
    </div>
  );
}

export function Legend({
  items
}: {
  items: { label: string; color: string; shape?: "dot" | "line" }[];
}) {
  return (
    <div
      className="flex flex-wrap gap-x-3 gap-y-1 text-xs"
      style={{ color: "var(--text-secondary)" }}
    >
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          {i.shape === "line" ? (
            <span
              className="inline-block w-3 h-0.5 rounded"
              style={{ background: i.color }}
            />
          ) : (
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ background: i.color }}
            />
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}

// ── Sparkline (stat tiles) ───────────────────────────────────────────

export function Sparkline({
  values,
  width = 120,
  height = 28
}: {
  values: (number | null)[];
  width?: number;
  height?: number;
}) {
  const pts = values
    .map((v, i) => [i, v] as const)
    .filter((p): p is readonly [number, number] => p[1] != null);
  if (pts.length < 2) return null;
  const ys = pts.map((p) => p[1]);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const sx = (i: number) => 4 + (i / (values.length - 1)) * (width - 8);
  const sy = (v: number) =>
    height - 4 - ((v - min) / (max - min || 1)) * (height - 8);
  const d = pts
    .map(([i, v], k) => `${k ? "L" : "M"}${sx(i)},${sy(v)}`)
    .join(" ");
  const [li, lv] = pts[pts.length - 1];
  return (
    <svg width={width} height={height} aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke="var(--emphasis-off)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={sx(li)}
        cy={sy(lv)}
        r={4}
        fill="var(--series-1)"
        stroke="var(--surface-1)"
        strokeWidth={2}
      />
    </svg>
  );
}

// ── Control chart (p-chart) ─────────────────────────────────────────────

type ControlPoint = {
  week: number;
  weekStart: string;
  n: number;
  p: number | null;
  ucl: number | null;
  lcl: number | null;
  signal: string | null;
};

export function ControlChart({
  centre,
  points
}: {
  centre: number;
  points: ControlPoint[];
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = 220;
  const m = { l: 40, r: 44, t: 12, b: 28 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;
  const top = niceMax(
    Math.max(...points.map((p) => Math.max(p.ucl ?? 0, p.p ?? 0))) * 1.05
  );
  const x = (i: number) =>
    m.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => m.t + ih - (v / top) * ih;
  const tickStep = niceMax(top / 5);
  const ticks = Array.from(
    { length: Math.floor(top / tickStep) + 1 },
    (_, i) => i * tickStep
  );
  const step = (key: "ucl" | "lcl") =>
    points
      .map((p, i) => {
        const half = iw / Math.max(1, points.length - 1) / 2;
        return `${i ? "L" : "M"}${x(i) - (i ? half : 0)},${y(p[key] ?? 0)} H${x(i) + (i < points.length - 1 ? half : 0)}`;
      })
      .join(" ");
  const line = points
    .map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.p ?? 0)}`)
    .join(" ");
  const h = hover != null ? points[hover] : null;

  return (
    <div ref={ref} className="relative">
      <svg
        width={width}
        height={height}
        aria-label="Weekly share of shipments with an exception, with control limits"
      >
        <title>
          Weekly share of shipments with an exception, with control limits
        </title>
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={m.l}
              x2={width - m.r}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--grid)"
              strokeWidth={1}
            />
            <text
              x={m.l - 6}
              y={y(t) + 4}
              textAnchor="end"
              fontSize={11}
              fill="var(--text-muted)"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {Math.round(t)}%
            </text>
          </g>
        ))}
        <path
          d={step("ucl")}
          fill="none"
          stroke="var(--text-muted)"
          strokeWidth={1}
        />
        <path
          d={step("lcl")}
          fill="none"
          stroke="var(--text-muted)"
          strokeWidth={1}
        />
        <line
          x1={m.l}
          x2={width - m.r}
          y1={y(centre)}
          y2={y(centre)}
          stroke="var(--text-secondary)"
          strokeWidth={1}
        />
        <text
          x={width - m.r + 4}
          y={y(points.at(-1)?.ucl ?? 0) + 4}
          fontSize={11}
          fill="var(--text-muted)"
        >
          UCL
        </text>
        <text
          x={width - m.r + 4}
          y={y(centre) + 4}
          fontSize={11}
          fill="var(--text-secondary)"
        >
          {centre}%
        </text>
        <text
          x={width - m.r + 4}
          y={y(points.at(-1)?.lcl ?? 0) + 4}
          fontSize={11}
          fill="var(--text-muted)"
        >
          LCL
        </text>
        <path
          d={line}
          fill="none"
          stroke="var(--series-1)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {h && (
          <line
            x1={x(hover!)}
            x2={x(hover!)}
            y1={m.t}
            y2={m.t + ih}
            stroke="var(--axis)"
            strokeWidth={1}
          />
        )}
        {points.map((p, i) => (
          <g key={p.week}>
            <circle
              cx={x(i)}
              cy={y(p.p ?? 0)}
              r={p.signal ? 5 : 4}
              fill={p.signal ? "var(--status-critical)" : "var(--series-1)"}
              stroke="var(--surface-1)"
              strokeWidth={2}
            />
            {(i % 2 === 0 || i === points.length - 1) && (
              <text
                x={x(i)}
                y={height - 8}
                textAnchor="middle"
                fontSize={11}
                fill="var(--text-muted)"
              >
                {shortDate(p.weekStart)}
              </text>
            )}
          </g>
        ))}
        {/* Hit targets wider than the marks */}
        {points.map((p, i) => (
          <rect
            key={`hit-${p.week}`}
            x={x(i) - iw / points.length / 2}
            y={m.t}
            width={iw / points.length}
            height={ih}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
      {h && (
        <Tooltip x={x(hover!)} y={y(h.p ?? 0)} width={width}>
          <div className="font-semibold">Week of {shortDate(h.weekStart)}</div>
          <div>
            {h.p}% of {h.n} shipments had an exception
          </div>
          <div style={{ color: "var(--text-secondary)" }}>
            Limits {h.lcl}% – {h.ucl}%
          </div>
          {h.signal && (
            <div
              className="font-semibold"
              style={{ color: "var(--status-critical)" }}
            >
              ⚠ {h.signal}
            </div>
          )}
        </Tooltip>
      )}
    </div>
  );
}

// ── Stacked weekly columns by exception type ────────────────────────────

type WeekStat = {
  week: number;
  weekStart: string;
  shipments: number;
  byType: Record<string, number>;
};

export function StackedWeeks({
  weeks,
  liveWeek
}: {
  weeks: WeekStat[];
  liveWeek: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const height = 220;
  const m = { l: 32, r: 8, t: 10, b: 28 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;
  const totals = weeks.map((w) =>
    TYPE_ORDER.reduce((a, t) => a + (w.byType[t] ?? 0), 0)
  );
  const top = niceMax(Math.max(...totals, 1));
  const band = iw / weeks.length;
  const bw = Math.min(24, band * 0.6);
  const y = (v: number) => (v / top) * ih;
  const GAP = 2;
  const types = TYPE_ORDER.filter((t) =>
    weeks.some((w) => (w.byType[t] ?? 0) > 0)
  );

  return (
    <div>
      <div className="flex items-start justify-between gap-2 mb-2">
        <Legend
          items={types.map((t) => ({
            label: TYPE_LABEL[t],
            color: TYPE_COLOR[t]
          }))}
        />
        <button
          type="button"
          onClick={() => setAsTable(!asTable)}
          className="text-xs underline shrink-0"
          style={{ color: "var(--text-secondary)" }}
        >
          {asTable ? "Chart" : "Table"}
        </button>
      </div>
      {asTable ? (
        <div className="overflow-x-auto">
          <table
            className="text-xs w-full"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            <thead>
              <tr style={{ color: "var(--text-secondary)" }}>
                <th className="text-left font-medium py-1 pr-2">Week of</th>
                {types.map((t) => (
                  <th key={t} className="text-right font-medium py-1 px-1">
                    {TYPE_LABEL[t]}
                  </th>
                ))}
                <th className="text-right font-medium py-1 pl-1">Shipments</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.week} style={{ borderTop: "1px solid var(--grid)" }}>
                  <td className="py-1 pr-2">
                    {shortDate(w.weekStart)}
                    {w.week === liveWeek ? " (live)" : ""}
                  </td>
                  {types.map((t) => (
                    <td key={t} className="text-right px-1">
                      {w.byType[t] ?? 0}
                    </td>
                  ))}
                  <td className="text-right pl-1">{w.shipments}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="relative">
          <svg
            width={width}
            height={height}
            aria-label="Exceptions per week by type"
          >
            <title>Exceptions per week by type</title>
            {[0, top / 2, top].map((t) => (
              <g key={t}>
                <line
                  x1={m.l}
                  x2={width - m.r}
                  y1={m.t + ih - y(t)}
                  y2={m.t + ih - y(t)}
                  stroke="var(--grid)"
                  strokeWidth={1}
                />
                <text
                  x={m.l - 6}
                  y={m.t + ih - y(t) + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill="var(--text-muted)"
                >
                  {t}
                </text>
              </g>
            ))}
            {weeks.map((w, i) => {
              const cx = m.l + band * i + band / 2;
              let base = m.t + ih;
              const segs = types.filter((t) => (w.byType[t] ?? 0) > 0);
              return (
                <g
                  key={w.week}
                  opacity={hover == null || hover === i ? 1 : 0.55}
                >
                  {segs.map((t, k) => {
                    const h = y(w.byType[t]);
                    const isTop = k === segs.length - 1;
                    const segH = Math.max(0, h - (isTop ? 0 : GAP));
                    base -= h;
                    const yTop = base + (isTop ? 0 : GAP);
                    return isTop ? (
                      <path
                        key={t}
                        d={barPath(cx - bw / 2, yTop, bw, segH)}
                        fill={TYPE_COLOR[t]}
                      />
                    ) : (
                      <rect
                        key={t}
                        x={cx - bw / 2}
                        y={yTop}
                        width={bw}
                        height={segH}
                        fill={TYPE_COLOR[t]}
                      />
                    );
                  })}
                  {(i % 2 === 0 || w.week === liveWeek) && (
                    <text
                      x={cx}
                      y={height - 8}
                      textAnchor="middle"
                      fontSize={11}
                      fill="var(--text-muted)"
                    >
                      {w.week === liveWeek ? "Live" : shortDate(w.weekStart)}
                    </text>
                  )}
                  <rect
                    x={cx - band / 2}
                    y={m.t}
                    width={band}
                    height={ih}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                  />
                </g>
              );
            })}
          </svg>
          {hover != null && (
            <Tooltip
              x={m.l + band * hover + band / 2}
              y={m.t + 10}
              width={width}
            >
              <div className="font-semibold">
                {weeks[hover].week === liveWeek
                  ? "This week (live)"
                  : `Week of ${shortDate(weeks[hover].weekStart)}`}
              </div>
              {types
                .filter((t) => (weeks[hover].byType[t] ?? 0) > 0)
                .map((t) => (
                  <div key={t} className="flex items-center gap-1.5">
                    <span
                      className="inline-block w-2 h-2 rounded-sm"
                      style={{ background: TYPE_COLOR[t] }}
                    />
                    {TYPE_LABEL[t]}: {weeks[hover].byType[t]}
                  </div>
                ))}
              <div style={{ color: "var(--text-secondary)" }}>
                {weeks[hover].shipments} shipments
              </div>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}

// ── Pareto (horizontal, vital few emphasised; no second axis) ───────────

export function Pareto({
  rows
}: {
  rows: { type: string; count: number; share: number; cumShare: number }[];
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const labelW = 122;
  const valueW = 64;
  const rowH = 28;
  const bh = 16;
  const max = Math.max(...rows.map((r) => r.count), 1);
  const iw = width - labelW - valueW;
  // "Vital few": the types that together reach 80% of exceptions.
  const vital = new Set<string>();
  for (const r of rows) {
    vital.add(r.type);
    if (r.cumShare >= 80) break;
  }
  return (
    <div ref={ref} className="relative">
      <svg
        width={width}
        height={rows.length * rowH + 4}
        aria-label="Pareto of exception types"
      >
        <title>Pareto of exception types</title>
        {rows.map((r, i) => {
          const yy = i * rowH + (rowH - bh) / 2;
          const w = Math.max(2, (r.count / max) * iw);
          return (
            <g
              key={r.type}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <rect
                x={0}
                y={i * rowH}
                width={width}
                height={rowH}
                fill="transparent"
              />
              <text
                x={labelW - 8}
                y={yy + bh - 3}
                textAnchor="end"
                fontSize={12}
                fill="var(--text-primary)"
              >
                {TYPE_LABEL[r.type] ?? r.type}
              </text>
              <path
                d={barPathH(labelW, yy, w, bh)}
                fill={
                  vital.has(r.type) ? "var(--series-1)" : "var(--emphasis-off)"
                }
              />
              <text
                x={labelW + w + 6}
                y={yy + bh - 3}
                fontSize={12}
                fill="var(--text-secondary)"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {r.count} · {r.cumShare}%
              </text>
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <Tooltip x={labelW + 20} y={hover * rowH + 20} width={width}>
          <div className="font-semibold">{TYPE_LABEL[rows[hover].type]}</div>
          <div>
            {rows[hover].count} exceptions ({rows[hover].share}%)
          </div>
          <div style={{ color: "var(--text-secondary)" }}>
            Cumulative {rows[hover].cumShare}%
          </div>
        </Tooltip>
      )}
      <div className="mt-1">
        <Legend
          items={[
            {
              label: "Vital few (≤ 80% of exceptions)",
              color: "var(--series-1)"
            },
            { label: "Others", color: "var(--emphasis-off)" }
          ]}
        />
      </div>
    </div>
  );
}

// ── Heatmap (sequential blue, one hue light→dark) ───────────────────────

const SEQ = [
  "#cde2fb",
  "#9ec5f4",
  "#6da7ec",
  "#3987e5",
  "#256abf",
  "#184f95",
  "#0d366b"
];
const seqInk = (i: number) => (i >= 3 ? "#ffffff" : "#0b0b0b");

export function Heatmap({
  days,
  hours,
  cells
}: {
  days: string[];
  hours: number[];
  cells: { day: string; hour: number; n: number; rate: number | null }[];
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<(typeof cells)[number] | null>(null);
  const labelW = 36;
  const cw = (width - labelW) / hours.length;
  const ch = 28;
  const max = Math.max(...cells.map((c) => c.rate ?? 0), 1);
  const step = (rate: number) =>
    Math.min(
      SEQ.length - 1,
      Math.floor((rate / max) * (SEQ.length - 1) + 0.0001)
    );
  return (
    <div ref={ref} className="relative">
      <svg
        width={width}
        height={days.length * ch + 22}
        aria-label="Missed-delivery rate by weekday and window start hour"
      >
        <title>Missed-delivery rate by weekday and window start hour</title>
        {days.map((d, r) => (
          <text
            key={d}
            x={0}
            y={r * ch + ch / 2 + 4}
            fontSize={11}
            fill="var(--text-muted)"
          >
            {d}
          </text>
        ))}
        {cells.map((c) => {
          const r = days.indexOf(c.day);
          const col = hours.indexOf(c.hour);
          const s = c.rate == null ? -1 : step(c.rate);
          return (
            <g
              key={`${c.day}-${c.hour}`}
              onMouseEnter={() => setHover(c)}
              onMouseLeave={() => setHover(null)}
            >
              <rect
                x={labelW + col * cw + 1}
                y={r * ch + 1}
                width={cw - 2}
                height={ch - 2}
                rx={3}
                fill={s < 0 ? "var(--grid)" : SEQ[s]}
              />
              {c.rate != null && cw > 30 && (
                <text
                  x={labelW + col * cw + cw / 2}
                  y={r * ch + ch / 2 + 4}
                  textAnchor="middle"
                  fontSize={10}
                  fill={seqInk(s)}
                >
                  {Math.round(c.rate)}
                </text>
              )}
            </g>
          );
        })}
        {hours.map((h, col) => (
          <text
            key={h}
            x={labelW + col * cw + cw / 2}
            y={days.length * ch + 16}
            textAnchor="middle"
            fontSize={11}
            fill="var(--text-muted)"
          >
            {String(h).padStart(2, "0")}:00
          </text>
        ))}
      </svg>
      <div
        className="flex items-center gap-2 mt-1 text-xs"
        style={{ color: "var(--text-secondary)" }}
      >
        <span>0%</span>
        <span className="inline-flex">
          {SEQ.map((c) => (
            <span
              key={c}
              className="inline-block w-5 h-2"
              style={{ background: c }}
            />
          ))}
        </span>
        <span>{Math.round(max)}% missed</span>
      </div>
      {hover && (
        <Tooltip
          x={labelW + hours.indexOf(hover.hour) * cw}
          y={days.indexOf(hover.day) * ch + 30}
          width={width}
        >
          <div className="font-semibold">
            {hover.day} · window opens {String(hover.hour).padStart(2, "0")}:00
          </div>
          <div>
            {hover.rate ?? 0}% missed of {hover.n} deliveries
          </div>
        </Tooltip>
      )}
    </div>
  );
}

// ── Rate vs baseline (dot plot for signals) ─────────────────────────────

export function RateVsBaseline({
  rate,
  baseline,
  max
}: {
  rate: number;
  baseline: number;
  max: number;
}) {
  const w = 160;
  const x = (v: number) => 6 + (v / max) * (w - 12);
  return (
    <svg
      width={w}
      height={18}
      aria-label={`${rate}% vs ${baseline}% elsewhere`}
    >
      <line
        x1={6}
        x2={w - 6}
        y1={9}
        y2={9}
        stroke="var(--grid)"
        strokeWidth={1}
      />
      <line
        x1={x(baseline)}
        x2={x(rate)}
        y1={9}
        y2={9}
        stroke="var(--axis)"
        strokeWidth={2}
      />
      <circle
        cx={x(baseline)}
        cy={9}
        r={4}
        fill="var(--emphasis-off)"
        stroke="var(--surface-1)"
        strokeWidth={2}
      />
      <circle
        cx={x(rate)}
        cy={9}
        r={5}
        fill="var(--status-critical)"
        stroke="var(--surface-1)"
        strokeWidth={2}
      />
    </svg>
  );
}
