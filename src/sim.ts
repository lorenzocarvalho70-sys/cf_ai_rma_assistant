// Simulated 12-week process history for the Kaizen view (fictional data).
// Deterministic: the same seed and week always give the same records, so the
// trends don't jump around between refreshes. Four problems are planted
// below; the analytics in kaizen.ts must find them without being told.

import { PARTNERS } from "./shipments.ts";
import {
  SEVERITY,
  SLA_HOURS,
  type ExceptionType,
  type Severity
} from "./reconcile.ts";

export const SIM_WEEKS = 12;
const DAY = 86_400_000;

export const PARTS = [
  { part: "PSU", serialised: true },
  { part: "SSD-3840", serialised: true },
  { part: "GPU", serialised: true },
  { part: "F-200", serialised: false },
  { part: "DIMM-64", serialised: false },
  { part: "CABLE-QSFP", serialised: false }
] as const;

const WINDOW_HOURS = [6, 7, 9, 10, 11, 13, 14, 16, 17];

export type RecordException = {
  type: ExceptionType;
  severity: Severity;
  /** Hours to resolve; null while still open. */
  resolveHours: number | null;
  slaBreached: boolean;
};

/** One shipment as the process analytics see it, simulated or live. */
export type ProcessRecord = {
  id: string;
  simulated: boolean;
  /** 0 = oldest simulated week, SIM_WEEKS = the current (live) week. */
  week: number;
  site: string;
  partner: string;
  part: string;
  serialised: boolean;
  windowHour: number;
  /** 0 = Monday … 6 = Sunday */
  weekday: number;
  exceptions: RecordException[];
};

/** Monday 00:00 UTC of the week containing `now`. */
export function weekStart(now: Date): Date {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const offset = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - offset * DAY);
}

/** Start date of week index `w`, where SIM_WEEKS is the current week. */
export function weekStartOf(w: number, now: Date): Date {
  return new Date(weekStart(now).getTime() - (SIM_WEEKS - w) * 7 * DAY);
}

// mulberry32: small, fast, seedable PRNG.
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

type Ctx = {
  partner: string;
  site: string;
  week: number;
  serialised: boolean;
  part: string;
  windowHour: number;
};

/** Probability of each exception type for one shipment, including the planted problems. */
function rates(c: Ctx): Partial<Record<ExceptionType, number>> {
  const p: Partial<Record<ExceptionType, number>> = {
    DAMAGED_IN_TRANSIT: 0.03,
    SHORT_SHIPMENT: 0.02,
    UNEXPECTED_ITEM: 0.01,
    MISSED_DELIVERY: 0.03,
    ACCESS_VIOLATION: 0.005,
    SERIAL_MISMATCH: c.serialised ? 0.015 : 0,
    QTY_VARIANCE: c.serialised ? 0 : 0.02
  };
  // A. FastFreight -> LIS-01: damage jumps from week 7 (packaging change).
  if (
    c.partner === "FastFreight Couriers" &&
    c.site === "LIS-01" &&
    c.week >= 6
  ) {
    p.DAMAGED_IN_TRANSIT = 0.32;
  }
  // B. Nimbus misses windows that open before 08:00 (driver shifts start 07:30).
  if (c.partner === "Nimbus Logistics" && c.windowHour < 8)
    p.MISSED_DELIVERY = 0.38;
  // C. DUB-03 keys serials by hand; barcode scanning fixes it from week 9.
  if (c.site === "DUB-03" && c.serialised)
    p.SERIAL_MISMATCH = c.week < 8 ? 0.24 : 0.015;
  // D. F-200 fans ship in 4-packs that get split across cartons.
  if (c.part === "F-200") p.QTY_VARIANCE = 0.26;
  return p;
}

const BASE_RESOLVE_HOURS: Record<Severity, number> = {
  critical: 2.5,
  high: 16,
  medium: 30
};

export function simulateHistory(now: Date, seed = 20261015): ProcessRecord[] {
  const rand = prng(seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const records: ProcessRecord[] = [];

  for (let week = 0; week < SIM_WEEKS; week++) {
    for (const partner of PARTNERS) {
      for (const site of partner.sites) {
        const volume = 3 + Math.floor(rand() * 4); // 3–6 shipments per lane per week
        for (let i = 0; i < volume; i++) {
          const { part, serialised } = pick(PARTS);
          const windowHour = pick(WINDOW_HOURS);
          const weekday = Math.floor(rand() * 5);
          const ctx = {
            partner: partner.name,
            site,
            week,
            serialised,
            part,
            windowHour
          };
          const exceptions: RecordException[] = [];
          for (const [type, p] of Object.entries(rates(ctx)) as [
            ExceptionType,
            number
          ][]) {
            if (rand() >= p) continue;
            const severity = SEVERITY[type];
            const slow = partner.name === "FastFreight Couriers" ? 1.6 : 1;
            // Skewed resolve time: mostly near the base, with a long tail.
            const resolveHours =
              Math.round(
                BASE_RESOLVE_HOURS[severity] *
                  slow *
                  (0.4 + 1.4 * rand() ** 2) *
                  10
              ) / 10;
            exceptions.push({
              type,
              severity,
              resolveHours,
              slaBreached: resolveHours > SLA_HOURS[severity]
            });
          }
          records.push({
            id: `sim-${records.length + 1}`,
            simulated: true,
            week,
            site,
            partner: partner.name,
            part,
            serialised,
            windowHour,
            weekday,
            exceptions
          });
        }
      }
    }
  }
  return records;
}
