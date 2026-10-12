import path from "node:path";
import ts from "typescript";
import type { Diagnostic, ParsedSource, ScanContext } from "../core/types.js";
import { isRecord } from "./manifest.js";

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
      .filter(isRecord)
      .map((mapping) => mapping.alias)
      .filter(
        (alias): alias is string =>
          typeof alias === "string" && alias.length > 0,
      ),
  );
  const result: Diagnostic[] = [];
  for (const parsed of context.sourceFiles) {
    const uncertainReceiver = hasUnresolvedDomoBinding(parsed.sourceFile);
    visit(parsed, (node, request) => {
      const match = DATA_PATH.exec(request);
      if (!match) return;
      const alias = match[1];
      if (!alias || (!uncertainReceiver && aliases.has(alias))) return;
      const { line, character } =
        parsed.sourceFile.getLineAndCharacterOfPosition(
          node.getStart(parsed.sourceFile),
        );
      if (uncertainReceiver) {
        result.push({
          ruleId: "DD-MAP-001",
          severity: "warning",
          status: "unverified",
          message:
            "A local domo binding prevents reliable dataset request classification.",
          file: parsed.path,
          line: line + 1,
          column: character + 1,
          explanation:
            "This file declares a domo binding whose Domo client identity was not established. The limited binding check does not resolve scopes or runtime values.",
          suggestion:
            "Verify the receiver is the Domo client and check the request against the intended manifest.",
          confidence: "low",
        });
        return;
      }
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
        message: "A source file could not be fully analyzed.",
        file,
        explanation:
          "This file was not parsed, so dataset references in it were not checked.",
        suggestion:
          "Check file size, syntax, and supported source formats before relying on this result.",
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
    if (
      text.includes("@domoinc/toolkit") ||
      /\bappdb\b|\/domo\/datastores\//i.test(text)
    )
      found = true;
    return found;
  });
  if (hits.length === 0 && context.sourceFilesSkipped.length === 0)
    return [
      skipped(
        "DD-APPDB-001",
        "No recognizable AppDB or @domoinc/toolkit usage was found.",
      ),
    ];
  const result: Diagnostic[] = hits.map((parsed) => ({
    ruleId: "DD-APPDB-001",
    severity: "warning",
    status: "unverified",
    message:
      "AppDB-related source detected; collection configuration was not verified.",
    file: parsed.path,
    explanation:
      "This release does not validate collection declarations. Static text matching cannot establish collection existence, permissions, authentication, or runtime request correctness.",
    suggestion:
      "Verify collection names, permissions, and request behavior in a Domo environment. This scan does not send AppDB requests or modify data.",
    documentationUrl: "https://developer.domo.com/docs/tools/dev-studio-cli",
    confidence: "low",
  }));
  for (const file of context.sourceFilesSkipped) {
    result.push({
      ruleId: "DD-APPDB-001",
      severity: "warning",
      status: "unverified",
      message:
        "AppDB usage could not be checked in an incompletely analyzed source file.",
      file,
      explanation:
        "This file was not parsed, so the absence of AppDB references cannot be established.",
      confidence: "low",
    });
  }
  return result;
}

export function sourceReferencesAdvancedProxy(context: ScanContext): boolean {
  for (const parsed of context.sourceFiles) {
    let found = false;
    forEachNode(parsed.sourceFile, (node) => {
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
    });
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
  forEachNode(parsed.sourceFile, (node) => {
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
  });
}

function forEachNode(root: ts.Node, callback: (node: ts.Node) => void): void {
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop()!;
    callback(node);
    ts.forEachChild(node, (child) => {
      pending.push(child);
    });
  }
}

function hasUnresolvedDomoBinding(source: ts.SourceFile): boolean {
  let unresolved = false;
  forEachNode(source, (node) => {
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isBindingElement(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.name.text === "domo"
    ) {
      const initializer = ts.isVariableDeclaration(node)
        ? node.initializer
        : undefined;
      const knownGlobal =
        initializer &&
        ts.isPropertyAccessExpression(initializer) &&
        ts.isIdentifier(initializer.expression) &&
        ["window", "globalThis"].includes(initializer.expression.text) &&
        initializer.name.text === "domo";
      if (!knownGlobal) unresolved = true;
    }
    if (ts.isImportDeclaration(node) && node.importClause) {
      const clause = node.importClause;
      const names = clause.namedBindings;
      const bindsDomo =
        clause.name?.text === "domo" ||
        (names && ts.isNamespaceImport(names) && names.name.text === "domo") ||
        (names &&
          ts.isNamedImports(names) &&
          names.elements.some((item) => item.name.text === "domo"));
      if (
        bindsDomo &&
        (!ts.isStringLiteral(node.moduleSpecifier) ||
          node.moduleSpecifier.text !== "ryuu.js")
      )
        unresolved = true;
    }
    if (ts.isImportEqualsDeclaration(node) && node.name.text === "domo")
      unresolved = true;
  });
  return unresolved;
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
