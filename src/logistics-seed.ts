// Simulated air-freight jobs and their document sets (fictional companies,
// numbers and values). Some sets carry planted discrepancies so the rule
// checks and the AI review have something real to find; the rest are clean.

import {
  awbWithCheckDigit,
  TASK_TEMPLATES,
  type Doc,
  type Job,
  type Party
} from "./logistics.ts";

const HELIOS_NL: Party = {
  name: "Helios Edge Networks B.V.",
  address: "Spares Hub, Europalaan 40, Utrecht",
  country: "NL"
};
const HELIOS_DE: Party = {
  name: "Helios Edge Networks GmbH",
  address: "Spares Hub, Kelsterbacher Str. 12, Raunheim",
  country: "DE"
};
const HELIOS_US: Party = {
  name: "Helios Edge Networks Inc.",
  address: "Spares Hub, 21000 Atlantic Blvd, Sterling VA",
  country: "US"
};
const HELIOS_SG: Party = {
  name: "Helios Edge Networks Pte. Ltd.",
  address: "SIN-01, 20 Changi Business Park",
  country: "SG"
};
const NORTHWIND: Party = {
  name: "Northwind Silicon Co., Ltd.",
  address: "88 Neihu Rd, Taipei",
  country: "TW"
};

export type SeedJob = {
  job: Job;
  docs: Doc[];
  /** Number of tasks (in template order) already done */
  tasksDone: number;
};

