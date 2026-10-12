import type { ScanReport } from "../core/types.js";

export function formatJson(report: ScanReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
