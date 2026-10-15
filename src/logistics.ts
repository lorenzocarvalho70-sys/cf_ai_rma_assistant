// Air-freight logistics jobs: local final-mile deliveries, exports and imports,
// each with its own task checklist, status lanes and required document set.
// Document contents are SIMULATED (fictional companies, numbers and values).
// The rule checks below are deterministic; Llama 3.3 only adds an advisory
// review on top of them.

export type Kind = "final_mile" | "export" | "import";

export const KIND_LABEL: Record<Kind, string> = {
  final_mile: "Final mile",
  export: "Exports",
  import: "Imports"
};

export const LANES: Record<Kind, string[]> = {
  final_mile: [
    "Scheduled",
    "Picked & packed",
    "Out for delivery",
    "Delivered – close out"
  ],
  export: [
    "Booked",
    "Docs & export clearance",
    "Handed to forwarder",
    "Departed",
    "Arrived at destination",
    "Delivered – close out"
  ],
  import: [
    "Pre-alert received",
    "In flight",
    "Arrived – customs",
    "Cleared",
    "Out for delivery",
    "Delivered – close out"
  ]
};

// ── Documents ────────────────────────────────────────────────────────

export type DocType =
  | "COMMERCIAL_INVOICE"
  | "PACKING_LIST"
  | "AIR_WAYBILL"
  | "EXPORT_DECLARATION"
  | "IMPORT_DECLARATION"
  | "CUSTOMS_RELEASE"
  | "CERTIFICATE_OF_ORIGIN"
  | "DELIVERY_NOTE"
  | "PROOF_OF_DELIVERY";

export const DOC_LABEL: Record<DocType, string> = {
  COMMERCIAL_INVOICE: "Commercial invoice",
  PACKING_LIST: "Packing list",
  AIR_WAYBILL: "Air waybill (HAWB)",
  EXPORT_DECLARATION: "Export declaration",
  IMPORT_DECLARATION: "Import declaration",
  CUSTOMS_RELEASE: "Customs release",
  CERTIFICATE_OF_ORIGIN: "Certificate of origin",
  DELIVERY_NOTE: "Delivery note",
  PROOF_OF_DELIVERY: "Proof of delivery"
};

/** Which documents a job needs, and from which lane each must exist. */
export const DOC_REQUIREMENTS: Record<
  Kind,
  { type: DocType; fromLane: number; optional?: boolean }[]
> = {
  final_mile: [
    { type: "DELIVERY_NOTE", fromLane: 2 },
    { type: "PROOF_OF_DELIVERY", fromLane: 4 }
  ],
  export: [
    { type: "COMMERCIAL_INVOICE", fromLane: 2 },
    { type: "PACKING_LIST", fromLane: 2 },
    { type: "AIR_WAYBILL", fromLane: 3 },
    { type: "EXPORT_DECLARATION", fromLane: 3 },
    { type: "CERTIFICATE_OF_ORIGIN", fromLane: 3, optional: true }
  ],
  import: [
    { type: "COMMERCIAL_INVOICE", fromLane: 1 },
    { type: "PACKING_LIST", fromLane: 1 },
    { type: "AIR_WAYBILL", fromLane: 1 },
    { type: "IMPORT_DECLARATION", fromLane: 3 },
    { type: "CUSTOMS_RELEASE", fromLane: 4 },
    { type: "CERTIFICATE_OF_ORIGIN", fromLane: 3, optional: true }
  ]
};

// ── Tasks (the lane is the first lane with an open task) ─────────────────

export const TASK_TEMPLATES: Record<Kind, { lane: number; title: string }[]> = {
  final_mile: [
    { lane: 1, title: "Pick & pack against the manifest" },
    { lane: 1, title: "Issue delivery note" },
    { lane: 2, title: "Book courier and delivery window" },
    { lane: 2, title: "Site entry code issued to courier" },
    { lane: 3, title: "Courier out for delivery" },
    { lane: 3, title: "Delivered: proof of delivery received" },
    { lane: 4, title: "Reconcile receipt and close out" }
  ],
  export: [
    { lane: 1, title: "Book airfreight and confirm flight" },
    { lane: 2, title: "Classify goods (HS, export control / ECCN)" },
    { lane: 2, title: "Draft commercial invoice and packing list" },
    { lane: 2, title: "Approve drafts; issue finals" },
    { lane: 2, title: "Lodge export declaration (MRN)" },
    { lane: 3, title: "Lithium battery / DG check; hand over before cut-off" },
    { lane: 4, title: "Confirm departure (ATD) and send pre-alert" },
    { lane: 5, title: "Confirm arrival and import clearance at destination" },
    { lane: 6, title: "POD received: close out" }
  ],
  import: [
    { lane: 1, title: "Check pre-alert docs against PO" },
    { lane: 2, title: "Appoint customs broker; send docs" },
    { lane: 3, title: "Lodge import declaration" },
    { lane: 3, title: "Pay duties and import VAT" },
    { lane: 4, title: "Customs release received" },
    { lane: 5, title: "Book final-mile delivery to site" },
    { lane: 6, title: "Receipt confirmed: close out" }
  ]
};

