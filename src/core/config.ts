import { lstat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ScanConfig, Severity } from "./types.js";
import { assertSafePath, isInside, readProjectFile } from "./filesystem.js";
import { assertJsonNesting } from "./input-limits.js";

const severitySchema = z.enum(["error", "warning", "info"]);
const configSchema = z
  .object({
    root: z.string().optional(),
    manifest: z.string().optional(),
    rules: z
      .record(z.string(), z.union([severitySchema, z.literal("off")]))
      .optional(),
    ignore: z.array(z.string()).optional(),
    reporter: z.enum(["terminal", "json", "sarif"]).optional(),
    failOn: severitySchema.optional(),
    ruleTimeoutMs: z.number().int().positive().max(60_000).optional(),
    suppressions: z
      .array(
        z
          .object({
            ruleId: z.string().min(1),
            reason: z.string().min(1),
            file: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export const DEFAULT_IGNORES = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.git/**",
  "**/.next/**",
  "**/vendor/**",
  "**/.env",
  "**/.env.*",
  "**/*credentials*",
  "**/*secrets*",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
];

export interface LoadedConfig {
  config: ScanConfig;
  configPath?: string;
  baseDir: string;
}

export async function loadConfig(options: {
  cwd: string;
  rootArg?: string;
  configArg?: string;
}): Promise<LoadedConfig> {
  const cwd = path.resolve(options.cwd);
  const rootArgPath = options.rootArg
    ? path.resolve(cwd, options.rootArg)
    : cwd;
  const configPath = options.configArg
    ? path.resolve(cwd, options.configArg)
    : path.join(rootArgPath, "domo-doctor.config.json");
  await assertSafePath(rootArgPath, rootArgPath);
  let parsed: z.infer<typeof configSchema> = {};
  let foundConfig: string | undefined;
  try {
    await assertSafePath(
      options.configArg ? path.parse(configPath).root : rootArgPath,
      configPath,
    );
    const stats = await lstat(configPath);
    if (stats.isSymbolicLink() || !stats.isFile())
      throw new Error(
        "Configuration path must be a regular file, not a symbolic link.",
      );
    const text = await readProjectFile(
      options.configArg ? path.parse(configPath).root : rootArgPath,
      configPath,
    );
    let raw: unknown;
    assertJsonNesting(text);
    try {
      raw = JSON.parse(text) as unknown;
    } catch {
      throw new Error(
        "Invalid JSON in configuration. Check JSON syntax; input contents are omitted.",
      );
    }
    const result = configSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(
        "Invalid configuration. Check supported properties and value types.",
      );
    }
    parsed = result.data;
    foundConfig = configPath;
  } catch (error) {
    if (!options.configArg && isNotFound(error)) {
      // No config is an ordinary default.
    } else {
      throw error;
    }
  }
  const baseDir = foundConfig ? path.dirname(foundConfig) : cwd;
  const root =
    parsed.root === undefined
      ? rootArgPath
      : path.resolve(baseDir, parsed.root);
  if (!isInside(rootArgPath, root))
    throw new Error(
      "Configured root must remain inside the selected project root.",
    );
  await assertSafePath(rootArgPath, root);
  const manifest =
    parsed.manifest !== undefined
      ? path.resolve(root, parsed.manifest)
      : await discoverManifest(root);
  return {
    config: {
      root,
      manifest,
      rules: parsed.rules ?? {},
      ignore: [...DEFAULT_IGNORES, ...(parsed.ignore ?? [])],
      reporter: parsed.reporter ?? "terminal",
      failOn: parsed.failOn ?? "error",
      suppressions: (parsed.suppressions ?? []).map((item) => ({
        ruleId: item.ruleId,
        reason: item.reason,
        ...(item.file !== undefined ? { file: item.file } : {}),
      })),
      ruleTimeoutMs: parsed.ruleTimeoutMs ?? 5_000,
    },
    ...(foundConfig ? { configPath: foundConfig } : {}),
    baseDir,
  };
}

async function discoverManifest(root: string): Promise<string> {
  const primary = path.join(root, "manifest.json");
  if (await manifestExists(root, primary)) return primary;
  const candidates: string[] = [];
  for (const directory of ["public", "src", "static"]) {
    const candidate = path.join(root, directory, "manifest.json");
    if (await manifestExists(root, candidate)) candidates.push(candidate);
  }
  if (candidates.length > 1) {
    throw new Error(
      "Multiple source manifests were found in public, src, or static. Set manifest in domo-doctor.config.json to select the intended app.",
    );
  }
  return candidates[0] ?? primary;
}

async function manifestExists(
  root: string,
  candidate: string,
): Promise<boolean> {
  await assertSafePath(root, candidate);
  try {
    const stats = await lstat(candidate);
    if (!stats.isFile())
      throw new Error("Manifest path must be a regular file.");
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

export function severityRank(severity: Severity): number {
  return severity === "error" ? 3 : severity === "warning" ? 2 : 1;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
