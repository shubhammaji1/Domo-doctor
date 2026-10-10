import { scanProject } from "./core/scanner.js";
import {
  formatFixtureTestReport,
  runFixtureTests,
} from "./core/fixture-tests.js";
import type { ScanOptions } from "./core/scanner.js";
import type { ScanReport } from "./core/types.js";

export interface DoctorOptions {
  root?: string;
  configPath?: string;
  cwd?: string;
}

export interface Doctor {
  scan(options?: Pick<ScanOptions, "onlyCategories">): Promise<ScanReport>;
}

export function createDoctor(options: DoctorOptions = {}): Doctor {
  return {
    scan: (scanOptions = {}) =>
      scanProject({
        ...(options.root ? { root: options.root } : {}),
        ...(options.configPath ? { configPath: options.configPath } : {}),
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...scanOptions,
      }),
  };
}

export { scanProject };
export { formatFixtureTestReport, runFixtureTests };
export type {
  CheckStatus,
  Confidence,
  Diagnostic,
  RuleDefinition,
  RuleExecution,
  ScanConfig,
  ScanContext,
  ScanReport,
  ScanSummary,
  Severity,
} from "./core/types.js";
