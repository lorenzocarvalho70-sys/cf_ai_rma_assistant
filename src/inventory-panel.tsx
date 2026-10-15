import { useEffect, useMemo, useState } from "react";
import { Button } from "@cloudflare/kumo";
import { ShoppingCartIcon, WarehouseIcon } from "@phosphor-icons/react";
import type { InventoryState } from "./server";

type Policy = InventoryState["policy"];
type Line = InventoryState["lines"][number];
type Wh = InventoryState["warehouses"][number];

export type InventoryActions = {
  setPolicy: (change: Partial<Policy>) => Promise<void>;
  order: (warehouse: string, sku: string) => Promise<void>;
};

const eur = (n: number) =>
  n >= 1_000_000
    ? `€${(n / 1_000_000).toFixed(2)}M`
    : n >= 10_000
      ? `€${Math.round(n / 1000)}K`
      : `€${Math.round(n).toLocaleString("en-GB")}`;

export const STOCK_STATUS = {
  reorder: {
    label: "Reorder",
    color: "var(--status-critical)",
    ink: "#ffffff"
  },
  excess: { label: "Excess", color: "var(--status-warning)", ink: "#0b0b0b" },
  ok: { label: "OK", color: "var(--status-good)", ink: "#ffffff" }
} as const;

function StatusChip({ status }: { status: Line["status"] }) {
  const s = STOCK_STATUS[status];
  return (
    <span
      className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
      style={{ background: s.color, color: s.ink }}
    >
      {s.label}
    </span>
  );
}

