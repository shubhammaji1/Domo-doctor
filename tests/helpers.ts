import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ScanConfig, ScanContext } from "../src/core/types.js";

export function makeConfig(
  root: string,
  overrides: Partial<ScanConfig> = {},
): ScanConfig {
  return {
    root,
    manifest: path.join(root, "manifest.json"),
    rules: {},
    ignore: [],
    reporter: "terminal",
    failOn: "error",
    suppressions: [],
    ruleTimeoutMs: 100,
    ...overrides,
  };
}

export function makeContext(
  root: string,
  overrides: Partial<ScanContext> = {},
): ScanContext {
  return {
    root,
    manifestPath: "manifest.json",
    files: [],
    sourceFiles: [],
    sourceFilesSkipped: [],
    config: makeConfig(root),
    ...overrides,
  };
}

export async function temporaryDirectory(): Promise<{
  root: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "domo-doctor-"));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}
