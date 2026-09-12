import { run, clearSnapshot } from "./src/engine.js";
import { orderWorkflow } from "./examples/order-workflow.js";

const SNAPSHOT_PATH = new URL("./snapshot.json", import.meta.url).pathname;

const [, , command, ...args] = process.argv;

function flag(name) {
  return args.includes(`--${name}`);
}

function value(name) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}

async function main() {
  if (command === "run") {
    const orderId = value("order-id") ?? "ORDER-1";
    const snapshot = await run(orderWorkflow, SNAPSHOT_PATH, {
      resumeData: undefined,
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
    const snapshot = await run(orderWorkflow, SNAPSHOT_PATH, {
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

  console.error("usage: node cli.js <run|resume|reset> [--order-id ID] [--approve|--reject]");
  process.exitCode = 1;
}

function printState(snapshot) {
  console.log("---");
  console.log(`state: ${snapshot.state}`);
  console.log(`history: ${snapshot.history.map((h) => `${h.step}:${h.status}`).join(" -> ")}`);
  if (snapshot.error) console.log(`error: ${snapshot.error}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
