import { accessSync, constants, statSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import ts from "typescript";
import { loadConfig } from "./config.js";
import { runRules } from "./rule-engine.js";
import type {
  Diagnostic,
  RuleDefinition,
  ScanConfig,
  ScanContext,
  ScanReport,
  ScanSummary,
} from "./types.js";
import {
  checkManifestStructure,
  checkMappings,
  diagnostic,
  DOMO_MANIFEST_DOCS,
  parseManifest,
} from "../analyzers/manifest.js";
import {
  analyzeAppDb,
  analyzeDatasetReferences,
  isSourceFile,
  sourceReferencesAdvancedProxy,
} from "../analyzers/source-code.js";
import { VERSION } from "../version.js";

const MAX_SOURCE_FILE_BYTES = 1_048_576;

export interface ScanOptions {
  root?: string;
  cwd?: string;
  configPath?: string;
  onlyCategories?: readonly RuleDefinition["category"][];
}

export async function scanProject(
  options: ScanOptions = {},
): Promise<ScanReport> {
  const startedAt = new Date();
  const started = performance.now();
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const loaded = await loadConfig({
    cwd,
    ...(options.root ? { rootArg: options.root } : {}),
    ...(options.configPath ? { configArg: options.configPath } : {}),
  });
  const config = loaded.config;
  assertSafeScanConfig(config);
  const rootStats = await lstat(config.root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink())
    throw new Error("The scan root must be a real directory.");
  const manifestStats = await lstatIfExists(config.manifest);
  if (manifestStats?.isSymbolicLink())
    throw new Error("The manifest path must not be a symbolic link.");
  if (manifestStats && !manifestStats.isFile())
    throw new Error("The manifest path must be a regular file.");
  const manifestText = manifestStats
    ? await readFile(config.manifest, "utf8")
    : undefined;

  const files = await fg("**/*", {
    cwd: config.root,
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: false,
    unique: true,
    ignore: config.ignore,
  });
  files.sort((left, right) => left.localeCompare(right));
  const sourcePaths = files.filter(isSourceFile);
  const sourceFiles: ScanContext["sourceFiles"][number][] = [];
  const sourceFilesSkipped: string[] = [];
  for (const sourcePath of sourcePaths) {
    const absolute = path.join(config.root, sourcePath);
    const stats = await lstat(absolute);
    if (stats.isSymbolicLink() || !stats.isFile()) continue;
    if (stats.size > MAX_SOURCE_FILE_BYTES) {
      sourceFilesSkipped.push(toPosix(sourcePath));
      continue;
    }
    const text = await readFile(absolute, "utf8");
    const extension = path.extname(sourcePath).toLowerCase();
    const scriptKind =
      extension === ".tsx"
        ? ts.ScriptKind.TSX
        : extension === ".jsx"
          ? ts.ScriptKind.JSX
          : extension === ".js" || extension === ".mjs" || extension === ".cjs"
            ? ts.ScriptKind.JS
            : ts.ScriptKind.TS;
    sourceFiles.push({
      path: toPosix(sourcePath),
      sourceFile: ts.createSourceFile(
        sourcePath,
        text,
        ts.ScriptTarget.Latest,
        true,
        scriptKind,
      ),
    });
  }
  const manifestResult = parseManifest({
    manifestPath: relativeToRoot(config, config.manifest),
    ...(manifestText !== undefined ? { manifestText } : {}),
  });
  const manifest = manifestResult.manifest;
  const context: ScanContext = {
    root: config.root,
    manifestPath: relativeToRoot(config, config.manifest),
    ...(manifestText !== undefined ? { manifestText } : {}),
    ...(manifest ? { manifest } : {}),
    files: files.map(toPosix),
    sourceFiles,
    sourceFilesSkipped,
    config,
  };
  const rules = createRules(
    manifestResult.diagnostic,
    manifestResult.invalidRoot,
  );
  const knownRuleIds = new Set(rules.map((rule) => rule.id));
  const unknownRuleIds = Object.keys(config.rules).filter(
    (ruleId) => !knownRuleIds.has(ruleId),
  );
  const unknownSuppressionIds = config.suppressions
    .map((item) => item.ruleId)
    .filter((ruleId) => !knownRuleIds.has(ruleId));
  if (unknownRuleIds.length || unknownSuppressionIds.length) {
    throw new Error(
      `Unknown diagnostic rule ID${unknownRuleIds.length + unknownSuppressionIds.length === 1 ? "" : "s"}: ${[...new Set([...unknownRuleIds, ...unknownSuppressionIds])].join(", ")}`,
    );
  }
  const result = await runRules(
    rules,
    context,
    options.onlyCategories ? { onlyCategories: options.onlyCategories } : {},
  );
  const elapsed = Math.round(performance.now() - started);
  return {
    schemaVersion: "1.0.0",
    tool: { name: "domo-doctor", version: VERSION },
    scan: {
      status: "completed",
      project: ".",
      startedAt: startedAt.toISOString(),
      durationMs: elapsed,
    },
    summary: summarize(result.diagnostics),
    rules: result.executions,
    diagnostics: result.diagnostics.map((item) => sanitizeDiagnostic(item)),
  };
}

function createRules(
  manifestParseDiagnostic?: Diagnostic,
  invalidManifestRoot = false,
): RuleDefinition[] {
  return [
    {
      id: "DD-MAN-001",
      description: "Manifest file exists.",
      category: "manifest",
      documentationUrl: DOMO_MANIFEST_DOCS,
      run: (context) =>
        context.manifestText === undefined
          ? [
              diagnostic({
                ruleId: "DD-MAN-001",
                severity: "error",
                status: "failed",
                message: "Manifest file not found.",
                file: context.manifestPath,
                explanation:
                  "Domo documents manifest.json as the metadata file in the base directory of a custom app design.",
                suggestion:
                  "Add a manifest.json file in the project root, or set the manifest path in domo-doctor.config.json.",
                docs: DOMO_MANIFEST_DOCS,
              }),
            ]
          : [],
    },
    {
      id: "DD-MAN-002",
      description: "Manifest is valid JSON.",
      category: "manifest",
      documentationUrl: DOMO_MANIFEST_DOCS,
      run: (context) =>
        context.manifestText === undefined
          ? [
              skipped(
                "DD-MAN-002",
                "Manifest JSON was not checked because the file is missing.",
              ),
            ]
          : manifestParseDiagnostic
            ? [manifestParseDiagnostic]
            : [],
    },
    {
      id: "DD-MAN-003",
      description: "Documented manifest properties have valid shapes.",
      category: "manifest",
      documentationUrl: DOMO_MANIFEST_DOCS,
      run: (context) => {
        if (context.manifestText === undefined)
          return [
            skipped(
              "DD-MAN-003",
              "Manifest structure was not checked because the file is missing.",
            ),
          ];
        if (manifestParseDiagnostic)
          return [
            skipped(
              "DD-MAN-003",
              "Manifest structure was not checked because JSON parsing failed.",
            ),
          ];
        if (invalidManifestRoot)
          return [
            diagnostic({
              ruleId: "DD-MAN-003",
              severity: "error",
              status: "failed",
              message: "Manifest JSON root must be an object.",
              file: context.manifestPath,
              explanation:
                "A Domo manifest is a JSON object containing design metadata.",
              suggestion: "Use a JSON object at the top level.",
              docs: DOMO_MANIFEST_DOCS,
            }),
          ];
        return context.manifest
          ? checkManifestStructure(context.manifest, context.manifestPath)
          : [];
      },
    },
    {
      id: "DD-MAN-004",
      description: "Dataset aliases are unique.",
      category: "mappings",
      documentationUrl: DOMO_MANIFEST_DOCS,
      run: (context) => {
        if (!context.manifest || manifestParseDiagnostic)
          return [
            skipped(
              "DD-MAN-004",
              "Dataset aliases were not checked because a valid manifest was unavailable.",
            ),
          ];
        if (
          !Array.isArray(context.manifest.mapping) ||
          context.manifest.mapping.length === 0
        )
          return [skipped("DD-MAN-004", "No dataset mappings are configured.")];
        return checkMappings(context.manifest, context.manifestPath).filter(
          (item) => item.ruleId === "DD-MAN-004",
        );
      },
    },
    {
      id: "DD-MAN-005",
      description: "Field aliases are unique within each dataset mapping.",
      category: "mappings",
      documentationUrl: DOMO_MANIFEST_DOCS,
      run: (context) => {
        if (!context.manifest || manifestParseDiagnostic)
          return [
            skipped(
              "DD-MAN-005",
              "Field aliases were not checked because a valid manifest was unavailable.",
            ),
          ];
        if (
          !Array.isArray(context.manifest.mapping) ||
          context.manifest.mapping.length === 0
        )
          return [skipped("DD-MAN-005", "No dataset mappings are configured.")];
        return checkMappings(context.manifest, context.manifestPath).filter(
          (item) => item.ruleId === "DD-MAN-005",
        );
      },
    },
    {
      id: "DD-MAN-006",
      description: "Dataset and field mapping definitions are well formed.",
      category: "mappings",
      documentationUrl: DOMO_MANIFEST_DOCS,
      run: (context) => {
        if (!context.manifest || manifestParseDiagnostic)
          return [
            skipped(
              "DD-MAN-006",
              "Mapping definitions were not checked because a valid manifest was unavailable.",
            ),
          ];
        if (context.manifest.mapping === undefined)
          return [skipped("DD-MAN-006", "No mapping property is configured.")];
        return checkMappings(context.manifest, context.manifestPath).filter(
          (item) => item.ruleId === "DD-MAN-006",
        );
      },
    },
    {
      id: "DD-MAN-007",
      description:
        "Advanced request proxy configuration is checked conditionally.",
      category: "proxy",
      documentationUrl: "https://developer.domo.com/docs/tools/dev-studio-cli",
      run: (context) => {
        if (!context.manifest || manifestParseDiagnostic)
          return [
            skipped(
              "DD-MAN-007",
              "Proxy configuration was not checked because a valid manifest was unavailable.",
            ),
          ];
        if (!sourceReferencesAdvancedProxy(context))
          return [
            {
              ruleId: "DD-MAN-007",
              severity: "info",
              status: "passed",
              message: "No static advanced-proxy requirement was detected.",
              explanation:
                "No DQL, writeback, OAuth, or AppDB request markers were found. Publication readiness and proxy authentication were not verified.",
              documentationUrl:
                "https://developer.domo.com/docs/tools/dev-studio-cli",
              confidence: "medium",
            },
          ];
        if (!context.manifest.proxyId)
          return [
            {
              ruleId: "DD-MAN-007",
              severity: "warning",
              status: "unverified",
              message:
                "Advanced Domo request detected without a manifest proxyId.",
              explanation:
                "Domo documents proxyId as required for advanced requests such as AppDB, DQL, or OAuth when using the Dev Studio CLI proxy. The app's runtime and publication state cannot be established statically.",
              suggestion:
                "If you use Domo's advanced local proxy, publish the app and configure the appropriate proxyId. Do not add one solely for ordinary dataset requests.",
              documentationUrl:
                "https://developer.domo.com/docs/tools/dev-studio-cli",
              confidence: "medium",
            },
          ];
        return [
          {
            ruleId: "DD-MAN-007",
            severity: "info",
            status: "unverified",
            message: "proxyId is present, but its validity was not checked.",
            explanation:
              "A local static scan cannot confirm that this proxyId is valid for the app, current card, or Domo instance.",
            suggestion:
              "Verify advanced proxy behavior with the Domo CLI in the intended Domo environment.",
            documentationUrl:
              "https://developer.domo.com/docs/tools/dev-studio-cli",
            confidence: "low",
          },
        ];
      },
    },
    {
      id: "DD-MAP-001",
      description:
        "Literal dataset requests use aliases declared in the manifest.",
      category: "mappings",
      documentationUrl: DOMO_MANIFEST_DOCS,
      run: (context) => analyzeDatasetReferences(context),
    },
    {
      id: "DD-MAP-002",
      description: "Dynamic Domo GET paths are reported as unverified.",
      category: "mappings",
      documentationUrl: DOMO_MANIFEST_DOCS,
      run: (context) => dynamicRequestResults(context),
    },
    {
      id: "DD-APPDB-001",
      description:
        "AppDB usage is identified without claiming live validation.",
      category: "appdb",
      documentationUrl: "https://developer.domo.com/docs/tools/dev-studio-cli",
      run: (context) => analyzeAppDb(context),
    },
    {
      id: "DD-PROXY-001",
      description:
        "Domo CLI executable availability is checked without reading credentials.",
      category: "proxy",
      run: async () => checkDomoCliAvailability(),
    },
  ];
}

function dynamicRequestResults(context: ScanContext): Diagnostic[] {
  if (!context.manifest)
    return [
      skipped(
        "DD-MAP-002",
        "Dynamic request paths were not checked because a valid manifest was unavailable.",
      ),
    ];
  const dynamic: Diagnostic[] = [];
  for (const parsed of context.sourceFiles) {
    const walk = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "domo" &&
        node.expression.name.text === "get" &&
        node.arguments.length > 0
      ) {
        const arg = node.arguments[0];
        if (
          arg &&
          !ts.isStringLiteralLike(arg) &&
          !ts.isNoSubstitutionTemplateLiteral(arg)
        ) {
          const { line, character } =
            parsed.sourceFile.getLineAndCharacterOfPosition(
              arg.getStart(parsed.sourceFile),
            );
          dynamic.push({
            ruleId: "DD-MAP-002",
            severity: "warning",
            status: "unverified",
            message:
              "Dynamic Domo GET path could not be checked against dataset mappings.",
            file: parsed.path,
            line: line + 1,
            column: character + 1,
            explanation:
              "The API path is computed at runtime, so static analysis cannot classify it as a dataset alias request or verify the alias.",
            suggestion:
              "Verify dynamically constructed data/v1 paths at runtime, or use a literal request path where practical.",
            documentationUrl: DOMO_MANIFEST_DOCS,
            confidence: "low",
          });
        }
      }
      ts.forEachChild(node, walk);
    };
    walk(parsed.sourceFile);
  }
  if (context.sourceFilesSkipped.length > 0)
    dynamic.push(
      ...context.sourceFilesSkipped.map((file) => ({
        ruleId: "DD-MAP-002",
        severity: "warning" as const,
        status: "unverified" as const,
        message:
          "Dynamic request analysis skipped a source file above the size limit.",
        file,
        explanation: "No source analysis was performed for this file.",
        suggestion:
          "Reduce the generated file size or split it into smaller source modules.",
        confidence: "low" as const,
      })),
    );
  if (dynamic.length === 0)
    return [skipped("DD-MAP-002", "No dynamic domo.get paths were found.")];
  return dynamic;
}

