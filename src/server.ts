import { createWorkersAI } from "workers-ai-provider";
import { callable, getAgentByName, routeAgentRequest } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  convertToModelMessages,
  generateText,
  pruneMessages,
  stepCountIs,
  streamText,
  tool
} from "ai";
import { z } from "zod";
import {
  claimPrompt,
  hypothesisPrompt,
  docReviewPrompt,
  MODEL,
  utc,
  withDedupedStream
} from "./ai";
import {
  awaitingDelivery,
  ensureSchema,
  getShipment,
  insertOutbox,
  insertShipment,
  listOutbox,
  listShipments,
  sendDraft,
  setWorkflowId,
  type Exec,
  type Row,
  type ShipmentWithItems,
  advanceKaizen,
  insertKaizen,
  listKaizen,
  updateKaizenRootCause,
  getSetting,
  setSetting,
  insertReplenishment,
  listReplenishments
} from "./db";
import {
  deliveryInputSchema,
  resolveDelivery,
  type OpenShipment
} from "./deliveries";
import { demoScenario } from "./demo";
import {
  changeException,
  checkEntryCode,
  exceptionsView,
  followUpOverdue,
  handleNoShow,
  issueEntryCode,
  lifecyclePlan,
  reconcileShipment,
  recordDelivery,
  revokeEntryCode,
  liveProcessRecords,
  type Ctx,
  type ExceptionView
} from "./lifecycle";
import { buildSystemPrompt } from "./prompt";
import { TOOL_SPECS } from "./tool-specs";
import { findPartner, PARTNERS, SITES, validateShipment } from "./shipments";
import {
  controlChart,
  describeSignal,
  kpis,
  missedHeatmap,
  network,
  pareto,
  seedKaizen,
  signalContext,
  signals,
  trackSignal,
  weekly
} from "./kaizen";
import { simulateHistory } from "./sim";
import {
  boms,
  buildable,
  CATALOG,
  DEFAULT_POLICY,
  stockPolicy,
  summarise,
  WAREHOUSES,
  type InventoryPolicy,
  type ReplenishmentOrder
} from "./inventory";
import {
  completeTask,
  insertJob,
  insertReview,
  jobIdForRma,
  LG_TABLES,
  listJobs,
  nextRef,
  setDocStatus,
  toggleTask,
  upsertDoc,
  type JobView
} from "./logistics-db";
import { applyAmendments, DOC_LABEL, renderDoc } from "./logistics";
import { logisticsScenario } from "./logistics-seed";

/** Forwarders that aren't delivery partners (fictional). */
const FORWARDER_CONTACTS: Record<string, string> = {
  "SkyBridge Air Cargo": "ops@skybridge-cargo.example"
};
const forwarderContact = (name: string) =>
  FORWARDER_CONTACTS[name] ??
  PARTNERS.find((p) => p.name === name)?.contact ??
  "ops@forwarder.example";

const POLICY_KEY = "inventory_policy";

/** Stock, lean policy targets and BOMs for the Control tower (illustrative data). */
function computeInventory(
  policy: InventoryPolicy,
  orders: ReplenishmentOrder[],
  now: Date
) {
  const lines = stockPolicy(policy, orders, now);
  return {
    policy,
    lines,
    warehouses: summarise(lines, policy),
    buildable: buildable(lines),
    boms: boms(),
    openOrders: orders.filter((o) => new Date(o.eta) > now).length
  };
}

export type InventoryState = ReturnType<typeof computeInventory>;

export { DeliveryWorkflow } from "./workflow";

const DEMO_DELIVERY_DELAY_SECONDS = 20;

/** What the UI panels show; pushed to every connected client on change. */
export type Analytics = ReturnType<typeof computeAnalytics>;

/** What the dashboard shows; pushed to every connected client on change. */
export type DashboardState = {
  shipments: ShipmentWithItems[];
  exceptions: ExceptionView[];
  outbox: Row[];
  hourSeconds: number;
  analytics: Analytics | null;
  inventory: InventoryState | null;
  logistics: JobView[];
};

export type KaizenEntry = {
  id: number;
  title: string;
  problem: string;
  root_cause: string | null;
  countermeasure: string | null;
  owner: string | null;
  stage: "plan" | "do" | "check" | "act";
  signal_key: string | null;
  simulated: number;
  opened_at: string;
  updated_at: string;
  track: ReturnType<typeof trackSignal>;
};