export function laneFromTasks(
  kind: Kind,
  tasks: { lane: number; done: boolean }[]
) {
  const open = tasks.filter((t) => !t.done).map((t) => t.lane);
  return open.length ? Math.min(...open) : LANES[kind].length;
}

// ── Airfreight helpers ───────────────────────────────────────────────────

/** IATA air waybill: 3-digit prefix + 8-digit serial; last digit = first 7 digits mod 7. */
export function awbValid(awb: string) {
  const m = /^(\d{3})-?(\d{7})(\d)$/.exec(awb.replace(/\s/g, ""));
  return !!m && Number(m[2]) % 7 === Number(m[3]);
}

export function awbWithCheckDigit(prefix: string, serial7: string) {
  return `${prefix}-${serial7}${Number(serial7) % 7}`;
}

/** IATA volumetric weight: L×W×H in cm / 6000, per piece. */
export const volumetricKg = (l: number, w: number, h: number) =>
  (l * w * h) / 6000;

/** Chargeable weight: max(gross, volumetric), rounded up to the next 0.5 kg. */
export function chargeableKg(
  pieces: { l: number; w: number; h: number; grossKg: number }[]
) {
  const gross = pieces.reduce((a, p) => a + p.grossKg, 0);
  const vol = pieces.reduce((a, p) => a + volumetricKg(p.l, p.w, p.h), 0);
  return Math.ceil(Math.max(gross, vol) * 2) / 2;
}

const EU = new Set(["NL", "DE", "IE", "ES", "PT", "FR", "BE"]);
/** Items with encryption functionality need an export-control statement when leaving the EU. */
const ENCRYPTION_ITEMS = /^(SRV-|NIC-|NET-)/;
/** Servers ship with lithium coin cells installed (UN3481, Section II of PI 967). */
const BATTERY_ITEMS = /^SRV-/;
export const LITHIUM_STATEMENT =
  "Lithium ion batteries in compliance with Section II of PI967";

// ── Document field shapes ──────────────────────────────────────────────────

export type Party = { name: string; address: string; country: string };
export type InvoiceLine = {
  sku: string;
  description: string;
  hs: string;
  origin: string;
  qty: number;
  unitPrice: number;
};
export type Piece = {
  no: number;
  l: number;
  w: number;
  h: number;
  grossKg: number;
  contents: string;
};

export type DocFields = {
  COMMERCIAL_INVOICE: {
    number: string;
    date: string;
    shipper: Party;
    consignee: Party;
    incoterm: string;
    currency: string;
    lines: InvoiceLine[];
    total: number;
    exportControl?: string;
    signedBy?: string;
  };
  PACKING_LIST: {
    number: string;
    date: string;
    shipper: Party;
    consignee: Party;
    pieces: Piece[];
    totalPieces: number;
    totalGrossKg: number;
  };
  AIR_WAYBILL: {
    number: string;
    date: string;
    shipper: Party;
    consignee: Party;
    origin: string;
    destination: string;
    flight: string;
    pieces: number;
    grossKg: number;
    chargeableKg: number;
    natureOfGoods: string;
    handling: string;
  };
  EXPORT_DECLARATION: {
    mrn: string;
    date: string;
    exporter: string;
    destinationCountry: string;
    currency: string;
    value: number;
    hsCodes: string[];
  };
  IMPORT_DECLARATION: {
    entryNo: string;
    date: string;
    importer: string;
    originCountry: string;
    currency: string;
    value: number;
    hsCodes: string[];
    duty: number;
    vat: number;
  };
  CUSTOMS_RELEASE: { number: string; date: string; status: string };
  CERTIFICATE_OF_ORIGIN: {
    number: string;
    date: string;
    originCountry: string;
    goods: string;
  };
  DELIVERY_NOTE: {
    number: string;
    date: string;
    from: string;
    to: string;
    lines: { sku: string; description: string; qty: number }[];
  };
  PROOF_OF_DELIVERY: { date: string; signedBy: string; remarks: string };
};

