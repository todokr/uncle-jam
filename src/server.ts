// Minimal UI on top of the engine: a static page + a tiny JSON API.
// No framework — just node:http — so the "UI" doesn't hide how thin the
// actual factory line (state machine + snapshot) really is.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { run, clearSnapshot } from "./engine.js";
import { load, type Snapshot } from "./snapshot.js";
import { orderWorkflow, type OrderContext, type ApprovalResumeData } from "../examples/order-workflow.js";

const SNAPSHOT_PATH = path.resolve(process.cwd(), "snapshot.json");
const INDEX_HTML_PATH = path.resolve(process.cwd(), "public/index.html");
const PORT = Number(process.env.PORT ?? 3000);

const EMPTY_STATE: Snapshot<Partial<OrderContext>> = {
  state: "pending",
  stepIndex: 0,
  context: {},
  history: [],
};

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as T) : ({} as T);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(payload);
}

async function currentState(): Promise<Snapshot<Partial<OrderContext>>> {
  return (await load<Partial<OrderContext>>(SNAPSHOT_PATH)) ?? EMPTY_STATE;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

    if (req.method === "GET" && url.pathname === "/") {
      const html = await readFile(INDEX_HTML_PATH, "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      sendJson(res, 200, await currentState());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/run") {
      const { orderId } = await readJsonBody<{ orderId?: string }>(req);
      const snapshot = await run<OrderContext, ApprovalResumeData>(orderWorkflow, SNAPSHOT_PATH, {
        context: { orderId: orderId?.trim() || "ORDER-1" },
      });
      sendJson(res, 200, snapshot);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/resume") {
      const { approved } = await readJsonBody<{ approved?: boolean }>(req);
      if (typeof approved !== "boolean") {
        sendJson(res, 400, { error: "approved must be a boolean" });
        return;
      }
      const snapshot = await run<OrderContext, ApprovalResumeData>(orderWorkflow, SNAPSHOT_PATH, {
        resumeData: { approved },
      });
      sendJson(res, 200, snapshot);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/reset") {
      await clearSnapshot(SNAPSHOT_PATH);
      sendJson(res, 200, EMPTY_STATE);
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
