import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ScanConfig, Severity } from "./types.js";

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
  "node_modules/**",
  "dist/**",
  "build/**",
  "coverage/**",
  ".git/**",
  ".next/**",
  "vendor/**",
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
  let parsed: z.infer<typeof configSchema> = {};
  let foundConfig: string | undefined;
  try {
    const stats = await lstat(configPath);
    if (stats.isSymbolicLink() || !stats.isFile())
      throw new Error(
        "Configuration path must be a regular file, not a symbolic link.",
      );
    const text = await readFile(configPath, "utf8");
    let raw: unknown;
    try {
      raw = JSON.parse(text) as unknown;
    } catch (error) {
      throw new Error(
        `Invalid JSON in config ${path.relative(cwd, configPath)}: ${formatError(error)}`,
      );
    }
    const result = configSchema.safeParse(raw);
    if (!result.success) {
      const details = result.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ");
      throw new Error(
        `Invalid configuration in ${path.relative(cwd, configPath)}: ${details}`,
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
  const root = path.resolve(baseDir, parsed.root ?? options.rootArg ?? ".");
  const manifest = path.resolve(root, parsed.manifest ?? "manifest.json");
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