/**
 * Kaizen analytics over 12 simulated weeks plus finished live shipments.
 * Everything here is deterministic code; the LLM is only asked to explain.
 */
function computeAnalytics(lifecycle: Ctx, kaizenRows: Row[]) {
  const now = lifecycle.now();
  const records = [...simulateHistory(now), ...liveProcessRecords(lifecycle)];
  const weeks = weekly(records, now);
  return {
    records: records.length,
    liveRecords: records.filter((r) => !r.simulated).length,
    weeks,
    kpis: kpis(weeks),
    control: controlChart(weeks),
    pareto: pareto(records),
    signals: signals(records, now).map((sig) => ({
      ...sig,
      series: trackSignal(records, sig.key)?.series ?? [],
      kaizenId:
        Number(kaizenRows.find((k) => k.signal_key === sig.key)?.id ?? 0) ||
        null
    })),
    heatmap: missedHeatmap(records),
    network: network(records),
    kaizen: kaizenRows.map(
      (k): KaizenEntry => ({
        ...(k as unknown as Omit<KaizenEntry, "track">),
        track: k.signal_key ? trackSignal(records, String(k.signal_key)) : null
      })
    )
  };
}

export class ChatAgent extends AIChatAgent<Env, DashboardState> {
  maxPersistedMessages = 100;
  chatRecovery = true;
  // Wait for MCP connections to be re-established after hibernation before
  // processing a message, so MCP tools aren't intermittently missing.
  waitForMcpConnections = true;

  initialState: DashboardState = {
    shipments: [],
    exceptions: [],
    outbox: [],
    hourSeconds: 3600,
    analytics: null,
    inventory: null,
    logistics: []
  };

  private exec: Exec = (query, ...bindings) =>
    this.ctx.storage.sql.exec(query, ...bindings).toArray() as ReturnType<Exec>;

  private get lifecycle(): Ctx {
    if (!this.env.CODE_PEPPER) {
      throw new Error(
        "CODE_PEPPER secret is not set (npx wrangler secret put CODE_PEPPER)."
      );
    }
    return {
      exec: this.exec,
      now: () => new Date(),
      hourMs: Number(this.env.HOUR_SECONDS || 3600) * 1000,
      pepper: this.env.CODE_PEPPER,
      onCodeIssued:
        this.env.DEMO_LOG_CODES === "true"
          ? (id, code) =>
              console.log(`[demo] entry code for shipment #${id}: ${code}`)
          : undefined
    };
  }

  /** Writes inside one SQLite transaction, then pushes fresh panel data. */
  private write<T>(fn: () => T): T {
    const result = this.ctx.storage.transactionSync(fn);
    this.refresh();
    return result;
  }

  private refresh() {
    this.setState({
      shipments: listShipments(this.exec),
      exceptions: exceptionsView(this.lifecycle, { includeResolved: true }),
      outbox: listOutbox(this.exec),
      hourSeconds: Number(this.env.HOUR_SECONDS || 3600),
      analytics: computeAnalytics(this.lifecycle, listKaizen(this.exec)),
      inventory: computeInventory(
        this.policy(),
        this.replenishments(),
        new Date()
      ),
      logistics: listJobs(this.exec)
    });
  }

  private seedLogisticsIfEmpty() {
    if (listJobs(this.exec).length > 0) return;
    const now = new Date();
    for (const s of logisticsScenario(now)) {
      const id = insertJob(
        this.exec,
        { ...s.job, simulated: true },
        now,
        s.tasksDone
      );
      for (const d of s.docs) upsertDoc(this.exec, id, d, now);
    }
  }

  private seedKaizenIfEmpty() {
    if (listKaizen(this.exec).length > 0) return;
    const now = new Date();
    for (const k of seedKaizen(now)) {
      insertKaizen(this.exec, { ...k, simulated: true }, now);
    }
  }

  onStart() {
    ensureSchema(this.exec);
    this.seedKaizenIfEmpty();
    this.seedLogisticsIfEmpty();
    this.refresh();

    // Configure OAuth popup behavior for MCP servers that require authentication
    this.mcp.configureOAuthCallback({
      customHandler: (result) => {
        if (result.authSuccess) {
          return new Response("<script>window.close();</script>", {
            headers: { "content-type": "text/html" },
            status: 200
          });
        }
        return new Response(
          `Authentication Failed: ${result.authError || "Unknown error"}`,
          { headers: { "content-type": "text/plain" }, status: 400 }
        );
      }
    });
  }

