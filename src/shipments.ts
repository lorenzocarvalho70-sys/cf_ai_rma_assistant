import { z } from "zod";
import { llm } from "./llm-schema.ts";

// Fictional reference data only. Never put real sites, partners or contacts here.
// Coordinates are the host cities, for the control-tower map.
export const SITES = [
  { code: "LIS-01", name: "Lisbon", lat: 38.72, lng: -9.14 },
  { code: "AMS-02", name: "Amsterdam", lat: 52.37, lng: 4.9 },
  { code: "DUB-03", name: "Dublin", lat: 53.35, lng: -6.26 },
  { code: "FRA-01", name: "Frankfurt", lat: 50.11, lng: 8.68 },
  { code: "IAD-01", name: "Ashburn", lat: 39.04, lng: -77.49 },
  { code: "SIN-01", name: "Singapore", lat: 1.35, lng: 103.82 }
] as const;

// Each partner ships from one hub and serves a fixed set of sites (its lanes).
export const PARTNERS = [
  {
    name: "FastFreight Couriers",
    contact: "dispatch@fastfreight.example",
    hub: { city: "Madrid", lat: 40.42, lng: -3.7 },
    sites: ["LIS-01", "FRA-01", "AMS-02"]
  },
  {
    name: "Nimbus Logistics",
    contact: "ops@nimbus-logistics.example",
    hub: { city: "Rotterdam", lat: 51.92, lng: 4.48 },
    sites: ["DUB-03", "AMS-02", "FRA-01"]
  },
  {
    name: "BlueLine Express",
    contact: "bookings@blueline.example",
    hub: { city: "Paris", lat: 49.01, lng: 2.55 },
    sites: ["AMS-02", "FRA-01", "LIS-01", "DUB-03"]
  },
  {
    name: "Meridian Air Cargo",
    contact: "control@meridian-air.example",
    hub: { city: "Dubai", lat: 25.25, lng: 55.36 },
    sites: ["IAD-01", "SIN-01", "FRA-01"]
  }
] as const;

export const DIRECTIONS = ["inbound_replacement", "outbound_return"] as const;
export type Direction = (typeof DIRECTIONS)[number];

// What the LLM fills in. Deliberately loose (nullish everywhere) so Llama's
// output always reaches validateShipment, which returns readable problems
// instead of a schema error. llm.* also undoes Llama's stringified values.
export const shipmentInputSchema = z.object({
  site: z.string().describe("Site code or city, e.g. LIS-01 or Lisbon"),
  partner: z.string().describe("Delivery partner, e.g. FastFreight Couriers"),
  direction: llm
    .enum(DIRECTIONS)
    .describe(
      "inbound_replacement = parts arriving at the site; outbound_return = faulty parts leaving the site"
    ),
  eta_window_start: z
    .string()
    .describe("Delivery window start, ISO 8601 UTC, e.g. 2026-10-16T09:00:00Z"),
  eta_window_end: z.string().describe("Delivery window end, ISO 8601 UTC"),
  items: llm
    .array(
      z.object({
        part_number: z
          .string()
          .describe("Part number or part type, e.g. PSU or F-200"),
        serial_number: llm
          .optString()
          .describe(
            "One serial number. Serialised parts need one item per serial. Omit for non-serialised parts."
          ),
        description: llm
          .optString()
          .describe(
            "Plain name of the part as the user said it, e.g. fan, PSU, SSD"
          ),
        qty: llm
          .optNumber()
          .describe("Quantity. Always 1 when serial_number is set.")
      })
    )
    .describe("The manifest: every part on the shipment"),
  rma_ref: llm.optString().describe("RMA reference if given, e.g. RMA-889"),
  partner_contact: llm
    .optString()
    .describe("Partner email, only if the user gives one")
});
export type ShipmentInput = z.infer<typeof shipmentInputSchema>;

export type NewShipmentItem = {
  part_number: string;
  serial_number: string | null;
  description: string | null;
  qty: number;
};

