import type {
  DomoManifest,
  Diagnostic,
  ManifestField,
  ManifestMapping,
  ScanContext,
} from "../core/types.js";
import {
  parse as parseJson,
  printParseErrorCode,
  type ParseError,
} from "jsonc-parser";

export const DOMO_MANIFEST_DOCS =
  "https://developer.domo.com/docs/tools/manifest";

export interface ManifestParseResult {
  manifest?: DomoManifest;
  invalidRoot?: boolean;
  diagnostic?: Diagnostic;
}

export function parseManifest(
  context: Pick<ScanContext, "manifestPath" | "manifestText">,
): ManifestParseResult {
  if (context.manifestText === undefined) return {};
  try {
    const parsed: unknown = JSON.parse(context.manifestText);
    if (!isRecord(parsed)) return { invalidRoot: true };
    return { manifest: parsed as DomoManifest };
  } catch (error) {
    const jsonErrors: ParseError[] = [];
    parseJson(context.manifestText, jsonErrors, {
      allowTrailingComma: false,
      disallowComments: true,
    });
    const position = jsonErrors[0]?.offset ?? extractJsonPosition(error);
    const location =
      position === undefined
        ? {}
        : lineAndColumn(context.manifestText, position);
    const parserMessage = jsonErrors[0]
      ? printParseErrorCode(jsonErrors[0].error)
      : safeJsonError(error);
    return {
      diagnostic: {
        ruleId: "DD-MAN-002",
        severity: "error",
        status: "failed",
        message: "Manifest contains invalid JSON.",
        file: context.manifestPath,
        ...location,
        explanation: parserMessage,
        suggestion:
          "Fix the JSON syntax near the reported location and run the scan again.",
        documentationUrl: DOMO_MANIFEST_DOCS,
        confidence: "high",
      },
    };
  }
}

