import "leaflet/dist/leaflet.css";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents
} from "react-leaflet";
import { TYPE_LABEL } from "./charts";

export type NetworkData = {
  sites: {
    code: string;
    name: string;
    lat: number;
    lng: number;
    shipments: number;
    rate: number;
    topIssue: string | null;
  }[];
  hubs: { partner: string; city: string; lat: number; lng: number }[];
  lanes: {
    partner: string;
    site: string;
    shipments: number;
    rate: number;
    topIssue: string | null;
  }[];
};

export type LiveSiteStatus = Record<
  string,
  { open: number; worst: "critical" | "high" | "medium" | null }
>;

// Exception-rate bands, centred on the network's ~20% average.
export const RATE_BANDS = [
  { max: 15, label: "Healthy", range: "< 15%", color: "var(--status-good)" },
  { max: 22, label: "Watch", range: "15–22%", color: "var(--status-warning)" },
  { max: 28, label: "Poor", range: "22–28%", color: "var(--status-serious)" },
  {
    max: Infinity,
    label: "Critical",
    range: "≥ 28%",
    color: "var(--status-critical)"
  }
] as const;

export const band = (rate: number) =>
  RATE_BANDS.find((b) => rate < b.max) ?? RATE_BANDS[3];

const SEVERITY_COLOR = {
  critical: "var(--status-critical)",
  high: "var(--status-serious)",
  medium: "var(--status-warning)"
} as const;

/** Points along the great circle between two coordinates, for real-world lane routes. */
function greatCircle(
  a: [number, number],
  b: [number, number],
  steps = 48
): [number, number][] {
  const rad = Math.PI / 180;
  const [lat1, lon1] = [a[0] * rad, a[1] * rad];
  const [lat2, lon2] = [b[0] * rad, b[1] * rad];
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2
      )
    );
  if (d === 0) return [a, b];
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x =
      A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y =
      A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    pts.push([
      Math.atan2(z, Math.sqrt(x * x + y * y)) / rad,
      Math.atan2(y, x) / rad
    ]);
  }
  return pts;
}

function useDarkMode() {
  const read = () =>
    document.documentElement.getAttribute("data-mode") === "dark";
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setDark(read()));
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-mode"]
    });
    return () => mo.disconnect();
  }, []);
  return dark;
}

export type MapPreset = "europe" | "global";

/** Fits the selected site's lanes, else the chosen preset; reports zoom for labels. */
function FitNetwork({
  presets,
  preset,
  focus,
  onZoom
}: {
  presets: Record<MapPreset, [number, number][]>;
  preset: MapPreset;
  focus: [number, number][] | null;
  onZoom: (z: number) => void;
}) {
  const map = useMap();
  const first = useRef(true);
  useMapEvents({ zoomend: () => onZoom(map.getZoom()) });
  useEffect(() => {
    const target = focus && focus.length > 1 ? focus : presets[preset];
    // Jump on first render (no half-scaled frames); animate later moves.
    map.fitBounds(L.latLngBounds(target), {
      padding: [36, 36],
      maxZoom: 6,
      animate: !first.current
    });
    first.current = false;
    onZoom(map.getZoom());
  }, [map, presets, preset, focus, onZoom]);
  return null;
}

/** Site labels only once the map is zoomed in enough for them not to collide. */
const LABEL_MIN_ZOOM = 4;

const hubIcon = L.divIcon({
  className: "",
  html: '<div class="viz-hub"></div>',
  iconSize: [10, 10]
});

export type WarehouseMarker = {
  code: string;
  name: string;
  ownership: "owned" | "partner";
  operator: string;
  city: string;
  lat: number;
  lng: number;
  health: "reorder" | "excess" | "ok";
  reorder: number;
  excess: number;
  stockValue: number;
  excessValue: number;
};

const WH_STATUS = {
  reorder: { color: "var(--status-critical)", label: "Lines to reorder" },
  excess: { color: "var(--status-warning)", label: "Excess stock" },
  ok: { color: "var(--status-good)", label: "Stock healthy" }
} as const;

