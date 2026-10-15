import {
  AgentWorkflow,
  type AgentWorkflowEvent,
  type AgentWorkflowStep
} from "agents/workflows";
import type { ChatAgent } from "./server";

export type DeliveryParams = { shipmentId: number };

const MAX_FOLLOW_UPS = 3;

const secondsUntil = (isoTime: string) =>
  Math.max(0, Math.ceil((new Date(isoTime).getTime() - Date.now()) / 1000));

/**
 * One instance per shipment (spec section 5). It only decides *when* things
 * happen; every action is a call into the agent, which owns the database.
 * Step results are copied into plain values because workflows persist them.
 */
export class DeliveryWorkflow extends AgentWorkflow<ChatAgent, DeliveryParams> {
  async run(
    event: AgentWorkflowEvent<DeliveryParams>,
    step: AgentWorkflowStep
  ) {
    const { shipmentId } = event.payload;

    // step.sleepUntil rejects past times, and demo windows are often already
    // inside the code lead time, so measure first and sleep only if needed.
    const sleepUntil = async (name: string, isoTime: string) => {
      const seconds = await step.do(`${name}: time left`, async () =>
        secondsUntil(isoTime)
      );
      if (seconds > 0) await step.sleep(name, `${seconds} seconds`);
    };

    const plan = await step.do("load plan", async () => {
      const p = await this.agent.lifecyclePlan(shipmentId);
      return p ? { codeIssueAt: p.codeIssueAt, windowEnd: p.windowEnd } : null;
    });
    if (!plan) return;

    // 2. Code issue: sleep until the lead time before the window, then issue.
    await sleepUntil("wait until code issue time", plan.codeIssueAt);
    await step.do("issue entry code", async () => {
      const r = await this.agent.issueEntryCode(shipmentId);
      return { issued: r.issued };
    });

    // 3. Window open: wait for the "delivered" event until the window ends.
    //    The status checks cover a delivery recorded while we weren't waiting.
    const delivered = async () =>
      Boolean(await this.agent.isDelivered(shipmentId));
    let wasDelivered = await step.do("delivered already?", delivered);
    if (!wasDelivered) {
      const timeout = await step.do("time left in window", async () =>
        Math.max(1, secondsUntil(plan.windowEnd))
      );
      try {
        await step.waitForEvent("wait for delivery", {
          type: "delivered",
          timeout: `${timeout} seconds`
        });
        wasDelivered = true;
      } catch {
        wasDelivered = await step.do("delivered at window end?", delivered);
      }
    }

    // 4–5. No-show, or reconcile what arrived.
    let nextDue = wasDelivered
      ? await step.do(
          "reconcile",
          async () => (await this.agent.reconcileShipment(shipmentId)).nextDue
        )
      : await step.do(
          "no-show",
          async () => (await this.agent.handleNoShow(shipmentId)).nextDue
        );

    // 6. Follow up: re-check open exceptions after their SLA.
    for (let i = 1; nextDue && i <= MAX_FOLLOW_UPS; i++) {
      await sleepUntil(`wait for SLA ${i}`, nextDue);
      nextDue = await step.do(
        `overdue check ${i}`,
        async () => (await this.agent.followUpOverdue(shipmentId)).nextDue
      );
    }
  }
}
