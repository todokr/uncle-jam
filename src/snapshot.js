// The "snapshot" piece: the entire run is a plain serializable object,
// written to disk after every step so a crash loses at most one step.

import { readFile, writeFile, rm } from "node:fs/promises";

export async function save(path, snapshot) {
  await writeFile(path, JSON.stringify(snapshot, null, 2));
}

export async function load(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

export async function clear(path) {
  await rm(path, { force: true });
}
