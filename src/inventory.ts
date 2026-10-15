// Spares & server inventory with lean replenishment policy (EOQ, safety stock,
// reorder point). All items, prices and quantities are ILLUSTRATIVE and
// fictional: typical edge-server hardware, not any company's real BOM.

// ── Catalogue ────────────────────────────────────────────────────────

export type Category = "Server" | "Component" | "Network" | "Cabling";

export type Sku = {
  sku: string;
  description: string;
  category: Category;
  /** Illustrative unit cost, EUR */
  unitCost: number;
  /** Storage volume per unit incl. packaging, m³ */
  volume: number;
  /** Supplier lead time, days (mean and standard deviation) */
  leadDays: number;
  leadSd: number;
  /** Order multiple (pack size) */
  pack: number;
  supplier: string;
  supplierContact: string;
};

const SUPPLIERS = {
  silicon: ["Northwind Silicon BV", "orders@northwind-silicon.example"],
  memory: ["Helix Memory GmbH", "orders@helix-memory.example"],
  storage: ["Atlas Storage Ltd", "sales@atlas-storage.example"],
  power: ["Volta Power Systems", "orders@volta-power.example"],
  mech: ["Ironframe Mechanical", "orders@ironframe.example"],
  net: ["Lumen Networks", "orders@lumen-net.example"],
  integrator: ["Keystone Integration", "builds@keystone-int.example"]
} as const;

function item(
  sku: string,
  description: string,
  category: Category,
  unitCost: number,
  volume: number,
  leadDays: number,
  leadSd: number,
  pack: number,
  supplier: keyof typeof SUPPLIERS
): Sku {
  const [name, contact] = SUPPLIERS[supplier];
  return {
    sku,
    description,
    category,
    unitCost,
    volume,
    leadDays,
    leadSd,
    pack,
    supplier: name,
    supplierContact: contact
  };
}

export const COMPONENTS: Sku[] = [
  item(
    "CPU-96C",
    "96-core x86 server CPU",
    "Component",
    9500,
    0.002,
    28,
    7,
    1,
    "silicon"
  ),
  item(
    "MB-1S",
    "Single-socket server motherboard",
    "Component",
    1400,
    0.012,
    35,
    8,
    1,
    "silicon"
  ),
  item(
    "DIMM-32",
    "32 GB DDR5 RDIMM",
    "Component",
    140,
    0.0005,
    21,
    5,
    10,
    "memory"
  ),
  item(
    "DIMM-64",
    "64 GB DDR5 RDIMM",
    "Component",
    260,
    0.0005,
    21,
    5,
    10,
    "memory"
  ),
  item(
    "SSD-3840",
    "3.84 TB NVMe U.2 SSD",
    "Component",
    380,
    0.0008,
    18,
    4,
    5,
    "storage"
  ),
  item(
    "NVME-7680",
    "7.68 TB NVMe U.2 SSD",
    "Component",
    700,
    0.0008,
    18,
    4,
    5,
    "storage"
  ),
  item(
    "HDD-20T",
    "20 TB 3.5in SATA HDD",
    "Component",
    330,
    0.0015,
    25,
    6,
    5,
    "storage"
  ),
  item(
    "GPU",
    "Inference accelerator card",
    "Component",
    18000,
    0.006,
    56,
    14,
    1,
    "silicon"
  ),
  item(
    "NIC-25G",
    "Dual-port 25GbE OCP NIC",
    "Network",
    280,
    0.002,
    30,
    8,
    5,
    "net"
  ),
  item(
    "NIC-100G",
    "Dual-port 100GbE NIC",
    "Network",
    850,
    0.002,
    35,
    9,
    2,
    "net"
  ),
  item("PSU", "800 W hot-swap PSU", "Component", 190, 0.004, 20, 5, 4, "power"),
  item(
    "PSU-2000",
    "2000 W hot-swap PSU",
    "Component",
    420,
    0.006,
    24,
    6,
    2,
    "power"
  ),
  item(
    "F-200",
    "Hot-swap fan module",
    "Component",
    45,
    0.002,
    14,
    3,
    4,
    "power"
  ),
  item("CHS-1U", "1U server chassis", "Component", 600, 0.05, 30, 6, 1, "mech"),
  item("CHS-2U", "2U server chassis", "Component", 900, 0.09, 30, 6, 1, "mech"),
  item("RAIL-KIT", "Rack rail kit", "Component", 60, 0.01, 14, 3, 5, "mech"),
  item(
    "CABLE-QSFP",
    "QSFP28 DAC cable, 3 m",
    "Cabling",
    35,
    0.001,
    10,
    2,
    10,
    "net"
  ),
  item(
    "OPT-100G",
    "100G QSFP28 optic",
    "Cabling",
    110,
    0.0003,
    21,
    5,
    10,
    "net"
  ),
  item(
    "NET-TOR",
    "Top-of-rack switch, 48×25G + 8×100G",
    "Network",
    7200,
    0.04,
    45,
    10,
    1,
    "net"
  )
];

