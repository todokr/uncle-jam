// 「ワーカーループ」の部分。意図的に薄く保ってあり、状態機械を1ステップずつ
// 前に進め、動くたびにスナップショットを取るだけ。
// （Mastraはこのループの実行主体をInngest/Temporalに委譲することで本当の
// 耐久実行にできるが、ここでは仕組みを見せるために1プロセスにしている。）

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

  if (snapshot.state !== fsm.state) {
    // （時間のかかるかもしれない）ステップを実行する前に"running"を
    // 即座に永続化しておく。こうすることでスナップショットを
    // ポーリングしている側が、開始時と終了時の状態しか見えないのではなく、
    // 実行中の状態も観測できるようになる。
    snapshot.state = fsm.state;
    await save(snapshotPath, snapshot);
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
    await save(snapshotPath, snapshot); // <- 耐久性のポイント: クラッシュしても失うのは全実行ではなく1ステップ分だけ
  }

  fsm.send("complete");
  snapshot.state = fsm.state;
  await save(snapshotPath, snapshot);
  return snapshot;
}

export { clear as clearSnapshot };