function Tile({
  label,
  value,
  sub
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
}) {
  return (
    <div className="viz-card p-3.5 min-w-0">
      <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
        {label}
      </div>
      <div
        className="text-2xl font-semibold mt-1"
        style={{ color: "var(--text-primary)" }}
      >
        {value}
      </div>
      {sub && (
        <div
          className="text-xs mt-0.5"
          style={{ color: "var(--text-secondary)" }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

// ── Bullet bar: stock vs its policy band ──────────────────────────────

function StockBullet({ l }: { l: Line }) {
  const w = 150;
  const h = 18;
  const scale = Math.max(l.maxStock * 1.25, l.onHand + l.onOrder, 1);
  const x = (v: number) => (Math.min(v, scale) / scale) * w;
  const s = STOCK_STATUS[l.status];
  return (
    <svg
      width={w}
      height={h}
      aria-label={`${l.onHand} on hand; safety stock ${l.safetyStock}, reorder point ${l.reorderPoint}, lean max ${l.maxStock}`}
    >
      <title>{`${l.onHand} on hand${l.onOrder ? ` + ${l.onOrder} on order` : ""} · SS ${l.safetyStock} · ROP ${l.reorderPoint} · max ${l.maxStock}`}</title>
      {/* Lean band: reorder point → max */}
      <rect
        x={x(l.reorderPoint)}
        y={3}
        width={Math.max(0, x(l.maxStock) - x(l.reorderPoint))}
        height={12}
        fill="var(--grid)"
        rx={2}
      />
      {/* On hand (+ on order as a lighter extension) */}
      {l.onOrder > 0 && (
        <rect
          x={x(l.onHand)}
          y={6}
          width={x(l.onHand + l.onOrder) - x(l.onHand)}
          height={6}
          fill="var(--emphasis-off)"
        />
      )}
      <rect
        x={0}
        y={6}
        width={Math.max(2, x(l.onHand))}
        height={6}
        fill={s.color}
        rx={2}
      />
      {/* Safety stock and reorder point ticks */}
      <line
        x1={x(l.safetyStock)}
        x2={x(l.safetyStock)}
        y1={1}
        y2={17}
        stroke="var(--text-secondary)"
        strokeWidth={1}
      />
      <line
        x1={x(l.reorderPoint)}
        x2={x(l.reorderPoint)}
        y1={1}
        y2={17}
        stroke="var(--text-primary)"
        strokeWidth={2}
      />
      <line
        x1={x(l.maxStock)}
        x2={x(l.maxStock)}
        y1={1}
        y2={17}
        stroke="var(--text-muted)"
        strokeWidth={1}
      />
    </svg>
  );
}

function BulletLegend() {
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]"
      style={{ color: "var(--text-secondary)" }}
    >
      <span className="inline-flex items-center gap-1">
        <span
          className="inline-block w-3 h-1.5 rounded"
          style={{ background: "var(--status-good)" }}
        />{" "}
        On hand (colour = status)
      </span>
      <span className="inline-flex items-center gap-1">
        <span
          className="inline-block w-3 h-1.5"
          style={{ background: "var(--emphasis-off)" }}
        />{" "}
        On order
      </span>
      <span className="inline-flex items-center gap-1">
        <span
          className="inline-block w-0.5 h-3"
          style={{ background: "var(--text-secondary)" }}
        />{" "}
        Safety stock
      </span>
      <span className="inline-flex items-center gap-1">
        <span
          className="inline-block w-0.5 h-3"
          style={{ background: "var(--text-primary)" }}
        />{" "}
        Reorder point
      </span>
      <span className="inline-flex items-center gap-1">
        <span
          className="inline-block w-3 h-2.5 rounded-sm"
          style={{ background: "var(--grid)" }}
        />{" "}
        Lean band (ROP → SS + EOQ)
      </span>
    </div>
  );
}

// ── Policy controls ─────────────────────────────────────────────────────

const SERVICE_LEVELS = [0.9, 0.95, 0.97, 0.98, 0.99, 0.995];

function PolicyBar({
  policy,
  actions
}: {
  policy: Policy;
  actions: InventoryActions;
}) {
  const [storage, setStorage] = useState(policy.storageCostChangePct);
  useEffect(
    () => setStorage(policy.storageCostChangePct),
    [policy.storageCostChangePct]
  );
  const selectCls = "rounded-md px-1.5 py-1 text-xs border";
  const selectStyle = {
    background: "var(--surface-1)",
    color: "var(--text-primary)",
    borderColor: "var(--grid)"
  };
  return (
    <div
      className="flex flex-wrap items-end gap-x-5 gap-y-3 text-xs"
      style={{ color: "var(--text-secondary)" }}
    >
      {(["A", "B", "C"] as const).map((cls) => (
        <label key={cls} className="flex flex-col gap-1">
          Service level · class {cls}
          <select
            className={selectCls}
            style={selectStyle}
            value={policy.serviceLevel[cls]}
            onChange={(e) =>
              void actions.setPolicy({
                serviceLevel: {
                  ...policy.serviceLevel,
                  [cls]: Number(e.target.value)
                }
              })
            }
          >
            {SERVICE_LEVELS.map((v) => (
              <option key={v} value={v}>
                {(v * 100).toFixed(1).replace(".0", "")}%
              </option>
            ))}
          </select>
        </label>
      ))}
      <label className="flex flex-col gap-1 min-w-[220px]">
        <span>
          Storage cost change:{" "}
          <b style={{ color: "var(--text-primary)" }}>
            {storage > 0 ? "+" : ""}
            {storage}%
          </b>
        </span>
        <input
          type="range"
          min={-20}
          max={150}
          step={10}
          value={storage}
          onChange={(e) => setStorage(Number(e.target.value))}
          onMouseUp={() =>
            void actions.setPolicy({ storageCostChangePct: storage })
          }
          onTouchEnd={() =>
            void actions.setPolicy({ storageCostChangePct: storage })
          }
          onKeyUp={() =>
            void actions.setPolicy({ storageCostChangePct: storage })
          }
          aria-label="Storage cost change, percent"
        />
      </label>
      <label className="flex flex-col gap-1">
        Cost of capital
        <select
          className={selectCls}
          style={selectStyle}
          value={policy.capitalRate}
          onChange={(e) =>
            void actions.setPolicy({ capitalRate: Number(e.target.value) })
          }
        >
          {[0.08, 0.1, 0.12, 0.15, 0.2].map((v) => (
            <option key={v} value={v}>
              {Math.round(v * 100)}% / yr
            </option>
          ))}
        </select>
      </label>
      <span
        className="text-[11px] max-w-[300px]"
        style={{ color: "var(--text-muted)" }}
      >
        EOQ = √(2DS/H) · safety stock = z·√(L·σd² + d²·σL²) · reorder point =
        d·L + SS. Order cost S: owned €{policy.orderingCost.owned}, partner €
        {policy.orderingCost.partner}.
      </span>
    </div>
  );
}

// ── Warehouse cards & stock table ───────────────────────────────────────────

function WarehouseCard({
  w,
  selected,
  onSelect
}: {
  w: Wh;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="viz-card p-3 text-left min-w-0 transition-shadow"
      style={
        selected ? { boxShadow: "0 0 0 2px var(--text-primary)" } : undefined
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div
            className="text-sm font-semibold truncate"
            style={{ color: "var(--text-primary)" }}
          >
            {w.name}
          </div>
          <div
            className="text-[11px]"
            style={{ color: "var(--text-secondary)" }}
          >
            {w.ownership === "owned" ? "Owned" : `Partner · ${w.operator}`} ·{" "}
            {w.city}
          </div>
        </div>
        <WarehouseIcon
          size={16}
          weight={w.ownership === "owned" ? "fill" : "regular"}
          style={{ color: "var(--text-secondary)" }}
        />
      </div>
      <div
        className="text-lg font-semibold mt-1.5"
        style={{ color: "var(--text-primary)" }}
      >
        {eur(w.stockValue)}
      </div>
      <div className="flex flex-wrap gap-1.5 mt-1">
        {w.reorder > 0 && (
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{
              background: STOCK_STATUS.reorder.color,
              color: STOCK_STATUS.reorder.ink
            }}
          >
            {w.reorder} to reorder
          </span>
        )}
        {w.excess > 0 && (
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{
              background: STOCK_STATUS.excess.color,
              color: STOCK_STATUS.excess.ink
            }}
          >
            {eur(w.excessValue)} excess
          </span>
        )}
      </div>
      <div
        className="text-[11px] mt-1.5"
        style={{ color: "var(--text-secondary)" }}
      >
        {w.volume} m³ · storage {eur(w.storageCost)}/yr at €{w.storageRate}/m³
      </div>
    </button>
  );
}

type Filter = "all" | "reorder" | "excess";

function StockTable({
  lines,
  actions
}: {
  lines: Line[];
  actions: InventoryActions;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const rank = { reorder: 0, excess: 1, ok: 2 } as const;
  const shown = lines
    .filter((l) => filter === "all" || l.status === filter)
    .sort(
      (a, b) =>
        rank[a.status] - rank[b.status] ||
        b.excessUnits * b.unitCost - a.excessUnits * a.unitCost
    );
  const th = "text-left font-medium py-1.5 px-2 whitespace-nowrap";
  return (
    <div>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <div className="flex gap-1 text-xs">
          {(["all", "reorder", "excess"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className="px-2.5 py-1 rounded-md"
              style={{
                background:
                  filter === f ? "var(--text-primary)" : "transparent",
                color:
                  filter === f ? "var(--surface-1)" : "var(--text-secondary)",
                border: "1px solid var(--grid)"
              }}
            >
              {f === "all"
                ? `All (${lines.length})`
                : `${STOCK_STATUS[f].label} (${lines.filter((l) => l.status === f).length})`}
            </button>
          ))}
        </div>
        <BulletLegend />
      </div>
      <div className="overflow-x-auto">
        <table
          className="w-full text-xs"
          style={{
            color: "var(--text-primary)",
            fontVariantNumeric: "tabular-nums"
          }}
        >
          <thead style={{ color: "var(--text-secondary)" }}>
            <tr>
              <th className={th}>SKU</th>
              <th className={th}>ABC</th>
              <th className={`${th} text-right`}>On hand</th>
              <th className={th}>Stock vs policy</th>
              <th className={`${th} text-right`}>Days cover</th>
              <th className={`${th} text-right`}>SS</th>
              <th className={`${th} text-right`}>ROP</th>
              <th className={`${th} text-right`}>EOQ</th>
              <th
                className={`${th} text-right`}
                title="Holding cost per unit per year (storage share)"
              >
                H / unit·yr
              </th>
              <th className={th}>Status</th>
              <th className={th}>
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => (
              <tr key={l.sku} style={{ borderTop: "1px solid var(--grid)" }}>
                <td className="py-1.5 px-2">
                  <div className="font-semibold">{l.sku}</div>
                  <div style={{ color: "var(--text-secondary)" }}>
                    {l.description}
                  </div>
                </td>
                <td className="px-2">{l.abc}</td>
                <td className="px-2 text-right">
                  {l.onHand}
                  {l.onOrder > 0 && (
                    <div style={{ color: "var(--text-secondary)" }}>
                      +{l.onOrder} due
                    </div>
                  )}
                </td>
                <td className="px-2">
                  <StockBullet l={l} />
                </td>
                <td className="px-2 text-right">{l.daysCover ?? "–"}</td>
                <td className="px-2 text-right">{l.safetyStock}</td>
                <td className="px-2 text-right">{l.reorderPoint}</td>
                <td className="px-2 text-right">{l.eoq}</td>
                <td className="px-2 text-right">
                  €
                  {l.holdingCost.toLocaleString("en-GB", {
                    maximumFractionDigits: 0
                  })}
                  <div style={{ color: "var(--text-secondary)" }}>
                    {l.storageShare}% storage
                  </div>
                </td>
                <td className="px-2">
                  <StatusChip status={l.status} />
                  {l.status === "excess" && (
                    <div
                      className="mt-0.5"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {l.excessUnits} over · {eur(l.excessUnits * l.unitCost)}
                    </div>
                  )}
                </td>
                <td className="px-2 text-right">
                  {l.status === "reorder" && (
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<ShoppingCartIcon size={12} />}
                      disabled={busy === l.sku}
                      onClick={async () => {
                        setBusy(l.sku);
                        try {
                          await actions.order(l.warehouse, l.sku);
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      Order {l.suggestedQty}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── BOM explorer ──────────────────────────────────────────────────────────

function BomExplorer({
  inv,
  warehouse
}: {
  inv: InventoryState;
  warehouse: string;
}) {
  const [server, setServer] = useState(inv.boms[0]?.sku ?? "");
  const bom = inv.boms.find((b) => b.sku === server) ?? inv.boms[0];
  if (!bom) return null;
  const stockOf = (sku: string) =>
    inv.lines.find((l) => l.warehouse === warehouse && l.sku === sku)?.onHand ??
    0;
  const build = inv.buildable.find(
    (b) => b.warehouse === warehouse && b.server === bom.sku
  );
  const network = inv.buildable.filter((b) => b.server === bom.sku);
  return (
    <div>
      <div className="flex gap-1 mb-3 flex-wrap">
        {inv.boms.map((b) => (
          <button
            key={b.sku}
            type="button"
            onClick={() => setServer(b.sku)}
            aria-pressed={server === b.sku}
            className="px-2.5 py-1 rounded-md text-xs"
            style={{
              background:
                server === b.sku ? "var(--text-primary)" : "transparent",
              color:
                server === b.sku ? "var(--surface-1)" : "var(--text-secondary)",
              border: "1px solid var(--grid)"
            }}
          >
            {b.description}
          </button>
        ))}
      </div>
      <div
        className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-2 text-xs"
        style={{ color: "var(--text-secondary)" }}
      >
        <span>
          <b style={{ color: "var(--text-primary)" }}>{bom.sku}</b> · standard
          cost <b style={{ color: "var(--text-primary)" }}>{eur(bom.cost)}</b>{" "}
          (components + €{bom.assembly} assembly)
        </span>
        {build && (
          <span>
            Buildable at {warehouse}:{" "}
            <b style={{ color: "var(--text-primary)" }}>{build.units}</b>,
            limited by{" "}
            <b style={{ color: "var(--text-primary)" }}>{build.limiting}</b>
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table
          className="w-full text-xs"
          style={{
            color: "var(--text-primary)",
            fontVariantNumeric: "tabular-nums"
          }}
        >
          <thead style={{ color: "var(--text-secondary)" }}>
            <tr>
              <th className="text-left font-medium py-1.5 px-2">Component</th>
              <th className="text-right font-medium py-1.5 px-2">Qty</th>
              <th className="text-right font-medium py-1.5 px-2">Unit</th>
              <th className="text-right font-medium py-1.5 px-2">Extended</th>
              <th className="text-right font-medium py-1.5 px-2">In stock</th>
              <th className="text-right font-medium py-1.5 px-2">Builds</th>
            </tr>
          </thead>
          <tbody>
            {bom.lines.map((l) => {
              const stock = stockOf(l.sku);
              const can = Math.floor(stock / l.qty);
              const limiting = build?.limiting === l.sku;
              return (
                <tr
                  key={l.sku}
                  style={{
                    borderTop: "1px solid var(--grid)",
                    fontWeight: limiting ? 600 : undefined
                  }}
                >
                  <td className="py-1.5 px-2">
                    {l.sku}{" "}
                    <span
                      style={{
                        color: "var(--text-secondary)",
                        fontWeight: 400
                      }}
                    >
                      {l.description}
                    </span>
                    {limiting && (
                      <span style={{ color: "var(--status-critical)" }}>
                        {" "}
                        · limiting
                      </span>
                    )}
                  </td>
                  <td className="px-2 text-right">{l.qty}</td>
                  <td className="px-2 text-right">
                    €{l.unitCost.toLocaleString("en-GB")}
                  </td>
                  <td className="px-2 text-right">
                    €{l.extended.toLocaleString("en-GB")}
                  </td>
                  <td className="px-2 text-right">{stock}</td>
                  <td className="px-2 text-right">{can}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="text-xs mt-3" style={{ color: "var(--text-secondary)" }}>
        Buildable across the network:{" "}
        {network.map((b) => `${b.warehouse} ${b.units}`).join(" · ")}
      </div>
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────

export function InventorySection({
  inv,
  selected,
  onSelect,
  actions
}: {
  inv: InventoryState;
  selected: string;
  onSelect: (code: string) => void;
  actions: InventoryActions;
}) {
  const totals = useMemo(() => {
    const sum = (
      k:
        | "stockValue"
        | "excessValue"
        | "holdingCost"
        | "leanCost"
        | "storageCost"
        | "reorder"
        | "volume"
        | "excessVolume"
    ) => inv.warehouses.reduce((a, w) => a + w[k], 0);
    return {
      value: sum("stockValue"),
      excess: sum("excessValue"),
      holding: sum("holdingCost"),
      lean: sum("leanCost"),
      storage: sum("storageCost"),
      reorder: sum("reorder"),
      volume: sum("volume"),
      excessVolume: sum("excessVolume")
    };
  }, [inv.warehouses]);
  const wh =
    inv.warehouses.find((w) => w.code === selected) ?? inv.warehouses[0];
  const saving = totals.holding - totals.lean;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h2
          className="text-base font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          Warehouses &amp; lean replenishment
        </h2>
        <span
          className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
          style={{
            border: "1px solid var(--axis)",
            color: "var(--text-secondary)"
          }}
        >
          Illustrative data
        </span>
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Fictional SKUs and prices for typical edge-server hardware; not a real
          bill of materials.
        </span>
      </div>

      <div className="viz-card p-4">
        <PolicyBar policy={inv.policy} actions={actions} />
      </div>

      <div className="grid gap-3 grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Stock value · 6 warehouses"
          value={eur(totals.value)}
          sub={`${totals.volume.toFixed(1)} m³ in cages`}
        />
        <Tile
          label="Holding cost today → at lean policy"
          value={`${eur(totals.holding)} → ${eur(totals.lean)}`}
          sub={
            <span
              style={{
                color:
                  saving > 0 ? "var(--delta-good)" : "var(--text-secondary)"
              }}
            >
              {saving > 0
                ? `${eur(saving)}/yr (${Math.round((100 * saving) / totals.holding)}%) to release`
                : "At or below lean cost"}
            </span>
          }
        />
        <Tile
          label="Excess above lean ceiling"
          value={eur(totals.excess)}
          sub={`${totals.excessVolume.toFixed(1)} m³ of cage space to free · storage ${eur(totals.storage)}/yr`}
        />
        <Tile
          label="Lines at or below reorder point"
          value={String(totals.reorder)}
          sub={`${inv.openOrders} replenishment order(s) in transit`}
        />
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {inv.warehouses.map((w) => (
          <WarehouseCard
            key={w.code}
            w={w}
            selected={w.code === wh.code}
            onSelect={() => onSelect(w.code)}
          />
        ))}
      </div>

      <div className="viz-card p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <h3
              className="text-sm font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              {wh.name}: stock vs policy
            </h3>
            <p
              className="text-xs mt-0.5"
              style={{ color: "var(--text-secondary)" }}
            >
              {wh.ownership === "owned"
                ? "Owned spares hub"
                : `Partner warehouse run by ${wh.operator}`}{" "}
              · serves {wh.sitesServed.join(", ")} (
              {wh.fleetServed.toLocaleString("en-GB")} servers) · storage €
              {wh.storageRate}/m³·yr
            </p>
          </div>
        </div>
        <StockTable
          lines={inv.lines.filter((l) => l.warehouse === wh.code)}
          actions={actions}
        />
      </div>

      <div className="viz-card p-4">
        <h3
          className="text-sm font-semibold mb-0.5"
          style={{ color: "var(--text-primary)" }}
        >
          Integrated servers: bills of materials
        </h3>
        <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
          Standard cost rolls up from component SKUs. "Builds" shows how many
          units {wh.name} could assemble from its own stock.
        </p>
        <BomExplorer inv={inv} warehouse={wh.code} />
      </div>
    </div>
  );
}