export type BomLine = { sku: string; qty: number };

/** Integrated server builds (finished goods) and their bills of materials. */
export const SERVERS: {
  sku: string;
  description: string;
  volume: number;
  leadDays: number;
  leadSd: number;
  assembly: number;
  bom: BomLine[];
}[] = [
  {
    sku: "SRV-EDGE-1U",
    description: "Edge compute node, 1U",
    volume: 0.06,
    leadDays: 42,
    leadSd: 10,
    assembly: 350,
    bom: [
      { sku: "CHS-1U", qty: 1 },
      { sku: "MB-1S", qty: 1 },
      { sku: "CPU-96C", qty: 1 },
      { sku: "DIMM-32", qty: 12 },
      { sku: "SSD-3840", qty: 2 },
      { sku: "NIC-25G", qty: 1 },
      { sku: "PSU", qty: 2 },
      { sku: "F-200", qty: 6 },
      { sku: "RAIL-KIT", qty: 1 },
      { sku: "CABLE-QSFP", qty: 2 }
    ]
  },
  {
    sku: "SRV-STOR-2U",
    description: "Storage node, 2U",
    volume: 0.11,
    leadDays: 49,
    leadSd: 12,
    assembly: 450,
    bom: [
      { sku: "CHS-2U", qty: 1 },
      { sku: "MB-1S", qty: 1 },
      { sku: "CPU-96C", qty: 1 },
      { sku: "DIMM-64", qty: 8 },
      { sku: "HDD-20T", qty: 12 },
      { sku: "NVME-7680", qty: 2 },
      { sku: "NIC-100G", qty: 1 },
      { sku: "PSU", qty: 2 },
      { sku: "F-200", qty: 4 },
      { sku: "RAIL-KIT", qty: 1 },
      { sku: "OPT-100G", qty: 2 }
    ]
  },
  {
    sku: "SRV-GPU-2U",
    description: "AI inference node, 2U",
    volume: 0.11,
    leadDays: 63,
    leadSd: 14,
    assembly: 600,
    bom: [
      { sku: "CHS-2U", qty: 1 },
      { sku: "MB-1S", qty: 1 },
      { sku: "CPU-96C", qty: 1 },
      { sku: "DIMM-64", qty: 12 },
      { sku: "NVME-7680", qty: 4 },
      { sku: "GPU", qty: 4 },
      { sku: "NIC-100G", qty: 2 },
      { sku: "PSU-2000", qty: 2 },
      { sku: "F-200", qty: 6 },
      { sku: "RAIL-KIT", qty: 1 },
      { sku: "OPT-100G", qty: 2 }
    ]
  }
];

const componentBySku = new Map(COMPONENTS.map((c) => [c.sku, c]));

/** Rolled-up standard cost of a server: components + assembly. */
export function rollupCost(server: (typeof SERVERS)[number]) {
  return server.bom.reduce(
    (sum, l) => sum + (componentBySku.get(l.sku)?.unitCost ?? 0) * l.qty,
    server.assembly
  );
}

export const CATALOG: Sku[] = [
  ...COMPONENTS,
  ...SERVERS.map((s) =>
    item(
      s.sku,
      s.description,
      "Server",
      rollupCost(s),
      s.volume,
      s.leadDays,
      s.leadSd,
      1,
      "integrator"
    )
  )
];

// ── Warehouses ──────────────────────────────────────────────────────────

export type Warehouse = {
  code: string;
  name: string;
  ownership: "owned" | "partner";
  operator: string;
  city: string;
  lat: number;
  lng: number;
  /**
   * Fully loaded storage cost, EUR per m³ per year, before any policy change:
   * secure, ESD-safe, climate-controlled cage space plus handling.
   */
  storageRate: number;
  /** Servers in the fleet this warehouse supplies spares for */
  fleetServed: number;
  sitesServed: string[];
};

