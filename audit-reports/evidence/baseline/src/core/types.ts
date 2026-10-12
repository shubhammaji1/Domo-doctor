import type ts from "typescript";

export type Severity = "error" | "warning" | "info";
export type CheckStatus = "passed" | "failed" | "skipped" | "unverified";
export type Confidence = "high" | "medium" | "low";

export interface Diagnostic {
  ruleId: string;
  severity: Severity;
  status: CheckStatus;
  message: string;
  file?: string;
  propertyPath?: string;
  line?: number;
  column?: number;
  explanation: string;
  suggestion?: string;
  documentationUrl?: string;
  confidence?: Confidence;
  suppressed?: boolean;
  suppressionReason?: string;
}

export interface RuleDefinition {
  id: string;
  description: string;
  category: "project" | "manifest" | "mappings" | "appdb" | "proxy";
  documentationUrl?: string;
  timeoutMs?: number;
  run(context: ScanContext): Promise<Diagnostic[]> | Diagnostic[];
}

export interface ManifestField {
  alias?: string;
  columnName?: string;
  [key: string]: unknown;
}

export interface ManifestMapping {
  alias?: string;
  dataSetId?: string;
  fields?: ManifestField[];
  [key: string]: unknown;
}

export interface DomoManifest {
  name?: string;
  version?: string;
  id?: string;
  fullpage?: boolean;
  size?: { width?: number; height?: number; [key: string]: unknown };
  mapping?: ManifestMapping[];
  proxyId?: string;
  ignore?: string[];
  [key: string]: unknown;
}

export interface ParsedSource {
  path: string;
  sourceFile: ts.SourceFile;
}

export interface ScanConfig {
  root: string;
  manifest: string;
  rules: Record<string, Severity | "off">;
  ignore: string[];
  reporter: "terminal" | "json" | "sarif";
  failOn: Severity;
  suppressions: Array<{ ruleId: string; reason: string; file?: string }>;
  ruleTimeoutMs: number;
}

export interface ScanContext {
  readonly root: string;
  readonly manifestPath: string;
  readonly manifestText?: string;
  readonly manifest?: DomoManifest;
  readonly files: readonly string[];
  readonly sourceFiles: readonly ParsedSource[];
  readonly sourceFilesSkipped: readonly string[];
  readonly config: ScanConfig;
}

export interface RuleExecution {
  ruleId: string;
  description: string;
  status: CheckStatus;
  durationMs: number;
}

export interface ScanSummary {
  errors: number;
  warnings: number;
  infos: number;
  passed: number;
  skipped: number;
  unverified: number;
  suppressed: number;
}

export interface ScanReport {
  schemaVersion: "1.0.0";
  tool: { name: "domo-doctor"; version: string };
  scan: {
    status: "completed";
    project: string;
    startedAt: string;
    durationMs: number;
  };
  summary: ScanSummary;
  rules: RuleExecution[];
  diagnostics: Diagnostic[];
}