  @callable()
  async addServer(name: string, url: string) {
    return await this.addMcpServer(name, url);
  }

  @callable()
  async removeServer(serverId: string) {
    await this.removeMcpServer(serverId);
  }

  // ---- Lifecycle steps, called by DeliveryWorkflow over RPC ----------------

  lifecyclePlan(shipmentId: number) {
    return lifecyclePlan(this.lifecycle, shipmentId);
  }

  async issueEntryCode(shipmentId: number) {
    const result = await issueEntryCode(this.lifecycle, shipmentId);
    if (result.issued) {
      this.finalMileEvent(shipmentId, [
        "Book courier and delivery window",
        "Site entry code issued to courier"
      ]);
    }
    this.refresh();
    return result;
  }

  isDelivered(shipmentId: number) {
    return getShipment(this.exec, shipmentId)?.status === "delivered";
  }

  reconcileShipment(shipmentId: number) {
    return this.write(() => reconcileShipment(this.lifecycle, shipmentId));
  }

  handleNoShow(shipmentId: number) {
    return this.write(() => handleNoShow(this.lifecycle, shipmentId));
  }

  followUpOverdue(shipmentId: number) {
    return this.write(() => followUpOverdue(this.lifecycle, shipmentId));
  }

  /** Called by the gate's check-code endpoint. */
  async checkEntryCode(shipmentId: number, code: string) {
    const result = await checkEntryCode(this.lifecycle, shipmentId, code);
    this.refresh();
    return result;
  }

  // ---- Actions shared by chat tools and the UI --------------------------------

  /** Opens the final-mile job (warehouse to site) that delivers an RMA shipment. */
  private openFinalMileJob(shipmentId: number) {
    const s = getShipment(this.exec, shipmentId);
    if (!s || jobIdForRma(this.exec, shipmentId)) return;
    const site = SITES.find((x) => x.code === s.site);
    const wh = WAREHOUSES.find((w) => w.sitesServed.includes(String(s.site)));
    const manifest = new Map<string, { qty: number; description: string }>();
    for (const i of s.items) {
      const key = String(i.part_number);
      const cur = manifest.get(key) ?? {
        qty: 0,
        description: String(i.description ?? i.part_number)
      };
      cur.qty += Number(i.qty);
      manifest.set(key, cur);
    }
    const now = new Date();
    const to = `${s.site} ${site?.name ?? ""}`.trim();
    this.write(() => {
      const jobId = insertJob(
        this.exec,
        {
          ref: nextRef(this.exec, "final_mile", now),
          kind: "final_mile",
          origin: wh ? `${wh.code} ${wh.city}` : "Partner hub",
          destination: to,
          originCountry: "",
          destinationCountry: "",
          forwarder: String(s.partner),
          incoterm: "",
          manifest: [...manifest].map(([sku, m]) => ({ sku, qty: m.qty })),
          rmaShipmentId: shipmentId,
          simulated: false
        },
        now,
        2 // picked, and the delivery note is issued with the booking
      );
      upsertDoc(
        this.exec,
        jobId,
        {
          type: "DELIVERY_NOTE",
          status: "final",
          version: 1,
          fields: {
            number: `DN-RMA-${shipmentId}`,
            date: now.toISOString().slice(0, 10),
            from: wh?.name ?? "Partner hub",
            to,
            lines: [...manifest].map(([sku, m]) => ({
              sku,
              description: m.description,
              qty: m.qty
            }))
          }
        },
        now
      );
    });
  }

  /** Ticks final-mile tasks when the RMA lifecycle reaches them. */
  private finalMileEvent(
    shipmentId: number,
    titles: string[],
    pod?: { signedBy: string }
  ) {
    const jobId = jobIdForRma(this.exec, shipmentId);
    if (!jobId) return;
    const now = new Date();
    this.ctx.storage.transactionSync(() => {
      for (const t of titles) completeTask(this.exec, jobId, t, now);
      if (pod) {
        upsertDoc(
          this.exec,
          jobId,
          {
            type: "PROOF_OF_DELIVERY",
            status: "final",
            version: 1,
            fields: {
              date: now.toISOString().slice(0, 10),
              signedBy: pod.signedBy,
              remarks: `Receipt recorded for RMA shipment #${shipmentId}`
            }
          },
          now
        );
      }
    });
  }

