// The "worker loop" piece, kept intentionally thin: it just drives the
// state machine forward one step at a time and snapshots after each move.
// (Mastra can hand this loop off to Inngest/Temporal for real durability;
// here it's a single process so the mechanism stays visible.)

import { StateMachine } from "./fsm.js";
import { save, load, clear, type Snapshot } from "./snapshot.js";

export type StepResult<TContext> =
  | { status: "continue"; context: TContext }
  | { status: "suspend" }
  | { status: "fail"; error: Error };

export interface Step<TContext, TResumeData = unknown> {
  id: string;
  execute(context: TContext, resumeData?: TResumeData): Promise<StepResult<TContext>>;
}

export interface RunOptions<TContext, TResumeData> {
  resumeData?: TResumeData;
  context?: TContext;
}

export async function run<TContext, TResumeData = unknown>(
  workflow: Step<TContext, TResumeData>[],
  snapshotPath: string,
  { resumeData, context: initialContext }: RunOptions<TContext, TResumeData> = {},
): Promise<Snapshot<TContext>> {
  let snapshot = await load<TContext>(snapshotPath);

  if (!snapshot) {
    snapshot = {
      state: "pending",
      stepIndex: 0,
      context: (initialContext ?? {}) as TContext,
      history: [],
    };
  } else if (snapshot.state === "completed" || snapshot.state === "failed") {
    throw new Error(`workflow already ${snapshot.state}; clear the snapshot to run again`);
  }

  const fsm = new StateMachine(snapshot.state);

  if (fsm.state === "pending") {
    fsm.send("start");
  } else if (fsm.state === "suspended") {
    if (resumeData === undefined) {
      throw new Error("workflow is suspended; resume() needs resumeData");
    }
    fsm.send("resume");
  }

  let pendingResumeData = resumeData;

  while (fsm.state === "running" && snapshot.stepIndex < workflow.length) {
    const step = workflow[snapshot.stepIndex]!;
    const result = await step.execute(snapshot.context, pendingResumeData);
    pendingResumeData = undefined;

    snapshot.history.push({ step: step.id, status: result.status });

    if (result.status === "suspend") {
      fsm.send("suspend");
      snapshot.state = fsm.state;
      snapshot.waitingOn = step.id;
      await save(snapshotPath, snapshot);
      return snapshot;
    }

    if (result.status === "fail") {
      fsm.send("fail");
      snapshot.state = fsm.state;
      snapshot.error = result.error.message;
      await save(snapshotPath, snapshot);
      return snapshot;
    }

    snapshot.context = result.context;
    snapshot.stepIndex += 1;
    delete snapshot.waitingOn;
    fsm.send("step");
    snapshot.state = fsm.state;
    await save(snapshotPath, snapshot); // <- durability point: one crash costs one step, not the whole run
  }

  fsm.send("complete");
  snapshot.state = fsm.state;
  await save(snapshotPath, snapshot);
  return snapshot;
}

export { clear as clearSnapshot };