function checkDomoCliAvailability(): Diagnostic[] {
  const pathValue = process.env.PATH ?? "";
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
      : [""];
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `domo${extension}`);
      try {
        const stats = statSync(candidate);
        accessSync(
          candidate,
          process.platform === "win32" ? constants.F_OK : constants.X_OK,
        );
        if (stats.isFile())
          return [
            {
              ruleId: "DD-PROXY-001",
              severity: "info",
              status: "passed",
              message: "Domo CLI executable was found on PATH.",
              explanation:
                "Executable availability was checked from PATH only. Authentication, credentials, network access, and proxy behavior were not checked.",
              confidence: "high",
            },
          ];
      } catch {
        /* Continue checking PATH entries without executing the program. */
      }
    }
  }
  return [
    {
      ruleId: "DD-PROXY-001",
      severity: "warning",
      status: "failed",
      message: "Domo CLI executable was not found on PATH.",
      explanation:
        "The Domo Dev Studio CLI was not discoverable from the current PATH. This does not indicate whether the project itself can be deployed.",
      suggestion:
        "Install or configure the Domo Dev Studio CLI and ensure its executable directory is on PATH.",
      documentationUrl: "https://developer.domo.com/docs/tools/dev-studio-cli",
      confidence: "high",
    },
  ];
}

