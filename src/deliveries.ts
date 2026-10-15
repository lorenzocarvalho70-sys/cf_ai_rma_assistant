import { z } from "zod";
import { llm } from "./llm-schema.ts";
import { findPartner, findSite } from "./shipments.ts";
import type { ReceiptLine } from "./reconcile.ts";

export const deliveryInputSchema = z.object({
  shipment_id: llm
    .optNumber()
    .describe("Shipment number if the user gives one"),
  site: llm.optString().describe("Site the delivery arrived at, e.g. LIS-01"),
  partner: llm.optString().describe("Delivery partner, e.g. FastFreight"),
  items: llm
    .array(
      z.object({
        serial_number: llm
          .optString()
          .describe("Serial number received. One item per serial."),
        part_number: llm
          .optString()
          .describe(
            "Part number from the shipment manifest, e.g. F-200, for non-serialised parts"
          ),
        qty: llm
          .optNumber()
          .describe("Quantity received. 1 for serialised parts."),
        condition: llm
          .optEnum(["ok", "damaged"])
          .describe("ok unless the user says the part is damaged")
      })
    )
    .describe("Everything that was received"),
  received_by: llm.optString().describe("Who signed for it, if given")
});
export type DeliveryInput = z.infer<typeof deliveryInputSchema>;

export type OpenShipment = {
  id: number;
  site: string;
  partner: string;
  items: {
    part_number: string;
    serial_number: string | null;
    description: string | null;
  }[];
};

export type DeliveryResult =
  | { ok: true; shipmentId: number; receipts: ReceiptLine[] }
  | { ok: false; errors: string[] };

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const singular = (s: string) => (s.endsWith("s") ? s.slice(0, -1) : s);

/**
 * Maps a spoken part name ("fans") onto the manifest's part number (F-200)
 * using the part number or its description. Unknown names pass through and
 * reconciliation reports them as unexpected items.
 */
export function resolvePart(
  name: string,
  manifest: OpenShipment["items"]
): string {
  const key = singular(squash(name));
  const hit = manifest.find(
    (m) =>
      singular(squash(m.part_number)) === key ||
      (m.description != null && singular(squash(m.description)) === key)
  );
  return hit?.part_number ?? name.trim().toUpperCase();
}

/**
 * Finds the shipment a delivery belongs to and turns the LLM's extraction
 * into receipt lines, with part numbers taken from the manifest.
 */
export function resolveDelivery(
  input: DeliveryInput,
  open: OpenShipment[]
): DeliveryResult {
  const errors: string[] = [];
  let candidates = open;

  if (input.shipment_id != null) {
    candidates = open.filter((s) => s.id === input.shipment_id);
    if (candidates.length === 0) {
      return {
        ok: false,
        errors: [`Shipment ${input.shipment_id} is not awaiting delivery.`]
      };
    }
  } else {
    if (input.site) {
      const site = findSite(input.site);
      if (!site)
        return { ok: false, errors: [`Unknown site "${input.site}".`] };
      candidates = candidates.filter((s) => s.site === site.code);
    }
    if (input.partner) {
      const partner = findPartner(input.partner);
      if (!partner)
        return { ok: false, errors: [`Unknown partner "${input.partner}".`] };
      candidates = candidates.filter((s) => s.partner === partner.name);
    }
    if (candidates.length === 0) {
      return {
        ok: false,
        errors: ["No shipment awaiting delivery matches that site and partner."]
      };
    }
    if (candidates.length > 1) {
      return {
        ok: false,
        errors: [
          `Several shipments match: ${candidates.map((s) => `#${s.id} (${s.partner} to ${s.site})`).join(", ")}. Which shipment number?`
        ]
      };
    }
  }

  const shipment = candidates[0];
  const receipts: ReceiptLine[] = [];
  const seen = new Set<string>();
  if (!input.items?.length) errors.push("No received items were given.");

  for (const [i, raw] of (input.items ?? []).entries()) {
    const line = `Item ${i + 1}`;
    const condition = raw.condition ?? "ok";
    const serial = raw.serial_number?.trim().toUpperCase() || null;

    if (serial) {
      if (seen.has(serial))
        errors.push(`${line}: serial ${serial} is listed twice.`);
      seen.add(serial);
      const onManifest = shipment.items.find((m) => m.serial_number === serial);
      const part =
        onManifest?.part_number ??
        (raw.part_number
          ? resolvePart(raw.part_number, shipment.items)
          : "UNKNOWN");
      receipts.push({
        part_number: part,
        serial_number: serial,
        qty: 1,
        condition
      });
      continue;
    }

    if (!raw.part_number?.trim()) {
      errors.push(`${line}: give a serial number or a part number.`);
      continue;
    }
    const qty = raw.qty ?? 1;
    if (!Number.isInteger(qty) || qty < 1) {
      errors.push(`${line}: quantity must be a whole number of at least 1.`);
      continue;
    }
    receipts.push({
      part_number: resolvePart(raw.part_number, shipment.items),
      serial_number: null,
      qty,
      condition
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, shipmentId: shipment.id, receipts };
}