  private async startLifecycle(shipmentId: number) {
    this.openFinalMileJob(shipmentId);
    const workflowId = await this.runWorkflow(
      "DELIVERY_WORKFLOW",
      { shipmentId },
      { id: `shipment-${shipmentId}-${Date.now()}`, metadata: { shipmentId } }
    );
    this.write(() => setWorkflowId(this.exec, shipmentId, workflowId));
  }

  /** Records receipts, then hands over to the shipment's workflow to reconcile. */
  private async deliver(input: z.infer<typeof deliveryInputSchema>) {
    const result = this.write(() => recordDelivery(this.lifecycle, input));
    if (!result.ok) return result;
    this.finalMileEvent(
      result.shipmentId,
      [
        "Book courier and delivery window",
        "Site entry code issued to courier",
        "Courier out for delivery",
        "Delivered: proof of delivery received"
      ],
      { signedBy: input.received_by?.trim() || "Site goods-in" }
    );

    const workflowId = getShipment(this.exec, result.shipmentId)?.workflow_id;
    if (workflowId) {
      try {
        await this.sendWorkflowEvent("DELIVERY_WORKFLOW", String(workflowId), {
          type: "delivered",
          payload: { shipmentId: result.shipmentId }
        });
      } catch (e) {
        // The workflow re-checks the status before and after waiting, so a
        // missed event only delays reconciliation to the end of the window.
        console.warn(
          `delivered event for shipment #${result.shipmentId} not sent:`,
          e
        );
      }
    } else {
      this.reconcileShipment(result.shipmentId);
    }
    return result;
  }

  @callable()
  getDashboard(): DashboardState {
    this.refresh();
    return this.state;
  }

  /** Clears shipments and everything linked to them. Ids keep counting up, so
   *  workflows from cleared shipments find nothing to act on. */
  @callable()
  resetData() {
    this.write(() => {
      for (const table of [
        "outbox",
        "exceptions",
        "receipts",
        "access_codes",
        "shipment_items",
        "shipments",
        "kaizen_log",
        "replenishment_orders",
        ...LG_TABLES
      ]) {
        this.exec(`DELETE FROM ${table}`);
      }
      this.seedKaizenIfEmpty();
      this.seedLogisticsIfEmpty();
    });
    return { reset: true };
  }

  // ---- Logistics jobs & document warehouse ---------------------------------

  private job(jobId: number) {
    return listJobs(this.exec).find((j) => j.id === jobId);
  }

  @callable()
  toggleLogisticsTask(taskId: number) {
    this.write(() => toggleTask(this.exec, taskId, new Date()));
    return { ok: true };
  }

  @callable()
  setLogisticsDocStatus(docId: number, status: "draft" | "final") {
    if (status !== "draft" && status !== "final") return { ok: false };
    this.write(() => setDocStatus(this.exec, docId, status, new Date()));
    return { ok: true };
  }

  /**
   * Document review: the rule checks (code) decide the discrepancies; Llama 3.3
   * then reads the rendered documents plus those findings and adds an advisory
   * review with anything the rules can't see and a suggested amendment request.
   */
  @callable()
  async reviewDocuments(jobId: number) {
    const job = this.job(jobId);
    if (!job) return { ok: false, reason: "Job not found." };
    const workersai = createWorkersAI({ binding: this.env.AI });
    let aiText: string | null = null;
    try {
      const { text } = await generateText({
        model: workersai(MODEL),
        prompt: docReviewPrompt(
          `${job.ref} · ${job.kind.replace("_", " ")} · ${job.origin} to ${job.destination} · forwarder ${job.forwarder}${job.incoterm ? ` · ${job.incoterm}` : ""} · stage: ${job.laneLabel}`,
          job.docs.map((d) => renderDoc(d)),
          job.findings
        )
      });
      aiText = text.trim();
    } catch (e) {
      aiText = `AI review unavailable (${String(e).slice(0, 120)}). The rule-check results above still stand.`;
    }
    this.write(() =>
      insertReview(this.exec, jobId, job.findings, aiText, new Date())
    );
    return { ok: true, findings: job.findings.length };
  }