function assertSafeScanConfig(config: ScanConfig): void {
  const root = path.resolve(config.root);
  const manifest = path.resolve(config.manifest);
  const relative = path.relative(root, manifest);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("The manifest path must remain inside the project root.");
  }
  for (const pattern of config.ignore) {
    if (
      path.isAbsolute(pattern) ||
      pattern.replaceAll("\\", "/").split("/").includes("..")
    ) {
      throw new Error(
        "Ignore patterns must be relative to the project root and cannot traverse parent directories.",
      );
    }
  }
  for (const suppression of config.suppressions) {
    if (
      suppression.file &&
      (path.isAbsolute(suppression.file) ||
        suppression.file.replaceAll("\\", "/").split("/").includes(".."))
    ) {
      throw new Error(
        "Suppression file scopes must be relative to the project root and cannot traverse parent directories.",
      );
    }
  }
}

async function lstatIfExists(file: string) {
  try {
    return await lstat(file);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return undefined;
    throw error;
  }
}

function summarize(diagnostics: readonly Diagnostic[]): ScanSummary {
  return {
    errors: diagnostics.filter(
      (item) => item.status === "failed" && item.severity === "error",
    ).length,
    warnings: diagnostics.filter(
      (item) => item.status === "failed" && item.severity === "warning",
    ).length,
    infos: diagnostics.filter(
      (item) => item.status === "failed" && item.severity === "info",
    ).length,
    passed: diagnostics.filter((item) => item.status === "passed").length,
    skipped: diagnostics.filter((item) => item.status === "skipped").length,
    unverified: diagnostics.filter((item) => item.status === "unverified")
      .length,
    suppressed: diagnostics.filter((item) => item.suppressed).length,
  };
}

function sanitizeDiagnostic(diagnostic: Diagnostic): Diagnostic {
  const safe = (value: string): string =>
    value.replace(
      /(authorization|cookie|password|passwd|token|secret|api[_-]?key)(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1$2[redacted]",
    );
  return {
    ...diagnostic,
    message: safe(diagnostic.message),
    explanation: safe(diagnostic.explanation),
    ...(diagnostic.suggestion
      ? { suggestion: safe(diagnostic.suggestion) }
      : {}),
    ...(diagnostic.suppressionReason
      ? { suppressionReason: safe(diagnostic.suppressionReason) }
      : {}),
  };
}

function relativeToRoot(config: ScanConfig, absolute: string): string {
  const relative = path.relative(config.root, absolute);
  return relative ? toPosix(relative) : ".";
}

function toPosix(value: string): string {
  return value.replaceAll("\\", "/");
}

function skipped(ruleId: string, message: string): Diagnostic {
  return {
    ruleId,
    severity: "info",
    status: "skipped",
    message,
    explanation: message,
    confidence: "high",
  };
}
