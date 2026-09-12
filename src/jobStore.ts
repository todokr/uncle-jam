// Turns the single-file snapshot into many: one job = one snapshot file
// under SNAPSHOTS_DIR. engine.ts doesn't change at all — a "job" is just
// a snapshot path, so the kanban board and the CLI both point run() at
// whichever path they care about.

import { randomUUID } from "node:crypto";
import { mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { load, type Snapshot } from "./snapshot.js";

export const SNAPSHOTS_DIR = path.resolve(process.cwd(), "snapshots");

export function newJobId(): string {
  // Timestamp prefix keeps directory listings sorted by creation order.
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
