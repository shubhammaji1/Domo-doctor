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
  const results = checkCollections(context);
  const hits: ParsedSource[] = context.sourceFiles.filter((parsed) => {
    let found = false;
    forEachNode(parsed.sourceFile, (node) => {
      if (ts.isPropertyAccessExpression(node) && node.name.text === "appdb")
        found = true;
      if (
        ts.isStringLiteralLike(node) &&
        /\bappdb\b|\/domo\/datastores\//i.test(node.text)
      )
        found = true;
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === "@domoinc/toolkit"
      )
        found = true;
    });
    return found;
  });
  if (results.length) return results;
  if (
    hits.length === 0 &&
    context.sourceFilesSkipped.length === 0 &&
    context.manifest.collectionsMapping === undefined
  )
    return [
      skipped(
        "DD-APPDB-001",
        "No recognizable AppDB or @domoinc/toolkit usage was found.",
      ),
    ];
  const result: Diagnostic[] = hits.length
    ? [
        {
          ruleId: "DD-APPDB-001",
          severity: "warning",
          status: "unverified",
          message:
            "AppDB usage detected; live collection access was not verified.",
          explanation:
            "Local collection declarations were checked where present. Static analysis cannot establish deployed collection existence, permissions, authentication, or runtime request correctness. Dynamic collection names and custom wrappers require runtime verification.",
          suggestion:
            "Verify collection names, permissions, and request behavior in a Domo environment. This scan does not send AppDB requests or modify data.",
          documentationUrl:
            "https://developer.domo.com/docs/tools/dev-studio-cli",
          confidence: "low",
        },
      ]
    : [];
  if (context.manifest.collectionsMapping !== undefined)
    result.push(
      passed(
        "DD-APPDB-001",
        "AppDB collection declarations have valid local shapes and unique names.",
      ),
    );
  const declared = new Set(
    (Array.isArray(context.manifest.collectionsMapping)
      ? context.manifest.collectionsMapping
      : []
    )
      .filter(isRecord)
      .flatMap((entry) =>
        [entry.name, entry.id].filter((value) => typeof value === "string"),
      ),
  );
  for (const parsed of hits) {
    const uncertain = hasUnresolvedDomoBinding(parsed.sourceFile);
    const constants = collectionConstants(parsed.sourceFile);
    forEachNode(parsed.sourceFile, (node) => {
      if (
        !ts.isCallExpression(node) ||
        !ts.isPropertyAccessExpression(node.expression)
      )
        return;
      const receiver = node.expression.expression;
      const appdb =
        ts.isPropertyAccessExpression(receiver) &&
        receiver.name.text === "appdb" &&
        [
          "list",
          "get",
          "create",
          "update",
          "remove",
          "query",
          "partialUpdate",
          "bulkCreate",
          "bulkUpsert",
          "bulkDelete",
        ].includes(node.expression.name.text);
      const http =
        isDomoMethod(node.expression, "get") ||
        isDomoMethod(node.expression, "post") ||
        isDomoMethod(node.expression, "put") ||
        isDomoMethod(node.expression, "delete");
      const arg = node.arguments[0];
      if (!arg || (!appdb && !http)) return;
      const literal = ts.isStringLiteralLike(arg)
        ? arg.text
        : ts.isPropertyAccessExpression(arg) && ts.isIdentifier(arg.expression)
          ? constants.get(`${arg.expression.text}.${arg.name.text}`)
          : undefined;
      if (literal === undefined) return;
      const name = appdb
        ? literal
        : /^\/?domo\/datastores\/v1\/collections\/([^/?#]+)/i.exec(
            literal,
          )?.[1];
      if (!name || declared.has(name)) return;
      const known =
        !uncertain &&
        (http ||
          (ts.isPropertyAccessExpression(receiver) &&
            ts.isIdentifier(receiver.expression) &&
            receiver.expression.text === "domo"));
      const location = parsed.sourceFile.getLineAndCharacterOfPosition(
        arg.getStart(parsed.sourceFile),
      );
      result.push({
        ruleId: "DD-APPDB-001",
        severity: "warning",
        status: known ? "failed" : "unverified",
        file: parsed.path,
        line: location.line + 1,
        column: location.character + 1,
        message: `AppDB request names undeclared collection ${quote(name)}.`,
        explanation:
          "The literal collection name does not match a local collectionsMapping entry. Collections provisioned outside this manifest and receivers whose identity is unresolved require manual verification.",
        confidence: known ? "high" : "low",
      });
    });
  }
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

function collectionConstants(source: ts.SourceFile): Map<string, string> {
  const result = new Map<string, string>();
  const references = new Map<string, ts.Identifier[]>();
  forEachNode(source, (node) => {
    if (!ts.isIdentifier(node)) return;
    const group = references.get(node.text) ?? [];
    group.push(node);
    references.set(node.text, group);
  });
  for (const statement of source.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      !(statement.declarationList.flags & ts.NodeFlags.Const)
    )
      continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        !declaration.initializer ||
        !ts.isObjectLiteralExpression(declaration.initializer)
      )
        continue;
      const name = declaration.name.text;
      let safe = true;
      for (const node of references.get(name)!) {
        if (node === declaration.name) continue;
        const access = node.parent;
        if (
          !ts.isPropertyAccessExpression(access) ||
          access.expression !== node
        ) {
          safe = false;
          break;
        }
        let depth = 0;
        for (
          let ancestor: ts.Node = access;
          ancestor.parent && !ts.isSourceFile(ancestor);
          ancestor = ancestor.parent
        ) {
          if (++depth > 128) {
            safe = false;
            break;
          }
          const parent = ancestor.parent;
          if (
            (ts.isBinaryExpression(parent) &&
              parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
              parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
              ancestor === parent.left) ||
            ts.isDeleteExpression(parent) ||
            ts.isPostfixUnaryExpression(parent) ||
            (ts.isPrefixUnaryExpression(parent) &&
              [
                ts.SyntaxKind.PlusPlusToken,
                ts.SyntaxKind.MinusMinusToken,
              ].includes(parent.operator)) ||
            ((ts.isForOfStatement(parent) || ts.isForInStatement(parent)) &&
              ancestor === parent.initializer)
          )
            safe = false;
        }
      }
      if (!safe) continue;
      for (const property of declaration.initializer.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          ts.isIdentifier(property.name) &&
          ts.isStringLiteralLike(property.initializer)
        )
          result.set(
            `${name}.${property.name.text}`,
            property.initializer.text,
          );
        else {
          safe = false;
          break;
        }
      }
      if (!safe)
        for (const key of result.keys())
          if (key.startsWith(`${name}.`)) result.delete(key);
    }
  }
  return result;
}