  /** Drafts an amendment request to the forwarder in the Outbox (not sent). */
  @callable()
  requestAmendments(jobId: number) {
    const job = this.job(jobId);
    if (!job) return { ok: false, reason: "Job not found." };
    const fixable = job.findings.filter(
      (f) => f.rule !== "STILL_DRAFT" && f.rule !== "MISSING"
    );
    const missing = job.findings.filter((f) => f.rule === "MISSING");
    if (fixable.length + missing.length === 0) {
      return { ok: false, reason: "Nothing to amend." };
    }
    const body = [
      `Hello ${job.forwarder},`,
      ``,
      `Please send amended documents for ${job.ref} (${job.origin} to ${job.destination}):`,
      ``,
      ...fixable.map(
        (f, i) =>
          `${i + 1}. ${f.docs.map((d) => DOC_LABEL[d]).join(" / ")}: ${f.message}`
      ),
      ...missing.map((f) => `- Outstanding: ${f.message}`),
      ``,
      `We will approve the finals once the corrected drafts are in.`,
      ``,
      `Logistics desk`
    ].join("\n");
    const id = this.write(() =>
      insertOutbox(
        this.exec,
        {
          shipment_id: null,
          to: forwarderContact(job.forwarder),
          subject: `Amendments needed: ${job.ref}`,
          body,
          status: "draft"
        },
        new Date()
      )
    );
    return { ok: true, draftId: id };
  }

  /** Demo: the forwarder's amended drafts arrive, fixing every rule finding. */
  @callable()
  simulateAmendedDocs(jobId: number) {
    const job = this.job(jobId);
    if (!job) return { ok: false, reason: "Job not found." };
    const amended = applyAmendments(job, job.docs, job.findings);
    const now = new Date();
    let changed = 0;
    this.write(() => {
      for (const d of amended) {
        const before = job.docs.find((x) => x.type === d.type);
        if (before && d.version !== before.version) {
          upsertDoc(this.exec, job.id, d, now);
          changed++;
        }
      }
    });
    return { ok: true, changed };
  }

  // ---- Inventory ------------------------------------------------------------

  private policy(): InventoryPolicy {
    return {
      ...DEFAULT_POLICY,
      ...getSetting<Partial<InventoryPolicy>>(this.exec, POLICY_KEY, {})
    };
  }

  private replenishments(): ReplenishmentOrder[] {
    return listReplenishments(this.exec).map((o) => ({
      warehouse: String(o.warehouse),
      sku: String(o.sku),
      qty: Number(o.qty),
      eta: String(o.eta)
    }));
  }

  /** Updates the lean policy (service levels, storage cost change, capital rate). */
  @callable()
  setInventoryPolicy(change: Partial<InventoryPolicy>) {
    const current = this.policy();
    const clamp = (x: unknown, lo: number, hi: number, fallback: number) =>
      typeof x === "number" && Number.isFinite(x)
        ? Math.min(hi, Math.max(lo, x))
        : fallback;
    const sl = change.serviceLevel ?? current.serviceLevel;
    const next: InventoryPolicy = {
      serviceLevel: {
        A: clamp(sl.A, 0.5, 0.999, current.serviceLevel.A),
        B: clamp(sl.B, 0.5, 0.999, current.serviceLevel.B),
        C: clamp(sl.C, 0.5, 0.999, current.serviceLevel.C)
      },
      storageCostChangePct: clamp(
        change.storageCostChangePct,
        -50,
        300,
        current.storageCostChangePct
      ),
      capitalRate: clamp(change.capitalRate, 0.01, 0.5, current.capitalRate),
      orderingCost: {
        owned: clamp(
          change.orderingCost?.owned,
          1,
          5000,
          current.orderingCost.owned
        ),
        partner: clamp(
          change.orderingCost?.partner,
          1,
          5000,
          current.orderingCost.partner
        )
      }
    };
    this.write(() => setSetting(this.exec, POLICY_KEY, next));
    return next;
  }

