// エンジンの上に載せたカンバンUI: 各ジョブは自分専用のスナップショット
// ファイルを持ち、このサーバーはそれらを小さなREST風APIとして公開する。
// ジョブの作成/再開は即座に(202を)返し、実際のrun()はバックグラウンドで
// 実行される — こうすることでボードは、同期呼び出しなら開始時と終了時の
// 状態しか返せないところを、pending -> running -> suspended/completed/failed
// と移り変わっていく様子として見せられる。

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { run, type RunOptions } from "./engine.js";
import { save, type Snapshot } from "./snapshot.js";
import { newJobId, jobPath, listJobs, removeJob } from "./jobStore.js";
import { orderWorkflow, type OrderContext, type ApprovalResumeData } from "../examples/order-workflow.js";

const INDEX_HTML_PATH = path.resolve(process.cwd(), "public/index.html");
const PORT = Number(process.env.PORT ?? 3000);

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as T) : ({} as T);
}

function runInBackground(id: string, options: RunOptions<OrderContext, ApprovalResumeData>): void {
  run<OrderContext, ApprovalResumeData>(orderWorkflow, jobPath(id), options).catch((err) => {
    console.error(`[job ${id}] failed:`, (err as Error).message);
  });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    const resumeMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/resume$/);
    const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);

    if (req.method === "GET" && url.pathname === "/") {
      const html = await readFile(INDEX_HTML_PATH, "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/jobs") {
      sendJson(res, 200, await listJobs<Partial<OrderContext>>());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/jobs") {
      const { orderId } = await readJsonBody<{ orderId?: string }>(req);
      const id = newJobId();
      const initial: Snapshot<Partial<OrderContext>> = {
        state: "pending",
        stepIndex: 0,
        context: { orderId: orderId?.trim() || "ORDER-1" },
        history: [],
      };
      await save(jobPath(id), initial); // run()が始まる前からGET /api/jobsに見えるようにしておく
      runInBackground(id, { context: initial.context as OrderContext });
      sendJson(res, 202, { id, ...initial });
      return;
    }

    if (req.method === "POST" && resumeMatch) {
      const id = resumeMatch[1]!;
      const { approved } = await readJsonBody<{ approved?: boolean }>(req);
      if (typeof approved !== "boolean") {
        sendJson(res, 400, { error: "approved must be a boolean" });
        return;
      }
      runInBackground(id, { resumeData: { approved } });
      sendJson(res, 202, { id });
      return;
    }

    if (req.method === "DELETE" && jobMatch) {
      await removeJob(jobMatch[1]!);
      res.writeHead(204);
      res.end();
      return;
    }

    sendJson(res, 404, { error: "not found" });
  } catch (err) {
    sendJson(res, 400, { error: (err as Error).message });
  }
});

server.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