export const WAREHOUSES: Warehouse[] = [
  {
    code: "WH-UTR",
    name: "Utrecht Spares Hub",
    ownership: "owned",
    operator: "In-house",
    city: "Utrecht",
    lat: 52.09,
    lng: 5.12,
    storageRate: 1600,
    fleetServed: 2600,
    sitesServed: ["AMS-02", "DUB-03"]
  },
  {
    code: "WH-FRA",
    name: "Frankfurt Spares Hub",
    ownership: "owned",
    operator: "In-house",
    city: "Raunheim",
    lat: 50.01,
    lng: 8.45,
    storageRate: 1500,
    fleetServed: 3200,
    sitesServed: ["FRA-01"]
  },
  {
    code: "WH-IAD",
    name: "Ashburn Spares Hub",
    ownership: "owned",
    operator: "In-house",
    city: "Sterling",
    lat: 38.99,
    lng: -77.42,
    storageRate: 1100,
    fleetServed: 1800,
    sitesServed: ["IAD-01"]
  },
  {
    code: "WH-ZAZ",
    name: "FastFreight Zaragoza DC",
    ownership: "partner",
    operator: "FastFreight Couriers",
    city: "Zaragoza",
    lat: 41.65,
    lng: -0.88,
    storageRate: 1200,
    fleetServed: 1400,
    sitesServed: ["LIS-01"]
  },
  {
    code: "WH-VNL",
    name: "Nimbus Venlo DC",
    ownership: "partner",
    operator: "Nimbus Logistics",
    city: "Venlo",
    lat: 51.37,
    lng: 6.17,
    storageRate: 1300,
    fleetServed: 1500,
    sitesServed: ["AMS-02", "FRA-01"]
  },
  {
    code: "WH-SIN",
    name: "Meridian Singapore DC",
    ownership: "partner",
    operator: "Meridian Air Cargo",
    city: "Singapore",
    lat: 1.36,
    lng: 103.99,
    storageRate: 2100,
    fleetServed: 1200,
    sitesServed: ["SIN-01"]
  }
];

// ── Demand model ──────────────────────────────────────────────────────────

/** Fleet mix by server type. */
const FLEET_MIX: Record<string, number> = {
  "SRV-EDGE-1U": 0.7,
  "SRV-STOR-2U": 0.2,
  "SRV-GPU-2U": 0.1
};
/** Annual failure rate of an installed component (spares demand). */
const AFR: Record<string, number> = {
  "CPU-96C": 0.002,
  "MB-1S": 0.006,
  "DIMM-32": 0.008,
  "DIMM-64": 0.008,
  "SSD-3840": 0.012,
  "NVME-7680": 0.012,
  "HDD-20T": 0.025,
  GPU: 0.012,
  "NIC-25G": 0.006,
  "NIC-100G": 0.007,
  PSU: 0.015,
  "PSU-2000": 0.02,
  "F-200": 0.022,
  "CHS-1U": 0.001,
  "CHS-2U": 0.001,
  "RAIL-KIT": 0.002,
  "CABLE-QSFP": 0.03,
  "OPT-100G": 0.035
};
/** New servers deployed per year, as a share of the fleet (growth + refresh). */
const DEPLOY_RATE = 0.12;
/** Share of new deployments built from warehouse stock (rest ship direct from the integrator). */
const DEPLOY_FROM_STOCK = 0.25;
/** Top-of-rack switches per server deployed, plus failures. */
const TOR_PER_SERVER = 1 / 40;

/** Annual demand per SKU for a warehouse: component failures + servers deployed from stock. */
export function annualDemand(wh: Warehouse, sku: string): number {
  const server = SERVERS.find((s) => s.sku === sku);
  if (server)
    return wh.fleetServed * DEPLOY_RATE * DEPLOY_FROM_STOCK * FLEET_MIX[sku];
  if (sku === "NET-TOR")
    return (
      wh.fleetServed * (DEPLOY_RATE * TOR_PER_SERVER + 0.01 * TOR_PER_SERVER)
    );
  let installedPerServer = 0;
  for (const s of SERVERS) {
    const line = s.bom.find((l) => l.sku === sku);
    if (line) installedPerServer += FLEET_MIX[s.sku] * line.qty;
  }
  return wh.fleetServed * installedPerServer * (AFR[sku] ?? 0);
}

