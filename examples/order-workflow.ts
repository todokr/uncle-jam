// 3つのステップを繋いだもので、形はMastraの
// `.then(stepA).then(stepB).then(stepC)`と同じ。真ん中のステップは
// 誰かが外部から合図（「承認」）を与えるまでsuspendする。これは単純な
// 直列スクリプトでは表現できないが、状態機械+スナップショットなら書ける。

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

// 見た目だけの都合: 各ステップに目に見える時間をかけることで、カンバン
// ボードの「running」列が2回のポーリングの間に一瞬で消えないようにする。
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const orderWorkflow: Step<OrderContext, ApprovalResumeData>[] = [
  {
    id: "validate",
    async execute(context) {
      console.log(`[validate] checking order ${context.orderId}`);
      await sleep(1500);
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
      await sleep(1500);
      return { status: "continue", context: { ...context, shipped: true } };
    },
  },
];
