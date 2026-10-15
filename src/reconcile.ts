// Deterministic shipped-vs-received matching (spec section 7). The LLM never
// does this; it only explains the results.

export type ExceptionType =
  | "SHORT_SHIPMENT"
  | "UNEXPECTED_ITEM"
  | "SERIAL_MISMATCH"
  | "DAMAGED_IN_TRANSIT"
  | "QTY_VARIANCE"
  | "MISSED_DELIVERY"
  | "ACCESS_VIOLATION";

export type Severity = "critical" | "high" | "medium";

export const SEVERITY: Record<ExceptionType, Severity> = {
  SHORT_SHIPMENT: "high",
  UNEXPECTED_ITEM: "medium",
  SERIAL_MISMATCH: "high",
  DAMAGED_IN_TRANSIT: "high",
  QTY_VARIANCE: "medium",
  MISSED_DELIVERY: "high",
  ACCESS_VIOLATION: "critical"
};

// SLA in spec hours; scaled to real time by the HOUR_SECONDS setting.
export const SLA_HOURS: Record<Severity, number> = {
  critical: 4,
  high: 24,
  medium: 48
};

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2
};

export type ManifestLine = {
  part_number: string;
  serial_number: string | null;
  qty: number;
};

export type ReceiptLine = ManifestLine & { condition: "ok" | "damaged" };

export type Finding = { type: ExceptionType; detail: string };

export type Reconciliation = { matched: string[]; findings: Finding[] };

export function reconcile(
  manifest: ManifestLine[],
  receipts: ReceiptLine[]
): Reconciliation {
  const matched: string[] = [];
  const findings: Finding[] = [];

  // 1. Serialised parts: exact serial matches first.
  const shippedSerials = manifest.filter((m) => m.serial_number);
  const receivedSerials = receipts.filter((r) => r.serial_number);
  const unmatchedShipped: ManifestLine[] = [];
  const unmatchedReceived = [...receivedSerials];

  for (const m of shippedSerials) {
    const i = unmatchedReceived.findIndex(
      (r) => r.serial_number === m.serial_number
    );
    if (i === -1) {
      unmatchedShipped.push(m);
      continue;
    }
    const [r] = unmatchedReceived.splice(i, 1);
    if (r.condition === "damaged") {
      findings.push({
        type: "DAMAGED_IN_TRANSIT",
        detail: `${m.part_number} serial ${m.serial_number} received damaged.`
      });
    } else {
      matched.push(`${m.part_number} ${m.serial_number}`);
    }
  }

  // 2. A missing serial and an unexpected serial of the same part are one
  //    mismatch, not a short plus an over-receipt.
  for (const m of [...unmatchedShipped]) {
    const i = unmatchedReceived.findIndex(
      (r) => r.part_number === m.part_number
    );
    if (i === -1) continue;
    const [r] = unmatchedReceived.splice(i, 1);
    unmatchedShipped.splice(unmatchedShipped.indexOf(m), 1);
    findings.push({
      type: "SERIAL_MISMATCH",
      detail: `${m.part_number}: expected serial ${m.serial_number}, received ${r.serial_number}.`
    });
    if (r.condition === "damaged") {
      findings.push({
        type: "DAMAGED_IN_TRANSIT",
        detail: `${r.part_number} serial ${r.serial_number} received damaged.`
      });
    }
  }

  for (const m of unmatchedShipped) {
    findings.push({
      type: "SHORT_SHIPMENT",
      detail: `${m.part_number} serial ${m.serial_number} shipped but not received.`
    });
  }
  for (const r of unmatchedReceived) {
    findings.push({
      type: "UNEXPECTED_ITEM",
      detail: `${r.part_number} serial ${r.serial_number} received but not on the manifest.`
    });
  }

  // 3. Non-serialised parts: compare quantities per part number.
  const shippedQty = new Map<string, number>();
  for (const m of manifest.filter((m) => !m.serial_number)) {
    shippedQty.set(m.part_number, (shippedQty.get(m.part_number) ?? 0) + m.qty);
  }
  const receivedQty = new Map<string, { ok: number; damaged: number }>();
  for (const r of receipts.filter((r) => !r.serial_number)) {
    const q = receivedQty.get(r.part_number) ?? { ok: 0, damaged: 0 };
    q[r.condition] += r.qty;
    receivedQty.set(r.part_number, q);
  }

  for (const [part, shipped] of shippedQty) {
    const got = receivedQty.get(part) ?? { ok: 0, damaged: 0 };
    const total = got.ok + got.damaged;
    if (total === 0) {
      findings.push({
        type: "SHORT_SHIPMENT",
        detail: `${part}: ${shipped} shipped, none received.`
      });
    } else if (total !== shipped) {
      findings.push({
        type: "QTY_VARIANCE",
        detail: `${part}: ${shipped} shipped, ${total} received.`
      });
    }
    if (got.damaged > 0) {
      findings.push({
        type: "DAMAGED_IN_TRANSIT",
        detail: `${part}: ${got.damaged} received damaged.`
      });
    }
    if (total === shipped && got.damaged === 0)
      matched.push(`${part} x${shipped}`);
  }
  for (const [part, got] of receivedQty) {
    if (shippedQty.has(part)) continue;
    findings.push({
      type: "UNEXPECTED_ITEM",
      detail: `${part}: ${got.ok + got.damaged} received but not on the manifest.`
    });
  }

  return { matched, findings };
}
