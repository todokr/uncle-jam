// 「スナップショット」の部分: 実行状態全体をただのシリアライズ可能な
// オブジェクトとして扱い、ステップが進むたびにディスクへ書き出す。
// これによりクラッシュしても失うのは最大1ステップ分だけになる。

import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
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
  await mkdir(dirname(path), { recursive: true });
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