// ── Policy maths ─────────────────────────────────────────────────────────

export type InventoryPolicy = {
  /** Cycle service level per ABC class, e.g. 0.98 */
  serviceLevel: { A: number; B: number; C: number };
  /** Change to all storage rates, e.g. 25 for +25% */
  storageCostChangePct: number;
  /** Cost of capital tied up in stock, per year, as a fraction of unit cost */
  capitalRate: number;
  /** Cost of placing one replenishment order, EUR */
  orderingCost: { owned: number; partner: number };
};

export const DEFAULT_POLICY: InventoryPolicy = {
  serviceLevel: { A: 0.98, B: 0.95, C: 0.9 },
  storageCostChangePct: 0,
  capitalRate: 0.15,
  orderingCost: { owned: 120, partner: 180 }
};

/** Inverse standard normal CDF (Acklam's rational approximation, |error| < 1.2e-9). */
export function zFor(p: number): number {
  if (p <= 0 || p >= 1)
    throw new Error("service level must be between 0 and 1");
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269,
    -30.66479806614716, 2.506628277459239
  ];
  const b = [
    -54.47609879822406, 161.5858368580409, -155.6989798598866,
    66.80131188771972, -13.28068155288572
  ];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783
  ];
  const d = [
    0.007784695709041462, 0.3224671290700398, 2.445134137142996,
    3.754408661907416
  ];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > 1 - lo) return -zFor(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
      q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

/** Classic EOQ: √(2DS/H). */
export function eoq(
  annualDemand: number,
  orderCost: number,
  holdingCost: number
) {
  return holdingCost > 0
    ? Math.sqrt((2 * annualDemand * orderCost) / holdingCost)
    : 0;
}

/** Safety stock with demand and lead-time variability: z·√(L·σd² + d²·σL²). */
export function safetyStock(
  z: number,
  dailyDemand: number,
  dailySd: number,
  leadDays: number,
  leadSd: number
) {
  return (
    z * Math.sqrt(leadDays * dailySd ** 2 + dailyDemand ** 2 * leadSd ** 2)
  );
}

/** Spares demand is lumpy: Poisson-like with some overdispersion. */
const dailySdOf = (dailyDemand: number) => 1.3 * Math.sqrt(dailyDemand);

const ceilTo = (x: number, multiple: number) =>
  Math.max(multiple, Math.ceil(x / multiple) * multiple);
const r2 = (x: number) => Math.round(x * 100) / 100;

/** A, B, C by network-wide annual consumption value (A = top 80%, B = next 15%). */
export function abcClasses(): Record<string, "A" | "B" | "C"> {
  const value = CATALOG.map((s) => ({
    sku: s.sku,
    v:
      WAREHOUSES.reduce((sum, w) => sum + annualDemand(w, s.sku), 0) *
      s.unitCost
  })).sort((a, b) => b.v - a.v);
  const total = value.reduce((a, x) => a + x.v, 0);
  let cum = 0;
  const out: Record<string, "A" | "B" | "C"> = {};
  for (const x of value) {
    const before = cum / total;
    cum += x.v;
    out[x.sku] = before < 0.8 ? "A" : before < 0.95 ? "B" : "C";
  }
  return out;
}

// ── Simulated stock (deterministic) ─────────────────────────────────────

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * On-hand stock as a multiple of each line's lean target (SS + EOQ/2), with
 * planted problems: legacy over-buying at Utrecht, short fans and PSUs at
 * Zaragoza (ties in with the F-200 issue), an expensive GPU overhang in
 * Singapore. Everything else scatters between thin and comfortable.
 */
/** Planted shortages: supplier delays, so nothing is in transit either. */
const isPlantedShort = (wh: string, sku: string) =>
  wh === "WH-ZAZ" && ["F-200", "PSU"].includes(sku);

function stockFactor(wh: string, sku: string, rand: () => number) {
  if (
    wh === "WH-UTR" &&
    ["HDD-20T", "DIMM-64", "DIMM-32", "CHS-2U"].includes(sku)
  )
    return 3 + rand() * 1.5;
  if (isPlantedShort(wh, sku)) return 0.08 + rand() * 0.1;
  if (wh === "WH-SIN" && ["GPU", "SRV-GPU-2U"].includes(sku)) return 4 + rand();
  return 0.7 + rand() * 1.1;
}

// ── Putting it together ──────────────────────────────────────────────────

export type ReplenishmentOrder = {
  warehouse: string;
  sku: string;
  qty: number;
  eta: string;
};

export type StockLine = {
  warehouse: string;
  sku: string;
  description: string;
  category: Category;
  abc: "A" | "B" | "C";
  unitCost: number;
  onHand: number;
  onOrder: number;
  annualDemand: number;
  dailyDemand: number;
  /** Holding cost per unit per year (capital + storage), EUR */
  holdingCost: number;
  /** Share of the holding cost that is storage (the rest is capital), % */
  storageShare: number;
  /** Space the on-hand stock occupies, m³ */
  volume: number;
  /** Annual storage cost of the on-hand stock, EUR */
  storageCost: number;
  eoq: number;
  safetyStock: number;
  reorderPoint: number;
  /** Lean ceiling: safety stock + one EOQ */
  maxStock: number;
  daysCover: number | null;
  status: "reorder" | "excess" | "ok";
  excessUnits: number;
  /** Suggested order when at or below the reorder point */
  suggestedQty: number;
  supplier: string;
  supplierContact: string;
  leadDays: number;
};

export function stockPolicy(
  policy: InventoryPolicy,
  orders: ReplenishmentOrder[],
  now: Date,
  seed = 7
): StockLine[] {
  const rand = prng(seed);
  const abc = abcClasses();
  const lines: StockLine[] = [];
  for (const wh of WAREHOUSES) {
    const storage = wh.storageRate * (1 + policy.storageCostChangePct / 100);
    const S = policy.orderingCost[wh.ownership];
    for (const s of CATALOG) {
      const D = annualDemand(wh, s.sku);
      const factor = stockFactor(wh.code, s.sku, rand);
      if (D <= 0) continue;
      const d = D / 365;
      const H = s.unitCost * policy.capitalRate + s.volume * storage;
      const z = zFor(policy.serviceLevel[abc[s.sku]]);
      const q = ceilTo(eoq(D, S, H), s.pack);
      // Nearest unit, not ceiling: rounding up every slow mover inflates stock.
      const ss = Math.round(
        safetyStock(z, d, dailySdOf(d), s.leadDays, s.leadSd)
      );
      const rop = Math.round(d * s.leadDays + ss);

      // Simulated base stock is anchored to the *default* policy so changing
      // the policy moves the targets, not the shelves.
      const baseH =
        s.unitCost * DEFAULT_POLICY.capitalRate + s.volume * wh.storageRate;
      const baseQ = ceilTo(
        eoq(D, DEFAULT_POLICY.orderingCost[wh.ownership], baseH),
        s.pack
      );
      const baseSs = safetyStock(
        zFor(DEFAULT_POLICY.serviceLevel[abc[s.sku]]),
        d,
        dailySdOf(d),
        s.leadDays,
        s.leadSd
      );
      const received = orders
        .filter(
          (o) =>
            o.warehouse === wh.code && o.sku === s.sku && new Date(o.eta) <= now
        )
        .reduce((a, o) => a + o.qty, 0);
      // Steady state under a reorder-point policy: about d·L already in transit
      // from earlier orders, plus any replenishment orders placed in the app.
      const pipeline = isPlantedShort(wh.code, s.sku)
        ? 0
        : Math.round(d * s.leadDays);
      const onOrder =
        pipeline +
        orders
          .filter(
            (o) =>
              o.warehouse === wh.code &&
              o.sku === s.sku &&
              new Date(o.eta) > now
          )
          .reduce((a, o) => a + o.qty, 0);
      const onHand = Math.round((baseSs + baseQ / 2) * factor) + received;

      const max = ss + q;
      const position = onHand + onOrder;
      const status =
        position <= rop ? "reorder" : onHand > max ? "excess" : "ok";
      lines.push({
        warehouse: wh.code,
        sku: s.sku,
        description: s.description,
        category: s.category,
        abc: abc[s.sku],
        unitCost: s.unitCost,
        onHand,
        onOrder,
        annualDemand: r2(D),
        dailyDemand: r2(d),
        holdingCost: r2(H),
        storageShare: Math.round((100 * s.volume * storage) / H),
        volume: r2(onHand * s.volume),
        storageCost: Math.round(onHand * s.volume * storage),
        eoq: q,
        safetyStock: ss,
        reorderPoint: rop,
        maxStock: max,
        daysCover: d > 0 ? Math.round(onHand / d) : null,
        status,
        excessUnits: Math.max(0, onHand - max),
        suggestedQty:
          status === "reorder"
            ? q * Math.max(1, Math.ceil((rop - position + 1) / q))
            : 0,
        supplier: s.supplier,
        supplierContact: s.supplierContact,
        leadDays: s.leadDays
      });
    }
  }
  return lines;
}

export type WarehouseSummary = Warehouse & {
  skus: number;
  reorder: number;
  excess: number;
  stockValue: number;
  excessValue: number;
  /** Annual cost of holding today's stock */
  holdingCost: number;
  /** Annual holding + ordering cost if run at the lean policy */
  leanCost: number;
  /** Storage space used and its annual cost */
  volume: number;
  storageCost: number;
  /** Space freed if excess stock were run down to the lean ceiling, m³ */
  excessVolume: number;
  health: "reorder" | "excess" | "ok";
};

/**
 * One status per warehouse for the map: urgent replenishment beats excess.
 * A single slow C-class line at its reorder point isn't worth a red marker.
 */
export function warehouseHealth(ls: StockLine[]): "reorder" | "excess" | "ok" {
  const reorder = ls.filter((l) => l.status === "reorder");
  if (reorder.some((l) => l.abc !== "C") || reorder.length >= 4)
    return "reorder";
  const value = ls.reduce((a, l) => a + l.onHand * l.unitCost, 0);
  const excess = ls.reduce((a, l) => a + l.excessUnits * l.unitCost, 0);
  return value > 0 && excess / value > 0.15 ? "excess" : "ok";
}

export function summarise(
  lines: StockLine[],
  policy: InventoryPolicy
): WarehouseSummary[] {
  return WAREHOUSES.map((wh) => {
    const ls = lines.filter((l) => l.warehouse === wh.code);
    const S = policy.orderingCost[wh.ownership];
    const reorder = ls.filter((l) => l.status === "reorder").length;
    const excess = ls.filter((l) => l.status === "excess").length;
    return {
      ...wh,
      storageRate: Math.round(
        wh.storageRate * (1 + policy.storageCostChangePct / 100)
      ),
      skus: ls.length,
      reorder,
      excess,
      stockValue: Math.round(ls.reduce((a, l) => a + l.onHand * l.unitCost, 0)),
      excessValue: Math.round(
        ls.reduce((a, l) => a + l.excessUnits * l.unitCost, 0)
      ),
      holdingCost: Math.round(
        ls.reduce((a, l) => a + l.onHand * l.holdingCost, 0)
      ),
      leanCost: Math.round(
        ls.reduce(
          (a, l) =>
            a +
            (l.safetyStock + l.eoq / 2) * l.holdingCost +
            (l.annualDemand / Math.max(1, l.eoq)) * S,
          0
        )
      ),
      volume: r2(ls.reduce((a, l) => a + l.volume, 0)),
      storageCost: Math.round(ls.reduce((a, l) => a + l.storageCost, 0)),
      excessVolume: r2(
        ls.reduce(
          (a, l) =>
            a + (l.onHand > 0 ? (l.excessUnits / l.onHand) * l.volume : 0),
          0
        )
      ),
      health: warehouseHealth(ls)
    };
  });
}

/** How many of each server a warehouse could build from its component stock. */
export function buildable(lines: StockLine[]) {
  return WAREHOUSES.flatMap((wh) =>
    SERVERS.map((s) => {
      let units = Infinity;
      let limiting = "";
      for (const l of s.bom) {
        const stock =
          lines.find((x) => x.warehouse === wh.code && x.sku === l.sku)
            ?.onHand ?? 0;
        const can = Math.floor(stock / l.qty);
        if (can < units) {
          units = can;
          limiting = l.sku;
        }
      }
      return {
        warehouse: wh.code,
        server: s.sku,
        units: units === Infinity ? 0 : units,
        limiting
      };
    })
  );
}

export function boms() {
  return SERVERS.map((s) => ({
    sku: s.sku,
    description: s.description,
    assembly: s.assembly,
    cost: rollupCost(s),
    lines: s.bom.map((l) => {
      const c = componentBySku.get(l.sku)!;
      return {
        sku: l.sku,
        description: c.description,
        qty: l.qty,
        unitCost: c.unitCost,
        extended: c.unitCost * l.qty
      };
    })
  }));
}