export function checkManifestStructure(
  manifest: DomoManifest,
  file: string,
): Diagnostic[] {
  const issues: Array<{ path: string; message: string }> = [];
  if (manifest.name !== undefined && !nonEmptyString(manifest.name))
    issues.push({
      path: "name",
      message: "must be a non-empty string when provided",
    });
  if (manifest.version !== undefined && !nonEmptyString(manifest.version))
    issues.push({
      path: "version",
      message: "must be a non-empty string when provided",
    });
  if (manifest.id !== undefined && !nonEmptyString(manifest.id))
    issues.push({
      path: "id",
      message: "must be a non-empty string when provided",
    });
  if (manifest.proxyId !== undefined && !nonEmptyString(manifest.proxyId))
    issues.push({
      path: "proxyId",
      message: "must be a non-empty string when provided",
    });
  if (manifest.fullpage !== undefined && typeof manifest.fullpage !== "boolean")
    issues.push({ path: "fullpage", message: "must be a boolean" });
  if (
    manifest.ignore !== undefined &&
    (!Array.isArray(manifest.ignore) ||
      manifest.ignore.some((item) => typeof item !== "string"))
  ) {
    issues.push({
      path: "ignore",
      message: "must be an array of glob pattern strings",
    });
  }
  if (manifest.size !== undefined) {
    if (!isRecord(manifest.size))
      issues.push({ path: "size", message: "must be an object when provided" });
    else {
      for (const dimension of ["width", "height"] as const) {
        const value = manifest.size[dimension];
        if (
          value !== undefined &&
          (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
        ) {
          issues.push({
            path: `size.${dimension}`,
            message: "must be a positive number when provided",
          });
        }
      }
    }
  }
  if (manifest.mapping !== undefined && !Array.isArray(manifest.mapping))
    issues.push({ path: "mapping", message: "must be an array when provided" });
  return issues.map((issue) =>
    diagnostic({
      ruleId: "DD-MAN-003",
      severity: "error",
      status: "failed",
      message: `Invalid manifest property at ${issue.path}: ${issue.message}.`,
      file,
      location: issue.path,
      explanation:
        "The manifest property has a type or value that conflicts with the documented Domo manifest shape.",
      suggestion:
        "Correct the property type or value. Unknown properties are preserved and are not reported as invalid.",
      docs: DOMO_MANIFEST_DOCS,
    }),
  );
}

export function checkMappings(
  manifest: DomoManifest,
  file: string,
): Diagnostic[] {
  if (manifest.mapping === undefined) return [];
  if (!Array.isArray(manifest.mapping)) return [];
  const result: Diagnostic[] = [];
  const aliases = new Map<string, number>();
  manifest.mapping.forEach((rawMapping, index) => {
    const location = `mapping[${index}]`;
    if (!isRecord(rawMapping)) {
      result.push(
        diagnostic({
          ruleId: "DD-MAN-006",
          severity: "error",
          status: "failed",
          message: "Dataset mapping entry must be an object.",
          file,
          location,
          explanation:
            "Each documented dataset mapping has alias, dataSetId, and an optional fields list.",
          suggestion: "Replace this value with a dataset mapping object.",
          docs: DOMO_MANIFEST_DOCS,
        }),
      );
      return;
    }
    const mapping = rawMapping as ManifestMapping;
    const mappingAlias = mapping.alias;
    if (!nonEmptyString(mappingAlias)) {
      result.push(
        diagnostic({
          ruleId: "DD-MAN-006",
          severity: "error",
          status: "failed",
          message: "Dataset mapping is missing a non-empty alias.",
          file,
          location: `${location}.alias`,
          explanation:
            "The alias is how an app refers to the dataset in a data request.",
          suggestion: "Add a unique, non-empty alias string.",
          docs: DOMO_MANIFEST_DOCS,
        }),
      );
    } else {
      const previous = aliases.get(mappingAlias);
      if (previous !== undefined)
        result.push(
          diagnostic({
            ruleId: "DD-MAN-004",
            severity: "error",
            status: "failed",
            message: `Duplicate dataset alias: ${quoted(mappingAlias)}.`,
            file,
            location: `${location}.alias`,
            explanation: `This alias is already used by mapping[${previous}]. Requests for the alias cannot identify one mapping unambiguously.`,
            suggestion:
              "Rename one mapping alias and update its source references.",
            docs: DOMO_MANIFEST_DOCS,
          }),
        );
      else aliases.set(mappingAlias, index);
    }
    if (!nonEmptyString(mapping.dataSetId))
      result.push(
        diagnostic({
          ruleId: "DD-MAN-006",
          severity: "error",
          status: "failed",
          message: "Dataset mapping is missing a non-empty dataSetId.",
          file,
          location: `${location}.dataSetId`,
          explanation:
            "Domo's documented mapping format identifies the source dataset with dataSetId.",
          suggestion: "Add the dataset ID from the Domo dataset details URL.",
          docs: DOMO_MANIFEST_DOCS,
        }),
      );
    if (mapping.fields !== undefined && !Array.isArray(mapping.fields)) {
      result.push(
        diagnostic({
          ruleId: "DD-MAN-006",
          severity: "error",
          status: "failed",
          message: "Dataset fields must be an array when provided.",
          file,
          location: `${location}.fields`,
          explanation:
            "Domo documents fields as a list of field mappings. An empty list is valid and returns all columns.",
          suggestion:
            "Use an array of field mapping objects, or an empty array to request all columns.",
          docs: DOMO_MANIFEST_DOCS,
        }),
      );
      return;
    }
    if (Array.isArray(mapping.fields)) {
      const fieldAliases = new Map<string, number>();
      mapping.fields.forEach((rawField, fieldIndex) => {
        const fieldLoc = `${location}.fields[${fieldIndex}]`;
        if (!isRecord(rawField)) {
          result.push(
            diagnostic({
              ruleId: "DD-MAN-006",
              severity: "error",
              status: "failed",
              message: "Field mapping entry must be an object.",
              file,
              location: fieldLoc,
              explanation:
                "A documented field mapping has alias and columnName properties.",
              suggestion: "Replace this value with a field mapping object.",
              docs: DOMO_MANIFEST_DOCS,
            }),
          );
          return;
        }
        const field = rawField as ManifestField;
        if (!nonEmptyString(field.alias))
          result.push(
            diagnostic({
              ruleId: "DD-MAN-006",
              severity: "error",
              status: "failed",
              message: "Field mapping is missing a non-empty alias.",
              file,
              location: `${fieldLoc}.alias`,
              explanation:
                "The field alias is the key used to read the mapped column in app responses.",
              suggestion:
                "Add a non-empty field alias, or leave the fields list empty to use original column names.",
              docs: DOMO_MANIFEST_DOCS,
            }),
          );
        else {
          const previous = fieldAliases.get(field.alias);
          if (previous !== undefined)
            result.push(
              diagnostic({
                ruleId: "DD-MAN-005",
                severity: "error",
                status: "failed",
                message: `Duplicate field alias: ${quoted(field.alias)}.`,
                file,
                location: `${fieldLoc}.alias`,
                explanation: `This field alias is already used by fields[${previous}] in the same dataset mapping.`,
                suggestion:
                  "Rename one of the field aliases and update source references to match.",
                docs: DOMO_MANIFEST_DOCS,
              }),
            );
          else fieldAliases.set(field.alias, fieldIndex);
        }
        if (!nonEmptyString(field.columnName))
          result.push(
            diagnostic({
              ruleId: "DD-MAN-006",
              severity: "error",
              status: "failed",
              message: "Field mapping is missing a non-empty columnName.",
              file,
              location: `${fieldLoc}.columnName`,
              explanation:
                "columnName identifies the source column mapped to this field alias.",
              suggestion: "Add the source dataset column name.",
              docs: DOMO_MANIFEST_DOCS,
            }),
          );
      });
    }
  });
  return result;
}

export function diagnostic(input: {
  ruleId: string;
  severity: Diagnostic["severity"];
  status: Diagnostic["status"];
  message: string;
  file: string;
  location?: string;
  explanation: string;
  suggestion?: string;
  docs?: string;
}): Diagnostic {
  return {
    ruleId: input.ruleId,
    severity: input.severity,
    status: input.status,
    message: input.message,
    file: input.file,
    ...(input.location ? { propertyPath: input.location } : {}),
    explanation: input.explanation,
    ...(input.suggestion ? { suggestion: input.suggestion } : {}),
    ...(input.docs ? { documentationUrl: input.docs } : {}),
    confidence: "high",
  };
}

export function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractJsonPosition(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined;
  const match = error.message.match(/(?:position|at position)\s+(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

function lineAndColumn(
  text: string,
  position: number,
): { line: number; column: number } {
  const prefix = text.slice(0, Math.max(0, position));
  const lines = prefix.split(/\r\n|\r|\n/);
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function safeJsonError(error: unknown): string {
  if (!(error instanceof Error))
    return "The manifest could not be parsed as JSON.";
  return error.message.replace(
    /(?:password|token|secret|authorization)(\s*[:=]\s*)([^\s,;]+)/gi,
    "$1[redacted]",
  );
}

function quoted(value: string): string {
  return `"${value.replace(/["\\]/g, "\\$&")}"`;
}