export function logisticsScenario(now: Date): SeedJob[] {
  const day = (offset: number) =>
    new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const doneUpTo = (kind: Job["kind"], lane: number) =>
    TASK_TEMPLATES[kind].filter((t) => t.lane < lane).length;

  return [
    // 1. Export to Singapore: piece count, chargeable weight and lithium statement wrong on the AWB.
    {
      job: {
        ref: "EXP-2601",
        kind: "export",
        origin: "WH-UTR Utrecht (AMS)",
        destination: "SIN-01 Singapore (SIN)",
        originCountry: "NL",
        destinationCountry: "SG",
        forwarder: "Meridian Air Cargo",
        incoterm: "DAP",
        lane: 3,
        manifest: null,
        rmaShipmentId: null
      },
      tasksDone: doneUpTo("export", 3),
      docs: [
        {
          type: "COMMERCIAL_INVOICE",
          status: "final",
          version: 2,
          fields: {
            number: "HEN-CI-26-0418",
            date: day(-3),
            shipper: HELIOS_NL,
            consignee: HELIOS_SG,
            incoterm: "DAP",
            currency: "EUR",
            lines: [
              {
                sku: "SRV-GPU-2U",
                description: "AI inference server, 2U",
                hs: "847150",
                origin: "TW",
                qty: 2,
                unitPrice: 93410
              },
              {
                sku: "NIC-100G",
                description: "Dual-port 100GbE network card",
                hs: "851762",
                origin: "MY",
                qty: 4,
                unitPrice: 850
              }
            ],
            total: 190220,
            exportControl:
              "ECCN 5A992.c (mass-market encryption), NLR. EU dual-use: not listed.",
            signedBy: "M. de Vries, Spares Planning"
          }
        },
        {
          type: "PACKING_LIST",
          status: "final",
          version: 1,
          fields: {
            number: "HEN-PL-26-0418",
            date: day(-3),
            shipper: HELIOS_NL,
            consignee: HELIOS_SG,
            pieces: [
              {
                no: 1,
                l: 100,
                w: 70,
                h: 40,
                grossKg: 44,
                contents: "1 × SRV-GPU-2U in crate"
              },
              {
                no: 2,
                l: 100,
                w: 70,
                h: 40,
                grossKg: 44,
                contents: "1 × SRV-GPU-2U in crate"
              },
              {
                no: 3,
                l: 40,
                w: 30,
                h: 20,
                grossKg: 6,
                contents: "4 × NIC-100G"
              }
            ],
            totalPieces: 3,
            totalGrossKg: 94
          }
        },
        {
          type: "AIR_WAYBILL",
          status: "draft",
          version: 1,
          fields: {
            number: awbWithCheckDigit("961", "4402187"),
            date: day(-1),
            shipper: HELIOS_NL,
            consignee: HELIOS_SG,
            origin: "AMS",
            destination: "SIN",
            flight: "MA 718",
            pieces: 2,
            grossKg: 94,
            chargeableKg: 94,
            natureOfGoods: "Computer servers and network cards",
            handling: "Keep upright. Fragile."
          }
        },
        {
          type: "EXPORT_DECLARATION",
          status: "final",
          version: 1,
          fields: {
            mrn: "26NL7Q0000418XK2",
            date: day(-2),
            exporter: HELIOS_NL.name,
            destinationCountry: "SG",
            currency: "EUR",
            value: 190220,
            hsCodes: ["847150", "851762"]
          }
        }
      ]
    },

    // 2. Export to the US: no export-control statement; declared value ≠ invoice.
    {
      job: {
        ref: "EXP-2602",
        kind: "export",
        origin: "WH-FRA Frankfurt (FRA)",
        destination: "IAD-01 Ashburn (IAD)",
        originCountry: "DE",
        destinationCountry: "US",
        forwarder: "SkyBridge Air Cargo",
        incoterm: "FCA",
        lane: 2,
        manifest: null,
        rmaShipmentId: null
      },
      tasksDone: doneUpTo("export", 2) + 2,
      docs: [
        {
          type: "COMMERCIAL_INVOICE",
          status: "draft",
          version: 1,
          fields: {
            number: "HEN-CI-26-0422",
            date: day(-1),
            shipper: HELIOS_DE,
            consignee: HELIOS_US,
            incoterm: "FCA",
            currency: "EUR",
            lines: [
              {
                sku: "NIC-25G",
                description: "Dual-port 25GbE OCP network card",
                hs: "851762",
                origin: "MY",
                qty: 40,
                unitPrice: 280
              },
              {
                sku: "DIMM-32",
                description: "32 GB DDR5 RDIMM memory module",
                hs: "847330",
                origin: "KR",
                qty: 80,
                unitPrice: 140
              }
            ],
            total: 22400,
            signedBy: "J. Becker, Logistics"
          }
        },
        {
          type: "PACKING_LIST",
          status: "draft",
          version: 1,
          fields: {
            number: "HEN-PL-26-0422",
            date: day(-1),
            shipper: HELIOS_DE,
            consignee: HELIOS_US,
            pieces: [
              {
                no: 1,
                l: 60,
                w: 40,
                h: 40,
                grossKg: 18.5,
                contents: "40 × NIC-25G"
              },
              {
                no: 2,
                l: 40,
                w: 30,
                h: 25,
                grossKg: 7.5,
                contents: "80 × DIMM-32"
              }
            ],
            totalPieces: 2,
            totalGrossKg: 26
          }
        },
        {
          type: "EXPORT_DECLARATION",
          status: "draft",
          version: 1,
          fields: {
            mrn: "",
            date: day(0),
            exporter: HELIOS_DE.name,
            destinationCountry: "US",
            currency: "EUR",
            value: 23000,
            hsCodes: ["851762", "847330"]
          }
        }
      ]
    },

    // 3. Import of GPUs from Taipei: AWB check digit typo, COO origin and HS code mismatch.
    {
      job: {
        ref: "IMP-2601",
        kind: "import",
        origin: "Northwind Silicon, Taipei (TPE)",
        destination: "WH-UTR Utrecht (AMS)",
        originCountry: "TW",
        destinationCountry: "NL",
        forwarder: "SkyBridge Air Cargo",
        incoterm: "DAP",
        lane: 3,
        manifest: null,
        rmaShipmentId: null
      },
      tasksDone: doneUpTo("import", 3),
      docs: [
        {
          type: "COMMERCIAL_INVOICE",
          status: "final",
          version: 1,
          fields: {
            number: "NWS-INV-77104",
            date: day(-4),
            shipper: NORTHWIND,
            consignee: HELIOS_NL,
            incoterm: "DAP",
            currency: "USD",
            lines: [
              {
                sku: "GPU",
                description: "Inference accelerator card, PCIe",
                hs: "847330",
                origin: "CN",
                qty: 8,
                unitPrice: 19400
              }
            ],
            total: 155200,
            signedBy: "Chen Y., Export Sales"
          }
        },
        {
          type: "PACKING_LIST",
          status: "final",
          version: 1,
          fields: {
            number: "NWS-PL-77104",
            date: day(-4),
            shipper: NORTHWIND,
            consignee: HELIOS_NL,
            pieces: [
              { no: 1, l: 60, w: 50, h: 40, grossKg: 21, contents: "4 × GPU" },
              { no: 2, l: 60, w: 50, h: 40, grossKg: 21, contents: "4 × GPU" }
            ],
            totalPieces: 2,
            totalGrossKg: 42
          }
        },
        {
          type: "AIR_WAYBILL",
          status: "final",
          version: 1,
          // Check digit should be 6 (7300516 mod 7); keyed as 5.
          fields: {
            number: "950-73005165",
            date: day(-3),
            shipper: NORTHWIND,
            consignee: HELIOS_NL,
            origin: "TPE",
            destination: "AMS",
            flight: "SB 302",
            pieces: 2,
            grossKg: 42,
            chargeableKg: 42,
            natureOfGoods: "Computer parts (GPU cards)",
            handling: ""
          }
        },
        {
          type: "IMPORT_DECLARATION",
          status: "draft",
          version: 1,
          fields: {
            entryNo: "NL-IM-26-118804",
            date: day(0),
            importer: HELIOS_NL.name,
            originCountry: "CN",
            currency: "USD",
            value: 155200,
            hsCodes: ["854231"],
            duty: 0,
            vat: 32592
          }
        },
        {
          type: "CERTIFICATE_OF_ORIGIN",
          status: "final",
          version: 1,
          fields: {
            number: "TW-COO-26-55120",
            date: day(-5),
            originCountry: "TW",
            goods: "8 × inference accelerator cards"
          }
        }
      ]
    },

    // 4. Import: faulty PSUs returned from Ashburn for repair. Clean.
    {
      job: {
        ref: "IMP-2602",
        kind: "import",
        origin: "WH-IAD Ashburn (IAD)",
        destination: "WH-FRA Frankfurt (FRA)",
        originCountry: "US",
        destinationCountry: "DE",
        forwarder: "SkyBridge Air Cargo",
        incoterm: "DAP",
        lane: 4,
        manifest: null,
        rmaShipmentId: null
      },
      tasksDone: doneUpTo("import", 4),
      docs: [
        {
          type: "COMMERCIAL_INVOICE",
          status: "final",
          version: 1,
          fields: {
            number: "HEN-US-CI-26-0091",
            date: day(-6),
            shipper: HELIOS_US,
            consignee: HELIOS_DE,
            incoterm: "DAP",
            currency: "EUR",
            lines: [
              {
                sku: "PSU",
                description: "800 W hot-swap PSU, faulty, returned for repair",
                hs: "850440",
                origin: "CN",
                qty: 30,
                unitPrice: 60
              }
            ],
            total: 1800,
            signedBy: "R. Alvarez, Spares Hub"
          }
        },
        {
          type: "PACKING_LIST",
          status: "final",
          version: 1,
          fields: {
            number: "HEN-US-PL-26-0091",
            date: day(-6),
            shipper: HELIOS_US,
            consignee: HELIOS_DE,
            pieces: [
              { no: 1, l: 80, w: 60, h: 50, grossKg: 52, contents: "30 × PSU" }
            ],
            totalPieces: 1,
            totalGrossKg: 52
          }
        },
        {
          type: "AIR_WAYBILL",
          status: "final",
          version: 1,
          fields: {
            number: awbWithCheckDigit("950", "7300622"),
            date: day(-5),
            shipper: HELIOS_US,
            consignee: HELIOS_DE,
            origin: "IAD",
            destination: "FRA",
            flight: "SB 118",
            pieces: 1,
            grossKg: 52,
            chargeableKg: 52,
            natureOfGoods: "Power supply units for repair",
            handling: ""
          }
        },
        {
          type: "IMPORT_DECLARATION",
          status: "final",
          version: 1,
          fields: {
            entryNo: "DE-IM-26-440912",
            date: day(-2),
            importer: HELIOS_DE.name,
            originCountry: "CN",
            currency: "EUR",
            value: 1800,
            hsCodes: ["850440"],
            duty: 0,
            vat: 342
          }
        },
        {
          type: "CUSTOMS_RELEASE",
          status: "final",
          version: 1,
          fields: {
            number: "DE-REL-26-440912",
            date: day(-1),
            status: "Released"
          }
        }
      ]
    },

    // 5. Final mile Zaragoza → LIS-01: delivery note short against the manifest.
    {
      job: {
        ref: "FM-2601",
        kind: "final_mile",
        origin: "WH-ZAZ Zaragoza",
        destination: "LIS-01 Lisbon",
        originCountry: "ES",
        destinationCountry: "PT",
        forwarder: "FastFreight Couriers",
        incoterm: "",
        lane: 2,
        manifest: [
          { sku: "PSU", qty: 24 },
          { sku: "F-200", qty: 12 }
        ],
        rmaShipmentId: null
      },
      tasksDone: doneUpTo("final_mile", 2),
      docs: [
        {
          type: "DELIVERY_NOTE",
          status: "draft",
          version: 1,
          fields: {
            number: "DN-ZAZ-26-3310",
            date: day(0),
            from: "FastFreight Zaragoza DC",
            to: "LIS-01 Lisbon",
            lines: [
              { sku: "PSU", description: "800 W hot-swap PSU", qty: 20 },
              { sku: "F-200", description: "Hot-swap fan module", qty: 12 }
            ]
          }
        }
      ]
    },

    // 6. Final mile Utrecht → AMS-02: delivered with a signed POD. Clean.
    {
      job: {
        ref: "FM-2602",
        kind: "final_mile",
        origin: "WH-UTR Utrecht",
        destination: "AMS-02 Amsterdam",
        originCountry: "NL",
        destinationCountry: "NL",
        forwarder: "Nimbus Logistics",
        incoterm: "",
        lane: 4,
        manifest: [{ sku: "SSD-3840", qty: 10 }],
        rmaShipmentId: null
      },
      tasksDone: doneUpTo("final_mile", 4),
      docs: [
        {
          type: "DELIVERY_NOTE",
          status: "final",
          version: 1,
          fields: {
            number: "DN-UTR-26-2290",
            date: day(-1),
            from: "Utrecht Spares Hub",
            to: "AMS-02 Amsterdam",
            lines: [
              { sku: "SSD-3840", description: "3.84 TB NVMe U.2 SSD", qty: 10 }
            ]
          }
        },
        {
          type: "PROOF_OF_DELIVERY",
          status: "final",
          version: 1,
          fields: {
            date: day(0),
            signedBy: "K. Jansen, AMS-02 goods-in",
            remarks: "10 cartons received, no damage"
          }
        }
      ]
    }
  ];
}