  /**
   * Places a replenishment order for the suggested quantity (or one EOQ) and
   * records it in the Outbox. It arrives after the supplier lead time, scaled
   * by the demo clock like every other lifecycle timing.
   */
  @callable()
  placeReplenishment(warehouse: string, sku: string) {
    const wh = WAREHOUSES.find((w) => w.code === warehouse);
    const item = CATALOG.find((c) => c.sku === sku);
    const line = this.state.inventory?.lines.find(
      (l) => l.warehouse === warehouse && l.sku === sku
    );
    if (!wh || !item || !line)
      return { ordered: false, reason: "Unknown warehouse or SKU." };
    const qty = line.suggestedQty || line.eoq;
    const now = new Date();
    const eta = new Date(
      now.getTime() + item.leadDays * 24 * this.lifecycle.hourMs
    );
    this.write(() => {
      insertReplenishment(
        this.exec,
        {
          warehouse,
          sku,
          qty,
          unit_cost: item.unitCost,
          supplier: item.supplier,
          eta: eta.toISOString()
        },
        now
      );
      insertOutbox(
        this.exec,
        {
          shipment_id: null,
          to: item.supplierContact,
          subject: `Replenishment order: ${qty}× ${sku} for ${wh.name}`,
          body: [
            `Hello ${item.supplier},`,
            ``,
            `Please supply ${qty} × ${sku} (${item.description}) to ${wh.name}, ${wh.city}.`,
            `Order value: €${(qty * item.unitCost).toLocaleString("en-GB")} (illustrative standard cost).`,
            `Requested within the agreed ${item.leadDays}-day lead time.`,
            ``,
            `Policy: EOQ ${line.eoq}, safety stock ${line.safetyStock}, reorder point ${line.reorderPoint}; position was ${line.onHand + line.onOrder}.`,
            ``,
            `Spares Planning`
          ].join("\n"),
          status: "sent"
        },
        now
      );
    });
    return { ordered: true, qty, eta: eta.toISOString() };
  }

  // ---- Kaizen ---------------------------------------------------------------

  private findSignal(key: string) {
    return this.state.analytics?.signals.find((s) => s.key === key);
  }

  /** Opens a PDCA entry (stage Plan) for a root-cause signal. */
  @callable()
  openKaizen(signalKey: string, hypothesis?: string) {
    const sig = this.findSignal(signalKey);
    if (!sig) return { opened: false, reason: "Signal not found." };
    if (sig.kaizenId) {
      return {
        opened: false,
        reason: "Already in the Kaizen log.",
        id: sig.kaizenId
      };
    }
    const now = new Date();
    const { title, problem } = describeSignal(sig);
    const id = this.write(() =>
      insertKaizen(
        this.exec,
        {
          title,
          problem,
          root_cause: hypothesis
            ? `Hypotheses (AI, unverified):\n${hypothesis}`
            : null,
          countermeasure: null,
          owner: null,
          stage: "plan",
          signal_key: signalKey,
          simulated: false,
          opened_at: now.toISOString()
        },
        now
      )
    );
    return { opened: true, id };
  }

  @callable()
  advanceKaizen(id: number) {
    const row = this.write(() => advanceKaizen(this.exec, id, new Date()));
    return row
      ? { stage: row.stage }
      : { stage: null, reason: "Already at Act, or not found." };
  }

  /**
   * Asks Llama 3.3 for root-cause hypotheses. The facts (rates, onset, how the
   * hits spread over parts, windows, weekdays…) come from code; the model only
   * proposes explanations and the checks that would confirm them.
   */
  @callable()
  async explainSignal(signalKey: string) {
    const sig = this.findSignal(signalKey);
    if (!sig) return { text: "Signal not found." };
    const records = [
      ...simulateHistory(new Date()),
      ...liveProcessRecords(this.lifecycle)
    ];
    const context = signalContext(records, signalKey);
    const workersai = createWorkersAI({ binding: this.env.AI });
    const { text } = await generateText({
      model: workersai(MODEL),
      prompt: hypothesisPrompt(describeSignal(sig).problem, sig.hits, context)
    });
    const kaizenId = sig.kaizenId;
    if (kaizenId) {
      this.write(() =>
        updateKaizenRootCause(
          this.exec,
          kaizenId,
          `Hypotheses (AI, unverified):\n${text.trim()}`,
          new Date()
        )
      );
    }
    return { text: text.trim() };
  }

  onWorkflowError(workflowName: string, workflowId: string, error: string) {
    console.error(`Workflow ${workflowName}/${workflowId} failed: ${error}`);
    return Promise.resolve();
  }

