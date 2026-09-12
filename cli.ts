import { run, clearSnapshot } from "./src/engine.js";
import { orderWorkflow, type OrderContext, type ApprovalResumeData } from "./examples/order-workflow.js";
import type { Snapshot } from "./src/snapshot.js";
import { jobPath } from "./src/jobStore.js";

const SNAPSHOT_PATH = jobPath("default");

const [, , command, ...args] = process.argv;

function flag(name: string): boolean {
  return args.includes(`--${name}`);
}

function value(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}

async function main(): Promise<void> {
  if (command === "run") {
    const orderId = value("order-id") ?? "ORDER-1";
    const snapshot = await run<OrderContext, ApprovalResumeData>(orderWorkflow, SNAPSHOT_PATH, {
      context: { orderId },
    });
    printState(snapshot);
    return;
  }

  if (command === "resume") {
    const approved = flag("approve") ? true : flag("reject") ? false : undefined;
    if (approved === undefined) {
      throw new Error("resume needs --approve or --reject");
    }
    const snapshot = await run<OrderContext, ApprovalResumeData>(orderWorkflow, SNAPSHOT_PATH, {
      resumeData: { approved },
    });
    printState(snapshot);
    return;
  }

  if (command === "reset") {
    await clearSnapshot(SNAPSHOT_PATH);
    console.log("snapshot cleared");
    return;
  }

  console.error("usage: node dist/cli.js <run|resume|reset> [--order-id ID] [--approve|--reject]");
  process.exitCode = 1;
}

function printState(snapshot: Snapshot<OrderContext>): void {
  console.log("---");
  console.log(`state: ${snapshot.state}`);
  console.log(`history: ${snapshot.history.map((h) => `${h.step}:${h.status}`).join(" -> ")}`);
  if (snapshot.error) console.log(`error: ${snapshot.error}`);
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exitCode = 1;
});
