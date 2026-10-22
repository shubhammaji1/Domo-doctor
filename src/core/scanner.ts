import { accessSync, constants, statSync } from "node:fs";
import { lstat } from "node:fs/promises";
import path from "node:path";
import {
  assertSafePath,
  listProjectFiles,
  readProjectFile,
} from "./filesystem.js";
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
  isDomoMethod,
  staticMemberName,
  sourceReferencesAdvancedProxy,
} from "../analyzers/source-code.js";
import { VERSION } from "../version.js";
import { htmlScripts } from "../analyzers/html.js";
import { safeDiagnosticText } from "./privacy.js";

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
  await assertSafePath(config.root, config.manifest);
  const manifestStats = await lstatIfExists(config.manifest);
  if (manifestStats?.isSymbolicLink())
    throw new Error("The manifest path must not be a symbolic link.");
  if (manifestStats && !manifestStats.isFile())
    throw new Error("The manifest path must be a regular file.");
  const manifestText = manifestStats
    ? await readProjectFile(config.root, config.manifest)
    : undefined;

  const sourceFilesSkipped: string[] = [];
  const files = await listProjectFiles(
    config.root,
    config.ignore,
    true,
    (file) => {
      sourceFilesSkipped.push(file);
    },
  );
  const sourcePaths = files.filter(
    (file) => isSourceFile(file) || /\.html?$/i.test(file),
  );
  const availableSources = new Set(sourcePaths.map(toPosix));
  const sourceFiles: ScanContext["sourceFiles"][number][] = [];
  let sourceBytes = 0;
  for (const sourcePath of sourcePaths) {
    const absolute = path.join(config.root, sourcePath);
    const stats = await lstat(absolute);
    if (stats.isSymbolicLink() || !stats.isFile()) continue;
    if (stats.size > MAX_SOURCE_FILE_BYTES) {
      sourceFilesSkipped.push(toPosix(sourcePath));
      continue;
    }
    const originalText = await readProjectFile(
      config.root,
      absolute,
      MAX_SOURCE_FILE_BYTES,
    );
    sourceBytes += Buffer.byteLength(originalText);
    if (sourceBytes > 33_554_432)
      throw new Error("Project source exceeds the 32 MiB scan limit.");
    const extension = path.extname(sourcePath).toLowerCase();
    const html = /\.html?$/.test(extension)
      ? htmlScripts(originalText, sourcePath, availableSources)
      : undefined;
    if (html?.incomplete) sourceFilesSkipped.push(toPosix(sourcePath));
    for (const text of html?.scripts ?? [originalText]) {
      const scriptKind =
        extension === ".tsx"
          ? ts.ScriptKind.TSX
          : extension === ".jsx"
            ? ts.ScriptKind.JSX
            : extension === ".js" ||
                extension === ".mjs" ||
                extension === ".cjs"
              ? ts.ScriptKind.JS
              : ts.ScriptKind.TS;
      let sourceFile: ts.SourceFile;
      try {
        const scanner = ts.createScanner(
          ts.ScriptTarget.Latest,
          true,
          ts.LanguageVariant.Standard,
          text,
        );
        let depth = 0;
        let token: ts.SyntaxKind;
        while ((token = scanner.scan()) !== ts.SyntaxKind.EndOfFileToken) {
          if (
            [
              ts.SyntaxKind.OpenParenToken,
              ts.SyntaxKind.OpenBracketToken,
              ts.SyntaxKind.OpenBraceToken,
            ].includes(token) &&
            ++depth > 128
          )
            throw new Error("Source nesting limit exceeded.");
          if (
            [
              ts.SyntaxKind.CloseParenToken,
              ts.SyntaxKind.CloseBracketToken,
              ts.SyntaxKind.CloseBraceToken,
            ].includes(token)
          )
            depth = Math.max(0, depth - 1);
        }
        sourceFile = ts.createSourceFile(
          sourcePath,
          text,
          ts.ScriptTarget.Latest,
          true,
          scriptKind,
        );
        if (
          (
            sourceFile as ts.SourceFile & {
              parseDiagnostics?: readonly ts.Diagnostic[];
            }
          ).parseDiagnostics?.length
        )
          throw new Error("Source syntax could not be parsed completely.");
      } catch {
        sourceFilesSkipped.push(toPosix(sourcePath));
        continue;
      }
      sourceFiles.push({
        path: toPosix(sourcePath),
        sourceFile,
      });
    }
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
                  "No manifest was found at the selected path. Without an explicit manifest setting, discovery checks the project root, public, src, and static directories; generated dist/build copies are not selected automatically.",
                suggestion:
                  "Check the scan root and manifest location. For a custom layout, set manifest in domo-doctor.config.json; an explicit path must exist and is never replaced by automatic discovery.",
                docs: DOMO_MANIFEST_DOCS,
              }),
            ]
          : [
              diagnostic({
                ruleId: "DD-MAN-001",
                severity: "info",
                status: "passed",
                message: "Manifest file exists.",
                file: context.manifestPath,
                explanation:
                  "This is the manifest selected by explicit configuration or automatic source manifest discovery.",
              }),
            ],
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
        if (!Array.isArray(context.manifest.mapping))
          return [
            skipped(
              "DD-MAN-006",
              "Mapping definitions were not checked because mapping is not an array.",
            ),
          ];
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
        if (
          !sourceReferencesAdvancedProxy(context) &&
          context.sourceFilesSkipped.length
        )
          return [
            {
              ruleId: "DD-MAN-007",
              severity: "warning",
              status: "unverified",
              message: "Proxy source analysis was incomplete.",
              explanation:
                "Some source files were not analyzed; advanced requests in them were not classified.",
              confidence: "low",
            },
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
        "AppDB collection declarations and static names are checked; live access remains unverified.",
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
    const pending: ts.Node[] = [parsed.sourceFile];
    while (pending.length) {
      const node = pending.pop()!;
      if (
        ts.isCallExpression(node) &&
        isDomoMethod(node.expression, "get", true)
      ) {
        const arg = node.arguments[0];
        if (
          staticMemberName(node.expression) === undefined ||
          !arg ||
          (!ts.isStringLiteralLike(arg) &&
            !ts.isNoSubstitutionTemplateLiteral(arg))
        ) {
          const { line, character } =
            parsed.sourceFile.getLineAndCharacterOfPosition(
              (arg ?? node).getStart(parsed.sourceFile),
            );
          dynamic.push({
            ruleId: "DD-MAP-002",
            severity: "warning",
            status: "unverified",
            message:
              "Domo GET path is missing, dynamic, or uses an unresolved method.",
            file: parsed.path,
            line: line + 1,
            column: character + 1,
            explanation:
              "The request has no path argument, or its method or path is computed at runtime, so static analysis cannot classify it as a dataset alias request or verify the alias.",
            suggestion:
              "Verify dynamically constructed data/v1 paths at runtime, or use a literal request path where practical.",
            documentationUrl: DOMO_MANIFEST_DOCS,
            confidence: "low",
          });
        }
      }
      ts.forEachChild(node, (child) => {
        pending.push(child);
      });
    }
  }
  if (context.sourceFilesSkipped.length > 0)
    dynamic.push(
      ...context.sourceFilesSkipped.map((file) => ({
        ruleId: "DD-MAP-002",
        severity: "warning" as const,
        status: "unverified" as const,
        message: "Source file could not be fully analyzed.",
        file,
        explanation:
          "Some source could not be checked because it is linked, malformed, exceeds scan limits, or depends on an external script.",
        suggestion:
          "Use a supported JavaScript or TypeScript file, fix syntax errors, or split oversized and deeply nested source; verify remaining requests at runtime.",
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
        "The Domo Dev Studio CLI was not discoverable from the current PATH. Authentication was not checked. This does not indicate whether the project itself can be deployed.",
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
  return Object.fromEntries(
    Object.entries(diagnostic).map(([key, value]) => [
      key,
      typeof value === "string" ? safeDiagnosticText(value) : value,
    ]),
  ) as unknown as Diagnostic;
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