  @callable()
  sendDraft(outboxId: number) {
    const sent = this.write(() => sendDraft(this.exec, outboxId, new Date()));
    return sent ? { sent: true } : { sent: false, reason: "Not a draft." };
  }

  @callable()
  async seedDemo() {
    const ids: number[] = [];
    for (const { shipment, delivery } of demoScenario(new Date())) {
      const v = validateShipment(shipment, new Date());
      if (!v.ok) throw new Error(`Demo data invalid: ${v.errors.join(" ")}`);
      const id = this.write(() =>
        insertShipment(this.exec, v.value, new Date())
      );
      await this.startLifecycle(id);
      // Deliver a little later so the entry code goes out first, as in real life.
      if (delivery) {
        await this.schedule(DEMO_DELIVERY_DELAY_SECONDS, "deliverDemo", {
          ...delivery,
          shipment_id: id
        });
      }
      ids.push(id);
    }
    return { shipmentIds: ids };
  }

  async deliverDemo(delivery: z.infer<typeof deliveryInputSchema>) {
    const result = await this.deliver(delivery);
    if (!result.ok)
      console.warn(`demo delivery failed: ${result.errors.join(" ")}`);
  }

  // ---- Chat ------------------------------------------------------------------

  private awaitingForTools(): OpenShipment[] {
    return awaitingDelivery(this.exec).map((s) => ({
      id: Number(s.id),
      site: String(s.site),
      partner: String(s.partner),
      items: s.items as unknown as OpenShipment["items"]
    }));
  }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const mcpTools = this.mcp.getAITools();
    const workersai = createWorkersAI({
      binding: withDedupedStream(this.env.AI)
    });