export type Doc<T extends DocType = DocType> = {
  id?: number;
  type: T;
  status: "draft" | "final";
  version: number;
  fields: DocFields[T];
};

export type Job = {
  id?: number;
  ref: string;
  kind: Kind;
  origin: string;
  destination: string;
  originCountry: string;
  destinationCountry: string;
  forwarder: string;
  incoterm: string;
  lane: number;
  /** Final mile: what should be on the delivery note (from the RMA manifest) */
  manifest: { sku: string; qty: number }[] | null;
  rmaShipmentId: number | null;
};

// ── Rule checks (deterministic) ──────────────────────────────────────────

export type Finding = {
  rule: string;
  severity: "blocker" | "major" | "minor";
  message: string;
  docs: DocType[];
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const money = (n: number) => Math.round(n * 100) / 100;

function get<T extends DocType>(docs: Doc[], type: T): Doc<T> | undefined {
  return docs.find((d) => d.type === type) as Doc<T> | undefined;
}

export function checkDocuments(job: Job, docs: Doc[]): Finding[] {
  const f: Finding[] = [];
  const add = (
    rule: string,
    severity: Finding["severity"],
    message: string,
    ...types: DocType[]
  ) => f.push({ rule, severity, message, docs: types });

  // R1/R2: presence and finals for the current lane.
  for (const req of DOC_REQUIREMENTS[job.kind]) {
    const d = docs.find((x) => x.type === req.type);
    if (!d && !req.optional && job.lane >= req.fromLane) {
      add(
        "MISSING",
        "blocker",
        `${DOC_LABEL[req.type]} is required from "${LANES[job.kind][req.fromLane - 1]}" but is missing.`,
        req.type
      );
    }
    // A draft is fine while its own lane is in progress; once the job has
    // moved past that lane, it should have been finalised.
    if (d && d.status === "draft" && job.lane > req.fromLane) {
      add(
        "STILL_DRAFT",
        "major",
        `${DOC_LABEL[req.type]} is still a draft at "${LANES[job.kind][job.lane - 1]}".`,
        req.type
      );
    }
  }

  const ci = get(docs, "COMMERCIAL_INVOICE");
  const pl = get(docs, "PACKING_LIST");
  const awb = get(docs, "AIR_WAYBILL");
  const exp = get(docs, "EXPORT_DECLARATION");
  const imp = get(docs, "IMPORT_DECLARATION");
  const coo = get(docs, "CERTIFICATE_OF_ORIGIN");
  const dn = get(docs, "DELIVERY_NOTE");
  const pod = get(docs, "PROOF_OF_DELIVERY");

  if (ci) {
    const sum = money(
      ci.fields.lines.reduce((a, l) => a + l.qty * l.unitPrice, 0)
    );
    if (Math.abs(sum - ci.fields.total) > 0.01) {
      add(
        "CI_ARITHMETIC",
        "major",
        `Invoice lines add up to ${ci.fields.currency} ${sum.toLocaleString("en-GB")}, but the invoice total says ${ci.fields.total.toLocaleString("en-GB")}.`,
        "COMMERCIAL_INVOICE"
      );
    }
    for (const l of ci.fields.lines) {
      if (!/^\d{6,10}$/.test(l.hs))
        add(
          "HS_CODE",
          "major",
          `${l.sku}: HS code "${l.hs}" is not a 6–10 digit code.`,
          "COMMERCIAL_INVOICE"
        );
      if (!l.origin)
        add(
          "ORIGIN",
          "major",
          `${l.sku}: country of origin missing on the invoice.`,
          "COMMERCIAL_INVOICE"
        );
    }
    // Export control: encryption items leaving the EU need a classification statement.
    const leavesEu = job.kind === "export" && !EU.has(job.destinationCountry);
    if (
      leavesEu &&
      ci.fields.lines.some((l) => ENCRYPTION_ITEMS.test(l.sku)) &&
      !ci.fields.exportControl
    ) {
      add(
        "EXPORT_CONTROL",
        "blocker",
        "Servers / NICs with encryption are leaving the EU but the invoice has no export-control (ECCN / licence) statement.",
        "COMMERCIAL_INVOICE"
      );
    }
  }

  const decl = exp ?? imp;
  if (ci && decl) {
    const declType = exp ? "EXPORT_DECLARATION" : "IMPORT_DECLARATION";
    if (decl.fields.currency !== ci.fields.currency) {
      add(
        "DECL_CURRENCY",
        "major",
        `Declaration currency ${decl.fields.currency} differs from invoice currency ${ci.fields.currency}.`,
        "COMMERCIAL_INVOICE",
        declType
      );
    } else if (
      Math.abs(decl.fields.value - ci.fields.total) >
      ci.fields.total * 0.005
    ) {
      add(
        "DECL_VALUE",
        "major",
        `Declared value ${decl.fields.currency} ${decl.fields.value.toLocaleString("en-GB")} differs from the invoice total ${ci.fields.total.toLocaleString("en-GB")}.`,
        "COMMERCIAL_INVOICE",
        declType
      );
    }
    const ciHs = new Set(ci.fields.lines.map((l) => l.hs));
    const missing = [...ciHs].filter((h) => !decl.fields.hsCodes.includes(h));
    const extra = decl.fields.hsCodes.filter((h) => !ciHs.has(h));
    if (missing.length || extra.length) {
      add(
        "HS_MISMATCH",
        "major",
        `HS codes differ between invoice and declaration${missing.length ? `; not declared: ${missing.join(", ")}` : ""}${extra.length ? `; declared but not invoiced: ${extra.join(", ")}` : ""}.`,
        "COMMERCIAL_INVOICE",
        declType
      );
    }
  }

  if (pl && awb) {
    if (pl.fields.totalPieces !== awb.fields.pieces) {
      add(
        "PIECES",
        "major",
        `Packing list has ${pl.fields.totalPieces} pieces; the air waybill says ${awb.fields.pieces}.`,
        "PACKING_LIST",
        "AIR_WAYBILL"
      );
    }
    if (
      Math.abs(pl.fields.totalGrossKg - awb.fields.grossKg) >
      Math.max(0.5, pl.fields.totalGrossKg * 0.01)
    ) {
      add(
        "GROSS_WEIGHT",
        "major",
        `Gross weight: packing list ${pl.fields.totalGrossKg} kg vs air waybill ${awb.fields.grossKg} kg.`,
        "PACKING_LIST",
        "AIR_WAYBILL"
      );
    }
    const expected = chargeableKg(pl.fields.pieces);
    if (Math.abs(expected - awb.fields.chargeableKg) >= 0.5) {
      const vol =
        Math.round(
          pl.fields.pieces.reduce(
            (a, p) => a + volumetricKg(p.l, p.w, p.h),
            0
          ) * 10
        ) / 10;
      add(
        "CHARGEABLE_WEIGHT",
        "major",
        `Chargeable weight should be ${expected} kg (gross ${pl.fields.totalGrossKg} kg vs volumetric ${vol} kg at 6000 cm³/kg); the air waybill bills ${awb.fields.chargeableKg} kg.`,
        "PACKING_LIST",
        "AIR_WAYBILL"
      );
    }
    const plPieceKg =
      Math.round(pl.fields.pieces.reduce((a, p) => a + p.grossKg, 0) * 10) / 10;
    if (Math.abs(plPieceKg - pl.fields.totalGrossKg) > 0.1) {
      add(
        "PL_ARITHMETIC",
        "minor",
        `Packing list pieces add up to ${plPieceKg} kg, but its total says ${pl.fields.totalGrossKg} kg.`,
        "PACKING_LIST"
      );
    }
  }

  if (awb) {
    if (!awbValid(awb.fields.number)) {
      add(
        "AWB_CHECK_DIGIT",
        "blocker",
        `Air waybill number ${awb.fields.number} fails the IATA check digit (serial mod 7).`,
        "AIR_WAYBILL"
      );
    }
    if (
      ci?.fields.lines.some((l) => BATTERY_ITEMS.test(l.sku)) &&
      !awb.fields.handling.includes("PI967")
    ) {
      add(
        "LITHIUM",
        "major",
        `Servers ship with lithium cells installed, but the air waybill handling info lacks "${LITHIUM_STATEMENT}".`,
        "AIR_WAYBILL"
      );
    }
    if (ci && awb.fields.date < ci.fields.date) {
      add(
        "DATE_ORDER",
        "minor",
        `Air waybill (${awb.fields.date}) is dated before the commercial invoice (${ci.fields.date}).`,
        "AIR_WAYBILL",
        "COMMERCIAL_INVOICE"
      );
    }
  }

  // Same consignee on every document.
  const consignees = [ci, pl, awb].filter(Boolean).map((d) => ({
    type: d!.type,
    c: (d!.fields as { consignee: Party }).consignee
  }));
  const first = consignees[0];
  for (const x of consignees.slice(1)) {
    if (
      norm(x.c.name) !== norm(first.c.name) ||
      x.c.country !== first.c.country
    ) {
      add(
        "CONSIGNEE",
        "minor",
        `Consignee differs: ${DOC_LABEL[first.type]} "${first.c.name}, ${first.c.country}" vs ${DOC_LABEL[x.type]} "${x.c.name}, ${x.c.country}".`,
        first.type,
        x.type
      );
    }
  }

  if (coo && ci) {
    const origins = [...new Set(ci.fields.lines.map((l) => l.origin))];
    if (!origins.includes(coo.fields.originCountry)) {
      add(
        "COO_ORIGIN",
        "major",
        `Certificate of origin states ${coo.fields.originCountry}; invoice lines give ${origins.join(", ")}.`,
        "CERTIFICATE_OF_ORIGIN",
        "COMMERCIAL_INVOICE"
      );
    }
  }

  // Final mile: delivery note against the RMA manifest; POD once delivered.
  if (dn && job.manifest) {
    for (const m of job.manifest) {
      const got = dn.fields.lines
        .filter((l) => l.sku === m.sku)
        .reduce((a, l) => a + l.qty, 0);
      if (got !== m.qty)
        add(
          "DN_QTY",
          "major",
          `Delivery note lists ${got} × ${m.sku}; the manifest says ${m.qty}.`,
          "DELIVERY_NOTE"
        );
    }
    for (const l of dn.fields.lines) {
      if (!job.manifest.some((m) => m.sku === l.sku))
        add(
          "DN_EXTRA",
          "major",
          `Delivery note lists ${l.sku}, which is not on the manifest.`,
          "DELIVERY_NOTE"
        );
    }
  }
  if (pod && !pod.fields.signedBy.trim()) {
    add(
      "POD_UNSIGNED",
      "major",
      "Proof of delivery has no signatory.",
      "PROOF_OF_DELIVERY"
    );
  }

  const rank = { blocker: 0, major: 1, minor: 2 } as const;
  return f.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// ── Plain-text rendering (what the AI reviewer reads) ─────────────────────────

const party = (p: Party) => `${p.name}, ${p.address}, ${p.country}`;

export function renderDoc(d: Doc): string {
  const head = `${DOC_LABEL[d.type].toUpperCase()} (${d.status}, v${d.version})`;
  switch (d.type) {
    case "COMMERCIAL_INVOICE": {
      const x = (d as Doc<"COMMERCIAL_INVOICE">).fields;
      return [
        head,
        `No ${x.number} · date ${x.date} · Incoterm ${x.incoterm} · currency ${x.currency}`,
        `Shipper: ${party(x.shipper)}`,
        `Consignee: ${party(x.consignee)}`,
        ...x.lines.map(
          (l) =>
            `  ${l.qty} × ${l.sku} ${l.description} · HS ${l.hs} · origin ${l.origin} · ${l.unitPrice} each`
        ),
        `Total: ${x.currency} ${x.total}`,
        `Export control: ${x.exportControl ?? "(none)"}`,
        `Signed: ${x.signedBy ?? "(unsigned)"}`
      ].join("\n");
    }
    case "PACKING_LIST": {
      const x = (d as Doc<"PACKING_LIST">).fields;
      return [
        head,
        `No ${x.number} · date ${x.date}`,
        `Shipper: ${party(x.shipper)}`,
        `Consignee: ${party(x.consignee)}`,
        ...x.pieces.map(
          (p) =>
            `  Piece ${p.no}: ${p.l}×${p.w}×${p.h} cm, ${p.grossKg} kg, ${p.contents}`
        ),
        `Total: ${x.totalPieces} pieces, ${x.totalGrossKg} kg gross`
      ].join("\n");
    }
    case "AIR_WAYBILL": {
      const x = (d as Doc<"AIR_WAYBILL">).fields;
      return [
        head,
        `AWB ${x.number} · ${x.origin} → ${x.destination} · flight ${x.flight} · date ${x.date}`,
        `Shipper: ${party(x.shipper)}`,
        `Consignee: ${party(x.consignee)}`,
        `Pieces ${x.pieces} · gross ${x.grossKg} kg · chargeable ${x.chargeableKg} kg`,
        `Nature of goods: ${x.natureOfGoods}`,
        `Handling: ${x.handling || "(none)"}`
      ].join("\n");
    }
    default:
      return `${head}\n${JSON.stringify(d.fields, null, 1)}`;
  }
}

// ── Simulated forwarder amendments ─────────────────────────────────────────

/**
 * Applies the fix for each finding, the way an amended draft from the
 * forwarder or broker would. Changed documents come back as a new draft
 * version. Used only by the "simulate amended drafts" demo action.
 */
export function applyAmendments(
  job: Job,
  docs: Doc[],
  findings: Finding[]
): Doc[] {
  const out = docs.map((d) => ({
    ...d,
    fields: structuredClone(d.fields)
  })) as Doc[];
  const changed = new Set<DocType>();
  const find = <T extends DocType>(t: T) =>
    out.find((d) => d.type === t) as Doc<T> | undefined;
  const ci = find("COMMERCIAL_INVOICE");
  const pl = find("PACKING_LIST");
  const awb = find("AIR_WAYBILL");
  const decl = find("EXPORT_DECLARATION") ?? find("IMPORT_DECLARATION");
  const coo = find("CERTIFICATE_OF_ORIGIN");
  const dn = find("DELIVERY_NOTE");

  for (const f of findings) {
    switch (f.rule) {
      case "PIECES":
        if (awb && pl)
          ((awb.fields.pieces = pl.fields.totalPieces),
            changed.add("AIR_WAYBILL"));
        break;
      case "GROSS_WEIGHT":
        if (awb && pl)
          ((awb.fields.grossKg = pl.fields.totalGrossKg),
            changed.add("AIR_WAYBILL"));
        break;
      case "CHARGEABLE_WEIGHT":
        if (awb && pl)
          ((awb.fields.chargeableKg = chargeableKg(pl.fields.pieces)),
            changed.add("AIR_WAYBILL"));
        break;
      case "LITHIUM":
        if (awb) {
          awb.fields.handling = [awb.fields.handling, LITHIUM_STATEMENT]
            .filter(Boolean)
            .join(". ");
          changed.add("AIR_WAYBILL");
        }
        break;
      case "AWB_CHECK_DIGIT":
        if (awb) {
          const m = /^(\d{3})-?(\d{7})/.exec(awb.fields.number);
          if (m)
            ((awb.fields.number = awbWithCheckDigit(m[1], m[2])),
              changed.add("AIR_WAYBILL"));
        }
        break;
      case "CI_ARITHMETIC":
        if (ci) {
          ci.fields.total =
            Math.round(
              ci.fields.lines.reduce((a, l) => a + l.qty * l.unitPrice, 0) * 100
            ) / 100;
          changed.add("COMMERCIAL_INVOICE");
        }
        break;
      case "EXPORT_CONTROL":
        if (ci) {
          ci.fields.exportControl =
            "ECCN 5A992.c (mass-market encryption), NLR. EU dual-use: not listed.";
          changed.add("COMMERCIAL_INVOICE");
        }
        break;
      case "DECL_VALUE":
      case "DECL_CURRENCY":
        if (decl && ci) {
          decl.fields.value = ci.fields.total;
          decl.fields.currency = ci.fields.currency;
          changed.add(decl.type);
        }
        break;
      case "HS_MISMATCH":
        if (decl && ci)
          ((decl.fields.hsCodes = [
            ...new Set(ci.fields.lines.map((l) => l.hs))
          ]),
            changed.add(decl.type));
        break;
      case "COO_ORIGIN":
        // The chamber-issued certificate wins; the supplier corrects its invoice.
        if (ci && coo) {
          for (const l of ci.fields.lines) l.origin = coo.fields.originCountry;
          changed.add("COMMERCIAL_INVOICE");
          if (find("IMPORT_DECLARATION")) {
            find("IMPORT_DECLARATION")!.fields.originCountry =
              coo.fields.originCountry;
            changed.add("IMPORT_DECLARATION");
          }
        }
        break;
      case "CONSIGNEE":
        if (ci) {
          for (const d of [pl, awb])
            if (d)
              ((d.fields.consignee = { ...ci.fields.consignee }),
                changed.add(d.type));
        }
        break;
      case "DN_QTY":
      case "DN_EXTRA":
        if (dn && job.manifest) {
          dn.fields.lines = job.manifest.map((m) => ({
            sku: m.sku,
            description:
              dn.fields.lines.find((l) => l.sku === m.sku)?.description ??
              m.sku,
            qty: m.qty
          }));
          changed.add("DELIVERY_NOTE");
        }
        break;
    }
  }
  return out.map((d) =>
    changed.has(d.type) ? { ...d, status: "draft", version: d.version + 1 } : d
  );
}