export type NewShipment = {
  rma_ref: string | null;
  site: string;
  partner: string;
  partner_contact: string;
  direction: Direction;
  eta_window_start: string;
  eta_window_end: string;
  items: NewShipmentItem[];
};

export type ValidationResult =
  | { ok: true; value: NewShipment }
  | { ok: false; errors: string[] };

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function findSite(input: string) {
  const key = squash(input);
  if (!key) return undefined;
  return SITES.find(
    (s) =>
      squash(s.code) === key ||
      squash(s.name) === key ||
      squash(`${s.code} ${s.name}`) === key
  );
}

export function findPartner(input: string) {
  const key = squash(input);
  if (!key) return undefined;
  return PARTNERS.find((p) => squash(p.name).startsWith(key));
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Deterministic checks on what the LLM extracted from chat. Nothing is
 * written unless this passes, so model mistakes surface as questions to the
 * operator rather than bad rows.
 */
export function validateShipment(
  input: ShipmentInput,
  now: Date
): ValidationResult {
  const errors: string[] = [];

  const site = findSite(input.site ?? "");
  if (!site) {
    errors.push(
      `Unknown site "${input.site}". Known sites: ${SITES.map((s) => `${s.code} ${s.name}`).join(", ")}.`
    );
  }

  const partner = findPartner(input.partner ?? "");
  if (!partner) {
    errors.push(
      `Unknown partner "${input.partner}". Known partners: ${PARTNERS.map((p) => p.name).join(", ")}.`
    );
  }

  const contact = input.partner_contact?.trim() || partner?.contact || "";
  if (input.partner_contact && !EMAIL.test(contact)) {
    errors.push(
      `Partner contact "${input.partner_contact}" is not an email address.`
    );
  }

  if (!DIRECTIONS.includes(input.direction)) {
    errors.push(`Direction must be one of: ${DIRECTIONS.join(", ")}.`);
  }

  const start = new Date(input.eta_window_start);
  const end = new Date(input.eta_window_end);
  if (Number.isNaN(start.getTime())) {
    errors.push(
      `Window start "${input.eta_window_start}" is not a valid date.`
    );
  }
  if (Number.isNaN(end.getTime())) {
    errors.push(`Window end "${input.eta_window_end}" is not a valid date.`);
  }
  if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
    if (end <= start) errors.push("Window end must be after window start.");
    if (end <= now) errors.push("Delivery window has already ended.");
  }

  const items: NewShipmentItem[] = [];
  const seenSerials = new Set<string>();
  if (!input.items?.length) errors.push("The manifest has no items.");
  for (const [i, raw] of (input.items ?? []).entries()) {
    const line = `Item ${i + 1}`;
    const part = raw.part_number?.trim().toUpperCase() ?? "";
    if (!part) errors.push(`${line}: missing part number.`);

    const serial = raw.serial_number?.trim().toUpperCase() || null;
    if (serial && /[,;\s]/.test(serial)) {
      errors.push(
        `${line}: "${raw.serial_number}" looks like several serials; list one item per serial.`
      );
    }
    if (serial && raw.qty != null && raw.qty !== 1) {
      errors.push(`${line}: serialised part ${serial} must have qty 1.`);
    }
    if (serial && seenSerials.has(serial)) {
      errors.push(`${line}: serial ${serial} is listed twice.`);
    }
    if (serial) seenSerials.add(serial);

    const qty = serial ? 1 : (raw.qty ?? 1);
    if (!Number.isInteger(qty) || qty < 1) {
      errors.push(`${line}: quantity must be a whole number of at least 1.`);
    }

    items.push({
      part_number: part,
      serial_number: serial,
      description: raw.description?.trim() || null,
      qty
    });
  }

  if (errors.length > 0 || !site || !partner) return { ok: false, errors };
  return {
    ok: true,
    value: {
      rma_ref: input.rma_ref?.trim().toUpperCase() || null,
      site: site.code,
      partner: partner.name,
      partner_contact: contact,
      direction: input.direction,
      eta_window_start: start.toISOString(),
      eta_window_end: end.toISOString(),
      items
    }
  };
}