function checkCollections(context: ScanContext): Diagnostic[] {
  const mappings = context.manifest?.collectionsMapping;
  if (mappings === undefined) return [];
  const result: Diagnostic[] = [];
  const names = new Set<string>();
  function invalid(propertyPath: string, message: string): void {
    result.push({
      ruleId: "DD-APPDB-001",
      severity: "error",
      status: "failed",
      file: context.manifestPath,
      propertyPath,
      message,
      explanation:
        "Collection declarations must use an array of objects with unique nonempty names. Optional IDs and column types must be nonempty strings, syncEnabled must be boolean, and schema columns must have unique nonempty names.",
      confidence: "high",
    });
  }
  if (!Array.isArray(mappings)) {
    invalid("collectionsMapping", "collectionsMapping must be an array.");
    return result;
  }
  mappings.forEach((mapping, index) => {
    const base = `collectionsMapping[${index}]`;
    if (!isRecord(mapping)) {
      invalid(base, "Collection mapping must be an object.");
      return;
    }
    if (typeof mapping.name !== "string" || !mapping.name.trim())
      invalid(`${base}.name`, "Collection name must be a nonempty string.");
    else if (names.has(mapping.name))
      invalid(
        `${base}.name`,
        `Duplicate collection name ${quote(mapping.name)}.`,
      );
    else names.add(mapping.name);
    if (
      mapping.id !== undefined &&
      (typeof mapping.id !== "string" || !mapping.id.trim())
    )
      invalid(
        `${base}.id`,
        "Collection ID must be a nonempty string when provided.",
      );
    if (
      mapping.syncEnabled !== undefined &&
      typeof mapping.syncEnabled !== "boolean"
    )
      invalid(`${base}.syncEnabled`, "syncEnabled must be boolean.");
    if (mapping.schema === undefined) return;
    if (!isRecord(mapping.schema) || !Array.isArray(mapping.schema.columns)) {
      invalid(
        `${base}.schema`,
        "Collection schema must contain a columns array.",
      );
      return;
    }
    const columns = new Set<string>();
    mapping.schema.columns.forEach((column, columnIndex) => {
      const property = `${base}.schema.columns[${columnIndex}]`;
      if (!isRecord(column)) {
        invalid(property, "Collection column must be an object.");
        return;
      }
      if (typeof column.name !== "string" || !column.name.trim())
        invalid(`${property}.name`, "Column name must be a nonempty string.");
      else if (columns.has(column.name))
        invalid(
          `${property}.name`,
          `Duplicate column name ${quote(column.name)}.`,
        );
      else columns.add(column.name);
      if (typeof column.type !== "string" || !column.type.trim())
        invalid(`${property}.type`, "Column type must be a nonempty string.");
    });
  });
  return result;
}

export function sourceReferencesAdvancedProxy(context: ScanContext): boolean {
  for (const parsed of context.sourceFiles) {
    let found = false;
    forEachNode(parsed.sourceFile, (node) => {
      if (ts.isPropertyAccessExpression(node) && node.name.text === "appdb")
        found = true;
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
