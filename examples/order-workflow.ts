// Three steps chained together, the same shape as Mastra's
// `.then(stepA).then(stepB).then(stepC)`. The middle step suspends until
// someone supplies an external signal (an "approval"), which is the case
// a plain linear script can't express but a state machine + snapshot can.

import type { Step } from "../src/engine.js";

export interface OrderContext {
  orderId: string;
  validated?: boolean;
  approved?: boolean;
  shipped?: boolean;
}

export interface ApprovalResumeData {
  approved: boolean;
}

export const orderWorkflow: Step<OrderContext, ApprovalResumeData>[] = [
  {
    id: "validate",
    async execute(context) {
      console.log(`[validate] checking order ${context.orderId}`);
      if (!context.orderId) {
        return { status: "fail", error: new Error("orderId is required") };
      }
      return { status: "continue", context: { ...context, validated: true } };
    },
  },
  {
    id: "waitForApproval",
    async execute(context, resumeData) {
      if (resumeData === undefined) {
        console.log("[waitForApproval] no decision yet -> suspending");
        return { status: "suspend" };
      }
      console.log(`[waitForApproval] resumed with approved=${resumeData.approved}`);
      if (!resumeData.approved) {
        return { status: "fail", error: new Error("order was rejected") };
      }
      return { status: "continue", context: { ...context, approved: true } };
    },
  },
  {
    id: "ship",
    async execute(context) {
      console.log(`[ship] shipping order ${context.orderId}`);
      return { status: "continue", context: { ...context, shipped: true } };
    },
  },
];
