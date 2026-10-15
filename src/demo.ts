import type { DeliveryInput } from "./deliveries.ts";
import type { ShipmentInput } from "./shipments.ts";

/**
 * Spec section 9, phase 6: three shipments that exercise the lifecycle in a
 * few minutes. Windows open in 1 minute and close after 3, so codes go out
 * straight away and the no-show fires at the 3-minute mark.
 */
export function demoScenario(
  now: Date
): { shipment: ShipmentInput; delivery: DeliveryInput | null }[] {
  const at = (minutes: number) =>
    new Date(now.getTime() + minutes * 60_000).toISOString();
  const window = { eta_window_start: at(1), eta_window_end: at(3) };

  return [
    {
      // Clean: everything arrives in good condition -> closed.
      shipment: {
        site: "AMS-02",
        partner: "BlueLine Express",
        direction: "inbound_replacement",
        rma_ref: "RMA-701",
        ...window,
        items: [
          {
            part_number: "SSD-3840",
            serial_number: "S-1001",
            description: "SSD"
          },
          {
            part_number: "SSD-3840",
            serial_number: "S-1002",
            description: "SSD"
          }
        ]
      },
      delivery: {
        site: "AMS-02",
        partner: "BlueLine Express",
        items: [{ serial_number: "S-1001" }, { serial_number: "S-1002" }]
      }
    },
    {
      // Damaged + missing: B202 damaged, B201 never arrives -> 2 exceptions.
      shipment: {
        site: "LIS-01",
        partner: "FastFreight Couriers",
        direction: "inbound_replacement",
        rma_ref: "RMA-702",
        ...window,
        items: [
          { part_number: "PSU", serial_number: "B201", description: "PSU" },
          { part_number: "PSU", serial_number: "B202", description: "PSU" },
          { part_number: "F-200", qty: 4, description: "fan" }
        ]
      },
      delivery: {
        site: "LIS-01",
        partner: "FastFreight Couriers",
        items: [
          { serial_number: "B202", condition: "damaged" },
          { part_number: "F-200", qty: 4 }
        ]
      }
    },
    {
      // No-show: nobody turns up -> MISSED_DELIVERY when the window closes.
      shipment: {
        site: "DUB-03",
        partner: "Nimbus Logistics",
        direction: "outbound_return",
        rma_ref: "RMA-703",
        ...window,
        items: [
          { part_number: "GPU", serial_number: "G-77812", description: "GPU" }
        ]
      },
      delivery: null
    }
  ];
}
