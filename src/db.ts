import type { NewShipment } from "./shipments.ts";
import { LG_SCHEMA } from "./logistics-db.ts";
import type { CodeRow } from "./codes.ts";
import type { ExceptionType, ReceiptLine, Severity } from "./reconcile.ts";

type SqlValue = string | number | null;
export type Row = Record<string, SqlValue>;

/**
 * Runs one SQL statement and returns its rows. In the agent this wraps
 * ctx.storage.sql.exec; in tests it wraps node:sqlite, so the same SQL is
 * exercised in both.
 */
export type Exec = (query: string, ...bindings: SqlValue[]) => Row[];

export type ShipmentStatus =
  | "booked"
  | "code_issued"
  | "delivered"
  | "closed"
  | "exceptions_open"
  | "missed";

// Shipments still waiting for the partner to turn up.
export const AWAITING_DELIVERY: ShipmentStatus[] = ["booked", "code_issued"];

// Section 4 of the build spec, plus workflow bookkeeping columns.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS shipments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rma_ref TEXT,
    site TEXT NOT NULL,
    partner TEXT NOT NULL,
    partner_contact TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('inbound_replacement', 'outbound_return')),
    eta_window_start TEXT NOT NULL,
    eta_window_end TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'booked',
    created_at TEXT NOT NULL,
    workflow_id TEXT,
    delivered_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS shipment_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shipment_id INTEGER NOT NULL REFERENCES shipments(id),
    part_number TEXT NOT NULL,
    serial_number TEXT,
    description TEXT,
    qty INTEGER NOT NULL CHECK (qty >= 1)
  )`,
  `CREATE TABLE IF NOT EXISTS access_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shipment_id INTEGER NOT NULL REFERENCES shipments(id),
    code_hash TEXT NOT NULL,
    valid_from TEXT NOT NULL,
    valid_to TEXT NOT NULL,
    sent_at TEXT,
    used_at TEXT,
    status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'used', 'expired', 'revoked'))
  )`,
  `CREATE TABLE IF NOT EXISTS receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shipment_id INTEGER NOT NULL REFERENCES shipments(id),
    part_number TEXT NOT NULL,
    serial_number TEXT,
    condition TEXT NOT NULL CHECK (condition IN ('ok', 'damaged')),
    received_at TEXT NOT NULL,
    received_by TEXT,
    qty INTEGER NOT NULL DEFAULT 1 CHECK (qty >= 1)
  )`,
  `CREATE TABLE IF NOT EXISTS exceptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shipment_id INTEGER NOT NULL REFERENCES shipments(id),
    type TEXT NOT NULL,
    detail TEXT NOT NULL,
    severity TEXT NOT NULL,
    owner TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
    opened_at TEXT NOT NULL,
    due_by TEXT,
    resolved_at TEXT,
    resolution_note TEXT,
    overdue_flagged_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shipment_id INTEGER REFERENCES shipments(id),
    "to" TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('draft', 'sent')),
    sent_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS kaizen_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    problem TEXT NOT NULL,
    root_cause TEXT,
    countermeasure TEXT,
    owner TEXT,
    stage TEXT NOT NULL DEFAULT 'plan' CHECK (stage IN ('plan', 'do', 'check', 'act')),
    signal_key TEXT,
    simulated INTEGER NOT NULL DEFAULT 0,
    opened_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS replenishment_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    warehouse TEXT NOT NULL,
    sku TEXT NOT NULL,
    qty INTEGER NOT NULL CHECK (qty >= 1),
    unit_cost REAL NOT NULL,
    supplier TEXT NOT NULL,
    created_at TEXT NOT NULL,
    eta TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_items_shipment ON shipment_items(shipment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_receipts_shipment ON receipts(shipment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_exceptions_status ON exceptions(status)`
];

// Columns added after Phase 1; added in place to databases created before them.
const ADDED_COLUMNS: [table: string, column: string, ddl: string][] = [
  ["shipments", "workflow_id", "TEXT"],
  ["shipments", "delivered_at", "TEXT"],
  ["receipts", "qty", "INTEGER NOT NULL DEFAULT 1"],
  ["exceptions", "overdue_flagged_at", "TEXT"]
];

export function ensureSchema(exec: Exec) {
  for (const statement of [...SCHEMA, ...LG_SCHEMA]) exec(statement);
  for (const [table, column, ddl] of ADDED_COLUMNS) {
    const has = exec(`PRAGMA table_info(${table})`).some(
      (c) => c.name === column
    );
    if (!has) exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

// ---- Shipments ------------------------------------------------------------

/** Inserts a validated shipment and its manifest. Returns the shipment id. */
export function insertShipment(exec: Exec, s: NewShipment, now: Date): number {
  const [row] = exec(
    `INSERT INTO shipments
       (rma_ref, site, partner, partner_contact, direction, eta_window_start, eta_window_end, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
    s.rma_ref,
    s.site,
    s.partner,
    s.partner_contact,
    s.direction,
    s.eta_window_start,
    s.eta_window_end,
    now.toISOString()
  );
  const id = Number(row.id);
  for (const item of s.items) {
    exec(
      `INSERT INTO shipment_items (shipment_id, part_number, serial_number, description, qty)
       VALUES (?, ?, ?, ?, ?)`,
      id,
      item.part_number,
      item.serial_number,
      item.description,
      item.qty
    );
  }
  return id;
}

export type ShipmentWithItems = Record<string, SqlValue | Row[]> & {
  items: Row[];
};

const withItems = (exec: Exec, shipments: Row[]): ShipmentWithItems[] =>
  shipments.map((s) => ({
    ...s,
    items: exec(
      `SELECT part_number, serial_number, description, qty
       FROM shipment_items WHERE shipment_id = ? ORDER BY id`,
      s.id
    )
  }));

export function listShipments(exec: Exec): ShipmentWithItems[] {
  return withItems(exec, exec(`SELECT * FROM shipments ORDER BY id DESC`));
}

export function getShipment(
  exec: Exec,
  id: number
): ShipmentWithItems | undefined {
  return withItems(exec, exec(`SELECT * FROM shipments WHERE id = ?`, id))[0];
}

export function awaitingDelivery(exec: Exec): ShipmentWithItems[] {
  return withItems(
    exec,
    exec(
      `SELECT * FROM shipments WHERE status IN (${AWAITING_DELIVERY.map(() => "?").join(", ")})
       ORDER BY eta_window_start`,
      ...AWAITING_DELIVERY
    )
  );
}

export function setShipmentStatus(
  exec: Exec,
  id: number,
  status: ShipmentStatus,
  onlyFrom?: ShipmentStatus[]
) {
  if (onlyFrom) {
    exec(
      `UPDATE shipments SET status = ? WHERE id = ? AND status IN (${onlyFrom.map(() => "?").join(", ")})`,
      status,
      id,
      ...onlyFrom
    );
  } else {
    exec(`UPDATE shipments SET status = ? WHERE id = ?`, status, id);
  }
}

export function setWorkflowId(exec: Exec, id: number, workflowId: string) {
  exec(`UPDATE shipments SET workflow_id = ? WHERE id = ?`, workflowId, id);
}

// ---- Receipts -------------------------------------------------------------

export function insertReceipts(
  exec: Exec,
  shipmentId: number,
  receipts: ReceiptLine[],
  receivedBy: string | null,
  now: Date
) {
  for (const r of receipts) {
    exec(
      `INSERT INTO receipts (shipment_id, part_number, serial_number, condition, qty, received_at, received_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      shipmentId,
      r.part_number,
      r.serial_number,
      r.condition,
      r.qty,
      now.toISOString(),
      receivedBy
    );
  }
  exec(
    `UPDATE shipments SET status = 'delivered', delivered_at = ? WHERE id = ?`,
    now.toISOString(),
    shipmentId
  );
}

export function getReceipts(exec: Exec, shipmentId: number): ReceiptLine[] {
  return exec(
    `SELECT part_number, serial_number, qty, condition FROM receipts WHERE shipment_id = ? ORDER BY id`,
    shipmentId
  ) as unknown as ReceiptLine[];
}

// ---- Access codes ---------------------------------------------------------

export function latestCode(
  exec: Exec,
  shipmentId: number
): (CodeRow & { id: number }) | undefined {
  return exec(
    `SELECT id, code_hash, valid_from, valid_to, status FROM access_codes
     WHERE shipment_id = ? ORDER BY id DESC LIMIT 1`,
    shipmentId
  )[0] as unknown as (CodeRow & { id: number }) | undefined;
}

export function insertCode(
  exec: Exec,
  shipmentId: number,
  codeHash: string,
  validFrom: string,
  validTo: string,
  now: Date
) {
  exec(
    `INSERT INTO access_codes (shipment_id, code_hash, valid_from, valid_to, sent_at)
     VALUES (?, ?, ?, ?, ?)`,
    shipmentId,
    codeHash,
    validFrom,
    validTo,
    now.toISOString()
  );
}

/** Moves the shipment's live code to a final state. Returns true if one was live. */
export function closeCode(
  exec: Exec,
  shipmentId: number,
  status: "used" | "expired" | "revoked",
  now: Date
): boolean {
  const rows = exec(
    `UPDATE access_codes SET status = ?, used_at = CASE WHEN ? = 'used' THEN ? ELSE used_at END
     WHERE shipment_id = ? AND status = 'issued' RETURNING id`,
    status,
    status,
    now.toISOString(),
    shipmentId
  );
  return rows.length > 0;
}

// ---- Exceptions -----------------------------------------------------------

export type NewException = {
  shipment_id: number;
  type: ExceptionType;
  detail: string;
  severity: Severity;
  owner: string;
  due_by: string;
};

export function insertException(
  exec: Exec,
  e: NewException,
  now: Date
): number {
  const [row] = exec(
    `INSERT INTO exceptions (shipment_id, type, detail, severity, owner, opened_at, due_by)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    e.shipment_id,
    e.type,
    e.detail,
    e.severity,
    e.owner,
    now.toISOString(),
    e.due_by
  );
  return Number(row.id);
}

export type ExceptionFilter = {
  includeResolved?: boolean;
  partner?: string;
  shipmentId?: number;
  ids?: number[];
  since?: string;
};

/** Exceptions sorted by severity, then due time (spec section 8). */
export function listExceptions(exec: Exec, f: ExceptionFilter = {}): Row[] {
  const where: string[] = [];
  const args: SqlValue[] = [];
  if (!f.includeResolved) where.push(`e.status != 'resolved'`);
  if (f.partner) {
    where.push(`s.partner = ?`);
    args.push(f.partner);
  }
  if (f.shipmentId != null) {
    where.push(`e.shipment_id = ?`);
    args.push(f.shipmentId);
  }
  if (f.ids?.length) {
    where.push(`e.id IN (${f.ids.map(() => "?").join(", ")})`);
    args.push(...f.ids);
  }
  if (f.since) {
    where.push(`e.opened_at >= ?`);
    args.push(f.since);
  }
  return exec(
    `SELECT e.*, s.site, s.partner, s.partner_contact, s.rma_ref
     FROM exceptions e JOIN shipments s ON s.id = e.shipment_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY CASE e.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
              e.due_by, e.id`,
    ...args
  );
}

export function updateException(
  exec: Exec,
  id: number,
  status: "in_progress" | "resolved",
  note: string | null,
  now: Date
): Row | undefined {
  return exec(
    `UPDATE exceptions
     SET status = ?,
         resolution_note = COALESCE(?, resolution_note),
         resolved_at = CASE WHEN ? = 'resolved' THEN ? ELSE NULL END
     WHERE id = ? RETURNING *`,
    status,
    note,
    status,
    now.toISOString(),
    id
  )[0];
}

/** Open exceptions past their due time that haven't been flagged yet. */
export function overdueUnflagged(
  exec: Exec,
  shipmentId: number,
  now: Date
): Row[] {
  return exec(
    `SELECT e.*, s.partner_contact FROM exceptions e JOIN shipments s ON s.id = e.shipment_id
     WHERE e.shipment_id = ? AND e.status != 'resolved' AND e.overdue_flagged_at IS NULL AND e.due_by <= ?`,
    shipmentId,
    now.toISOString()
  );
}

export function flagOverdue(exec: Exec, id: number, now: Date) {
  exec(
    `UPDATE exceptions SET overdue_flagged_at = ? WHERE id = ?`,
    now.toISOString(),
    id
  );
}

// ---- Outbox ---------------------------------------------------------------

export type NewMessage = {
  shipment_id: number | null;
  to: string;
  subject: string;
  body: string;
  status: "draft" | "sent";
};

export function insertOutbox(exec: Exec, m: NewMessage, now: Date): number {
  const [row] = exec(
    `INSERT INTO outbox (shipment_id, "to", subject, body, status, sent_at)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    m.shipment_id,
    m.to,
    m.subject,
    m.body,
    m.status,
    m.status === "sent" ? now.toISOString() : null
  );
  return Number(row.id);
}

/** Sends a draft. Returns the message, or undefined if it isn't a draft. */
export function sendDraft(exec: Exec, id: number, now: Date): Row | undefined {
  return exec(
    `UPDATE outbox SET status = 'sent', sent_at = ? WHERE id = ? AND status = 'draft' RETURNING *`,
    now.toISOString(),
    id
  )[0];
}

export function listOutbox(exec: Exec, limit = 50): Row[] {
  return exec(`SELECT * FROM outbox ORDER BY id DESC LIMIT ?`, limit);
}

// ---- Kaizen log (PDCA) -------------------------------------------------------

export const PDCA = ["plan", "do", "check", "act"] as const;
export type Stage = (typeof PDCA)[number];

export type NewKaizen = {
  title: string;
  problem: string;
  root_cause: string | null;
  countermeasure: string | null;
  owner: string | null;
  stage: Stage;
  signal_key: string | null;
  simulated: boolean;
  opened_at: string;
};

export function insertKaizen(exec: Exec, k: NewKaizen, now: Date): number {
  const [row] = exec(
    `INSERT INTO kaizen_log (title, problem, root_cause, countermeasure, owner, stage, signal_key, simulated, opened_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    k.title,
    k.problem,
    k.root_cause,
    k.countermeasure,
    k.owner,
    k.stage,
    k.signal_key,
    k.simulated ? 1 : 0,
    k.opened_at,
    now.toISOString()
  );
  return Number(row.id);
}

export function listKaizen(exec: Exec): Row[] {
  return exec(`SELECT * FROM kaizen_log ORDER BY id DESC`);
}

/** Moves an entry to the next PDCA stage. Returns the row, or undefined at Act. */
export function advanceKaizen(
  exec: Exec,
  id: number,
  now: Date
): Row | undefined {
  const [row] = exec(`SELECT stage FROM kaizen_log WHERE id = ?`, id);
  if (!row) return undefined;
  const next = PDCA[PDCA.indexOf(row.stage as Stage) + 1];
  if (!next) return undefined;
  return exec(
    `UPDATE kaizen_log SET stage = ?, updated_at = ? WHERE id = ? RETURNING *`,
    next,
    now.toISOString(),
    id
  )[0];
}

export function updateKaizenRootCause(
  exec: Exec,
  id: number,
  rootCause: string,
  now: Date
) {
  exec(
    `UPDATE kaizen_log SET root_cause = ?, updated_at = ? WHERE id = ?`,
    rootCause,
    now.toISOString(),
    id
  );
}

// ---- Settings & replenishment ---------------------------------------------------

export function getSetting<T>(exec: Exec, key: string, fallback: T): T {
  const [row] = exec(`SELECT value FROM settings WHERE key = ?`, key);
  if (!row) return fallback;
  try {
    return JSON.parse(String(row.value)) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(exec: Exec, key: string, value: unknown) {
  exec(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    JSON.stringify(value)
  );
}

export type NewReplenishment = {
  warehouse: string;
  sku: string;
  qty: number;
  unit_cost: number;
  supplier: string;
  eta: string;
};

export function insertReplenishment(
  exec: Exec,
  o: NewReplenishment,
  now: Date
): number {
  const [row] = exec(
    `INSERT INTO replenishment_orders (warehouse, sku, qty, unit_cost, supplier, created_at, eta)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    o.warehouse,
    o.sku,
    o.qty,
    o.unit_cost,
    o.supplier,
    now.toISOString(),
    o.eta
  );
  return Number(row.id);
}

export function listReplenishments(exec: Exec): Row[] {
  return exec(`SELECT * FROM replenishment_orders ORDER BY id DESC`);
}
