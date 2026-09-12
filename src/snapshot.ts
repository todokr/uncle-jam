// The "snapshot" piece: the entire run is a plain serializable object,
// written to disk after every step so a crash loses at most one step.

import { readFile, writeFile, rm } from "node:fs/promises";
import type { State } from "./fsm.js";

export interface HistoryEntry {
  step: string;
  status: string;
}

export interface Snapshot<TContext> {
  state: State;
  stepIndex: number;
  context: TContext;
  history: HistoryEntry[];
  waitingOn?: string;
  error?: string;
}

export async function save<TContext>(path: string, snapshot: Snapshot<TContext>): Promise<void> {
  await writeFile(path, JSON.stringify(snapshot, null, 2));
}

export async function load<TContext>(path: string): Promise<Snapshot<TContext> | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Snapshot<TContext>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function clear(path: string): Promise<void> {
  await rm(path, { force: true });
}
