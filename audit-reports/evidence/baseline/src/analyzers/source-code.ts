import path from "node:path";
import ts from "typescript";
import type { Diagnostic, ParsedSource, ScanContext } from "../core/types.js";

const DATA_PATH = /^\/?data\/v1\/([^/?#]+)/i;

export function analyzeDatasetReferences(context: ScanContext): Diagnostic[] {
  if (!context.manifest)
    return [
      skipped(
        "DD-MAP-001",
        "Dataset source references could not be checked because a valid manifest was unavailable.",
      ),
    ];
  const aliases = new Set(
    (Array.isArray(context.manifest.mapping) ? context.manifest.mapping : [])
      .map((mapping) => mapping.alias)
      .filter(
        (alias): alias is string =>
          typeof alias === "string" && alias.length > 0,
      ),
  );
  const result: Diagnostic[] = [];
  for (const parsed of context.sourceFiles) {
    visit(parsed, (node, request) => {
      const match = DATA_PATH.exec(request);
      if (!match) return;
      const alias = match[1];
      if (!alias || aliases.has(alias)) return;
      const { line, character } =
        parsed.sourceFile.getLineAndCharacterOfPosition(
          node.getStart(parsed.sourceFile),
        );
      result.push({
        ruleId: "DD-MAP-001",
        severity: "warning",
        status: "failed",
        message: `Data request references unmapped dataset alias ${quote(alias)}.`,
        file: parsed.path,
        line: line + 1,
        column: character + 1,
        explanation: `The static request path names ${quote(alias)}, but no mapping with that exact alias is present in the manifest.`,
        suggestion:
          "Add the dataset mapping or update the request to use an existing mapping alias.",
        documentationUrl: "https://developer.domo.com/docs/tools/manifest",
        confidence: "high",
      });
    });
  }
  if (context.sourceFilesSkipped.length > 0)
    result.push(
      ...context.sourceFilesSkipped.map((file) => ({
        ruleId: "DD-MAP-001",
        severity: "warning" as const,
        status: "unverified" as const,
        message: "A source file exceeded the static analysis size limit.",
        file,
        explanation:
          "This file was not parsed, so dataset references in it were not checked.",
        suggestion:
          "Reduce the generated file size or split it into smaller source modules.",
        confidence: "low" as const,
      })),
    );
  if (result.length === 0)
    return [
      passed(
        "DD-MAP-001",
        "No unresolved literal dataset aliases were found in recognized Domo data requests.",
      ),
    ];
  return result;
}

export function analyzeAppDb(context: ScanContext): Diagnostic[] {
  if (!context.manifest)
    return [
      skipped(
        "DD-APPDB-001",
        "AppDB analysis requires a readable project; no manifest is available to cross-reference.",
      ),
    ];
  const hits: ParsedSource[] = context.sourceFiles.filter((parsed) => {
    let found = false;
    const text = parsed.sourceFile.text;
    if (text.includes("@domoinc/toolkit") || /\bappdb\b/i.test(text))
      found = true;
    return found;
  });
  if (hits.length === 0)
    return [
      skipped(
        "DD-APPDB-001",
        "No recognizable AppDB or @domoinc/toolkit usage was found.",
      ),
    ];
  return hits.map((parsed) => ({
    ruleId: "DD-APPDB-001",
    severity: "warning",
    status: "unverified",
    message:
      "AppDB-related source detected; collection configuration was not verified.",
    file: parsed.path,
    explanation:
      "The documented manifest reference does not define a collection declaration that can be cross-checked offline. Static text matching cannot establish collection existence, permissions, authentication, or runtime request correctness.",
    suggestion:
      "Verify collection names, permissions, and request behavior in a Domo environment. This scan does not send AppDB requests or modify data.",
    documentationUrl: "https://developer.domo.com/docs/tools/dev-studio-cli",
    confidence: "low",
  }));
}

export function sourceReferencesAdvancedProxy(context: ScanContext): boolean {
  for (const parsed of context.sourceFiles) {
    let found = false;
    const visitNode = (node: ts.Node): void => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        /@domoinc\/toolkit/i.test(node.moduleSpecifier.text)
      )
        found = true;
      if (
        ts.isStringLiteralLike(node) &&
        /(?:\bappdb\b|\bdql\b|\boauth\b|\bwriteback\b|\/domo\/datastores)/i.test(
          node.text,
        )
      )
        found = true;
      if (!found) ts.forEachChild(node, visitNode);
    };
    visitNode(parsed.sourceFile);
    if (found) return true;
  }
  return false;
}

export function isSourceFile(file: string): boolean {
  return /\.(?:[cm]?[jt]sx?)$/i.test(path.extname(file));
}

function visit(
  parsed: ParsedSource,
  onLiteral: (node: ts.Node, value: string) => void,
): void {
  const walk = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      isDomoMethod(node.expression, "get") &&
      node.arguments.length > 0
    ) {
      const arg = node.arguments[0];
      if (
        arg &&
        (ts.isStringLiteralLike(arg) || ts.isNoSubstitutionTemplateLiteral(arg))
      )
        onLiteral(arg, arg.text);
    }
    ts.forEachChild(node, walk);
  };
  walk(parsed.sourceFile);
}

function isDomoMethod(
  expression: ts.LeftHandSideExpression,
  method: string,
): boolean {
  if (
    !ts.isPropertyAccessExpression(expression) ||
    expression.name.text !== method
  )
    return false;
  const receiver = expression.expression;
  return ts.isIdentifier(receiver) && receiver.text === "domo";
}

function passed(ruleId: string, message: string): Diagnostic {
  return {
    ruleId,
    severity: "info",
    status: "passed",
    message,
    explanation: message,
    confidence: "high",
  };
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

function quote(value: string): string {
  return `"${value.replace(/["\\]/g, "\\$&")}"`;
}