    const result = streamText({
      model: workersai(MODEL, {
        sessionAffinity: this.sessionAffinity
      }),
      system: buildSystemPrompt(new Date(), awaitingDelivery(this.exec)),
      // Prune old tool calls and reasoning to save tokens on long conversations
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages",
        reasoning: "before-last-message"
      }),
      tools: {
        // MCP tools from connected servers
        ...mcpTools,

        logShipment: tool({
          ...TOOL_SPECS.logShipment,
          needsApproval: async (input) =>
            validateShipment(input, new Date()).ok,
          execute: async (input) => {
            const now = new Date();
            const result = validateShipment(input, now);
            if (!result.ok) return { logged: false, problems: result.errors };
            const s = result.value;
            const id = this.write(() => insertShipment(this.exec, s, now));
            await this.startLifecycle(id);
            return {
              logged: true,
              shipment_id: id,
              site: s.site,
              partner: s.partner,
              window: `${s.eta_window_start} to ${s.eta_window_end}`,
              items: s.items.length,
              next: "The entry code is issued automatically before the window opens."
            };
          }
        }),

        recordDelivery: tool({
          ...TOOL_SPECS.recordDelivery,
          needsApproval: async (input) =>
            resolveDelivery(input, this.awaitingForTools()).ok,
          execute: async (input) => {
            const result = await this.deliver(input);
            if (!result.ok) return { recorded: false, problems: result.errors };
            return {
              recorded: true,
              shipment_id: result.shipmentId,
              receipts: result.receipts,
              next: "Reconciliation runs automatically; any exceptions appear in the Exceptions panel. Do not compare the items yourself."
            };
          }
        }),

        listExceptions: tool({
          ...TOOL_SPECS.listExceptions,
          execute: async ({
            partner,
            shipment_id,
            include_resolved,
            since_days
          }) => {
            const p = partner ? findPartner(partner) : undefined;
            if (partner && !p)
              return { problems: [`Unknown partner "${partner}".`] };
            const rows = exceptionsView(this.lifecycle, {
              partner: p?.name,
              shipmentId: shipment_id ?? undefined,
              includeResolved: include_resolved ?? false,
              since: since_days
                ? new Date(Date.now() - since_days * 86_400_000).toISOString()
                : undefined
            });
            return {
              count: rows.length,
              exceptions: rows.map((e) => ({
                id: e.id,
                shipment: e.shipment_id,
                type: e.type,
                severity: e.severity,
                status: e.status,
                due: e.overdue
                  ? `OVERDUE (was due ${utc(e.due_by)})`
                  : utc(e.due_by),
                detail: e.detail,
                ...(e.resolution_note ? { resolution: e.resolution_note } : {})
              })),
              show_as:
                "Markdown table with columns: id, shipment, type, severity, status, due, detail"
            };
          }
        }),

        updateException: tool({
          ...TOOL_SPECS.updateException,
          execute: async ({ exception_id, status, note }) => {
            const r = this.write(() =>
              changeException(
                this.lifecycle,
                exception_id,
                status,
                note ?? null
              )
            );
            return r.ok
              ? {
                  updated: true,
                  exception_id,
                  status,
                  shipment_id: r.exception.shipment_id
                }
              : { updated: false, problems: [r.error] };
          }
        }),

        draftClaim: tool({
          ...TOOL_SPECS.draftClaim,
          execute: async ({ partner, shipment_id, exception_ids }) => {
            const p = partner ? findPartner(partner) : undefined;
            if (partner && !p)
              return {
                drafted: false,
                problems: [`Unknown partner "${partner}".`]
              };
            const rows = exceptionsView(this.lifecycle, {
              partner: p?.name,
              shipmentId: shipment_id ?? undefined,
              ids: exception_ids ?? undefined
            });
            if (rows.length === 0) {
              return {
                drafted: false,
                problems: ["No open exceptions match."]
              };
            }
            const partners = [...new Set(rows.map((r) => String(r.partner)))];
            if (partners.length > 1) {
              return {
                drafted: false,
                problems: [
                  `Exceptions span several partners (${partners.join(", ")}). Which partner?`
                ]
              };
            }
            const first = rows[0];
            const shipmentIds = [
              ...new Set(rows.map((r) => Number(r.shipment_id)))
            ];
            const { text } = await generateText({
              model: workersai(MODEL),
              prompt: claimPrompt({
                partner: partners[0],
                site: String(first.site),
                shipments: shipmentIds
                  .map((id) => {
                    const r = rows.find((x) => Number(x.shipment_id) === id)!;
                    return `#${id}${r.rma_ref ? ` (${r.rma_ref})` : ""}`;
                  })
                  .join(", "),
                exceptions: rows.map((r) => ({
                  id: Number(r.id),
                  type: String(r.type),
                  detail: String(r.detail),
                  due_by: String(r.due_by)
                }))
              })
            });
            const subject = `Claim: ${rows.length} exception${rows.length > 1 ? "s" : ""} on shipment ${shipmentIds.map((i) => `#${i}`).join(", ")}`;
            const draftId = this.write(() =>
              insertOutbox(
                this.exec,
                {
                  shipment_id: shipmentIds.length === 1 ? shipmentIds[0] : null,
                  to: String(first.partner_contact),
                  subject,
                  body: text.trim(),
                  status: "draft"
                },
                new Date()
              )
            );
            return {
              drafted: true,
              draft_id: draftId,
              to: first.partner_contact,
              subject,
              body: text.trim(),
              next: "Saved as a draft in the Outbox. It is not sent until the operator presses Send there."
            };
          }
        }),

        revokeCode: tool({
          ...TOOL_SPECS.revokeCode,
          execute: async ({ shipment_id }) =>
            this.write(() => revokeEntryCode(this.lifecycle, shipment_id))
        })
      },
      stopWhen: stepCountIs(5),
      abortSignal: options?.abortSignal
    });

    return result.toUIMessageStreamResponse();
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    // Gate check-in (spec section 6). In production the site's access-control
    // system would call this; it needs authentication and rate limiting there.
    if (url.pathname === "/api/check-code") {
      if (request.method !== "POST")
        return new Response("Method not allowed", { status: 405 });
      const body = (await request.json().catch(() => null)) as {
        shipment_id?: unknown;
        code?: unknown;
      } | null;
      const shipmentId = Number(body?.shipment_id);
      const code = typeof body?.code === "string" ? body.code : "";
      if (!Number.isInteger(shipmentId) || !/^\d{6,8}$/.test(code.trim())) {
        return Response.json(
          {
            valid: false,
            reason: 'Send JSON { shipment_id: number, code: "8 digits" }.'
          },
          { status: 400 }
        );
      }
      const agent = await getAgentByName(env.ChatAgent, "default");
      const result = await agent.checkEntryCode(shipmentId, code);
      return Response.json({
        valid: result.valid,
        reason: result.valid ? "OK" : result.reason
      });
    }

    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