const whIcon = (w: WarehouseMarker, selected: boolean) =>
  L.divIcon({
    className: "",
    html: `<div class="viz-wh ${w.ownership}${selected ? " selected" : ""}" style="--wh-status:${WH_STATUS[w.health].color}"></div>`,
    iconSize: [12, 12]
  });

const money = (n: number) =>
  n >= 1_000_000
    ? `€${(n / 1_000_000).toFixed(2)}M`
    : `€${Math.round(n / 1000)}K`;

export function NetworkMap({
  data,
  live,
  selected,
  onSelect,
  warehouses = [],
  selectedWarehouse = null,
  onSelectWarehouse,
  height = 440
}: {
  data: NetworkData;
  live: LiveSiteStatus;
  selected: string | null;
  onSelect: (site: string | null) => void;
  warehouses?: WarehouseMarker[];
  selectedWarehouse?: string | null;
  onSelectWarehouse?: (code: string) => void;
  height?: number;
}) {
  const dark = useDarkMode();
  const [showLanes, setShowLanes] = useState(true);
  const [showWarehouses, setShowWarehouses] = useState(true);
  const [preset, setPreset] = useState<MapPreset>("europe");
  const [zoom, setZoom] = useState(4);
  // Esri's muted Canvas basemaps keep the data layer readable and need no key.
  const tiles = dark
    ? "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
    : "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}";

  const siteByCode = useMemo(
    () => new Map(data.sites.map((s) => [s.code, s])),
    [data.sites]
  );
  const hubByPartner = useMemo(
    () => new Map(data.hubs.map((h) => [h.partner, h])),
    [data.hubs]
  );
  const presets = useMemo<Record<MapPreset, [number, number][]>>(() => {
    const all = [
      ...data.sites.map((s) => [s.lat, s.lng] as [number, number]),
      ...data.hubs.map((h) => [h.lat, h.lng] as [number, number]),
      ...warehouses.map((w) => [w.lat, w.lng] as [number, number])
    ];
    // Europe: everything west of 20°E and north of 35°N (sites + EU hubs).
    const europe = all.filter(
      ([lat, lng]) => lat > 35 && lng > -20 && lng < 20
    );
    return { global: all, europe: europe.length > 1 ? europe : all };
    // Only the coordinates matter here, so key on them rather than the stock figures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.sites, data.hubs, warehouses.map((w) => w.code).join()]);
  const focus = useMemo<[number, number][] | null>(() => {
    if (!selected) return null;
    const s = siteByCode.get(selected);
    if (!s) return null;
    const hubs = data.lanes
      .filter((l) => l.site === selected)
      .map((l) => hubByPartner.get(l.partner)!);
    return [
      [s.lat, s.lng],
      ...hubs.map((h) => [h.lat, h.lng] as [number, number])
    ];
  }, [selected, siteByCode, hubByPartner, data.lanes]);

  const maxShip = Math.max(...data.sites.map((s) => s.shipments), 1);
  const maxLane = Math.max(...data.lanes.map((l) => l.shipments), 1);

  return (
    <div className="relative rounded-xl overflow-hidden" style={{ height }}>
      <MapContainer
        center={[35, 20]}
        zoom={2}
        minZoom={2}
        worldCopyJump
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          key={tiles}
          url={tiles}
          attribution="Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors"
          maxZoom={16}
        />
        <FitNetwork
          presets={presets}
          preset={preset}
          focus={focus}
          onZoom={setZoom}
        />

        {showLanes &&
          data.lanes.map((lane) => {
            const hub = hubByPartner.get(lane.partner);
            const site = siteByCode.get(lane.site);
            if (!hub || !site) return null;
            const b = band(lane.rate);
            const dim = selected != null && lane.site !== selected;
            return (
              <Polyline
                key={`${lane.partner}-${lane.site}`}
                positions={greatCircle(
                  [hub.lat, hub.lng],
                  [site.lat, site.lng]
                )}
                pathOptions={{
                  color: b.color,
                  weight: 2 + (lane.shipments / maxLane) * 3,
                  opacity: dim ? 0.15 : 0.85,
                  lineCap: "round"
                }}
              >
                <Tooltip sticky className="viz-tip">
                  <div className="font-semibold">
                    {lane.partner} → {lane.site}
                  </div>
                  <div>
                    {lane.rate}% of {lane.shipments} shipments had an exception
                    · {b.label}
                  </div>
                  {lane.topIssue && (
                    <div style={{ color: "var(--text-secondary)" }}>
                      Top issue: {TYPE_LABEL[lane.topIssue]}
                    </div>
                  )}
                </Tooltip>
              </Polyline>
            );
          })}

        {showWarehouses &&
          warehouses.map((w) => (
            <Marker
              key={w.code}
              position={[w.lat, w.lng]}
              icon={whIcon(w, w.code === selectedWarehouse)}
              eventHandlers={{ click: () => onSelectWarehouse?.(w.code) }}
              zIndexOffset={500}
            >
              <Tooltip className="viz-tip">
                <div className="font-semibold">{w.name}</div>
                <div style={{ color: "var(--text-secondary)" }}>
                  {w.ownership === "owned"
                    ? "Owned warehouse"
                    : `Partner warehouse · ${w.operator}`}{" "}
                  · {w.city}
                </div>
                <div>Stock {money(w.stockValue)}</div>
                {w.reorder > 0 && (
                  <div>⚠ {w.reorder} line(s) at or below reorder point</div>
                )}
                {w.excess > 0 && (
                  <div>{money(w.excessValue)} above the lean ceiling</div>
                )}
                <div style={{ color: "var(--text-muted)" }}>
                  Click to open its stock
                </div>
              </Tooltip>
            </Marker>
          ))}

        {data.hubs.map((h) => (
          <Marker key={h.partner} position={[h.lat, h.lng]} icon={hubIcon}>
            <Tooltip className="viz-tip">
              <div className="font-semibold">{h.partner}</div>
              <div style={{ color: "var(--text-secondary)" }}>
                Hub · {h.city}
              </div>
            </Tooltip>
          </Marker>
        ))}

        {data.sites.map((s) => {
          const b = band(s.rate);
          const r = 7 + (s.shipments / maxShip) * 7;
          const lv = live[s.code];
          const isSel = selected === s.code;
          return (
            <Fragment key={s.code}>
              {lv && lv.open > 0 && lv.worst && (
                <CircleMarker
                  center={[s.lat, s.lng]}
                  radius={r + 6}
                  pathOptions={{
                    color: SEVERITY_COLOR[lv.worst],
                    fill: false,
                    weight: 2,
                    className: "viz-pulse"
                  }}
                  interactive={false}
                />
              )}
              <CircleMarker
                center={[s.lat, s.lng]}
                radius={r}
                pathOptions={{
                  color: isSel ? "var(--text-primary)" : "var(--surface-1)",
                  weight: 2,
                  fillColor: b.color,
                  fillOpacity: 1
                }}
                eventHandlers={{ click: () => onSelect(isSel ? null : s.code) }}
              >
                {zoom >= LABEL_MIN_ZOOM && (
                  <Tooltip
                    key={`label-${zoom >= LABEL_MIN_ZOOM}`}
                    direction="right"
                    offset={[r, 0]}
                    permanent
                    className="viz-label"
                  >
                    {s.code}
                  </Tooltip>
                )}
              </CircleMarker>
              <CircleMarker
                center={[s.lat, s.lng]}
                radius={r + 6}
                pathOptions={{ opacity: 0, fillOpacity: 0 }}
                eventHandlers={{ click: () => onSelect(isSel ? null : s.code) }}
              >
                <Tooltip className="viz-tip">
                  <div className="font-semibold">
                    {s.code} · {s.name}
                  </div>
                  <div>
                    {s.rate}% of {s.shipments} shipments had an exception ·{" "}
                    {b.label}
                  </div>
                  {s.topIssue && (
                    <div style={{ color: "var(--text-secondary)" }}>
                      Top issue: {TYPE_LABEL[s.topIssue]}
                    </div>
                  )}
                  {lv?.open ? (
                    <div className="font-semibold">
                      ⚠ {lv.open} open live exception{lv.open > 1 ? "s" : ""}
                    </div>
                  ) : null}
                  <div style={{ color: "var(--text-muted)" }}>
                    Click to focus
                  </div>
                </Tooltip>
              </CircleMarker>
            </Fragment>
          );
        })}
      </MapContainer>

      {/* Layer toggles */}
      <div
        className="absolute right-2 top-11 z-[500] rounded-lg px-2.5 py-1.5 text-xs space-y-0.5"
        style={{
          background: "var(--surface-1)",
          border: "1px solid var(--grid)",
          color: "var(--text-secondary)"
        }}
      >
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={showLanes}
            onChange={(e) => setShowLanes(e.target.checked)}
          />{" "}
          Lanes
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={showWarehouses}
            onChange={(e) => setShowWarehouses(e.target.checked)}
          />{" "}
          Warehouses
        </label>
      </div>

      {/* View presets */}
      <div
        className="absolute right-2 top-2 z-[500] flex rounded-lg overflow-hidden text-xs"
        style={{
          background: "var(--surface-1)",
          border: "1px solid var(--grid)"
        }}
      >
        {(["europe", "global"] as const).map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={preset === p && !selected}
            onClick={() => {
              onSelect(null);
              setPreset(p);
            }}
            className="px-2.5 py-1 font-medium"
            style={{
              color:
                preset === p && !selected
                  ? "var(--surface-1)"
                  : "var(--text-secondary)",
              background:
                preset === p && !selected
                  ? "var(--text-primary)"
                  : "transparent"
            }}
          >
            {p === "europe" ? "Europe" : "Global"}
          </button>
        ))}
      </div>

      {/* Legend: status always paired with a label */}
      <div
        className="absolute left-2 bottom-6 z-[500] rounded-lg px-2.5 py-2 text-[11px] space-y-1"
        style={{
          background: "var(--surface-1)",
          color: "var(--text-secondary)",
          border: "1px solid var(--grid)"
        }}
      >
        <div className="font-semibold" style={{ color: "var(--text-primary)" }}>
          Exception rate · 12 wks
        </div>
        {RATE_BANDS.map((b) => (
          <div key={b.label} className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: b.color }}
            />
            {b.label}{" "}
            <span style={{ color: "var(--text-muted)" }}>{b.range}</span>
          </div>
        ))}
        <div
          className="flex items-center gap-1.5 pt-1"
          style={{ borderTop: "1px solid var(--grid)" }}
        >
          <span
            className="inline-block w-2.5 h-2.5 rounded-full border-2"
            style={{ borderColor: "var(--status-critical)" }}
          />
          Open live exceptions
        </div>
        <div className="flex items-center gap-1.5">
          <span className="viz-hub inline-block" />
          Partner hub
        </div>
        {warehouses.length > 0 && (
          <>
            <div
              className="flex items-center gap-1.5 pt-1"
              style={{ borderTop: "1px solid var(--grid)" }}
            >
              <span
                className="viz-wh owned inline-block scale-75"
                style={{ ["--wh-status" as string]: "var(--text-secondary)" }}
              />
              Owned warehouse
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className="viz-wh partner inline-block scale-75"
                style={{ ["--wh-status" as string]: "var(--text-secondary)" }}
              />
              Partner warehouse
            </div>
            {(["reorder", "excess", "ok"] as const).map((k) => (
              <div key={k} className="flex items-center gap-1.5">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm border-2"
                  style={{ borderColor: WH_STATUS[k].color }}
                />
                {WH_STATUS[k].label}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
