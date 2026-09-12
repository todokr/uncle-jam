// 1ファイルだったスナップショットを複数に分割する: 1ジョブ = 1スナップ
// ショットファイルとしてSNAPSHOTS_DIR配下に置く。engine.tsは一切変更
// していない — 「ジョブ」とは単にスナップショットのパスでしかないので、
// カンバンボードもCLIも、それぞれ興味のあるパスに向けてrun()を呼ぶだけ。

import { randomUUID } from "node:crypto";
import { mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { load, type Snapshot } from "./snapshot.js";

export const SNAPSHOTS_DIR = path.resolve(process.cwd(), "snapshots");

export function newJobId(): string {
  // タイムスタンプを先頭に付けることで、ディレクトリ一覧が作成順に並ぶ。
  return `${Date.now()}-${randomUUID().slice(0, 8)}`;
}

export function jobPath(id: string): string {
  return path.join(SNAPSHOTS_DIR, `${id}.json`);
}

export async function listJobs<TContext>(): Promise<Array<{ id: string } & Snapshot<TContext>>> {
  await mkdir(SNAPSHOTS_DIR, { recursive: true });
  const files = await readdir(SNAPSHOTS_DIR);
  const jobs: Array<{ id: string } & Snapshot<TContext>> = [];

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const id = file.slice(0, -".json".length);
    const snapshot = await load<TContext>(path.join(SNAPSHOTS_DIR, file));
    if (snapshot) jobs.push({ id, ...snapshot });
  }

  jobs.sort((a, b) => a.id.localeCompare(b.id));
  return jobs;
}

export async function removeJob(id: string): Promise<void> {
  await unlink(jobPath(id)).catch((err) => {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  });
}
