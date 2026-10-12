import ts from "typescript";
import { describe, expect, it } from "vitest";
import { htmlScripts as extractHtmlScripts } from "../src/analyzers/html.js";
import { analyzeAppDb } from "../src/analyzers/source-code.js";
import { sourceReferencesAdvancedProxy } from "../src/analyzers/source-code.js";
import { makeContext } from "./helpers.js";

function htmlScripts(text: string, file: string, files: string[]) {
  return extractHtmlScripts(text, file, new Set(files));
}

function scan(collectionsMapping: unknown, source = "") {
  return analyzeAppDb(
    makeContext(".", {
      manifest: { collectionsMapping },
      sourceFiles: [
        {
          path: "app.js",
          sourceFile: ts.createSourceFile(
            "app.js",
            source,
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.JS,
          ),
        },
      ],
    }),
  );
}

describe("AppDB offline checks", () => {
  it.each([
    null,
    {},
    [null],
    [{ name: "" }],
    [{ name: 1 }],
    [{ name: "Users" }, { name: "Users" }],
    [{ name: "Users", id: false, syncEnabled: "yes" }],
    [{ name: "Users", id: " " }],
    [{ name: "Users", schema: null }],
    [{ name: "Users", schema: { columns: false } }],
    [{ name: "Users", schema: { columns: [null] } }],
    [{ name: "Users", schema: { columns: [{ name: "", type: "" }] } }],
    [
      {
        name: "Users",
        schema: {
          columns: [
            { name: "a", type: "STRING" },
            { name: "a", type: false },
          ],
        },
      },
    ],
  ])("rejects malformed or ambiguous declarations: %j", (mapping) => {
    expect(
      scan(mapping).some(
        (d) => d.status === "failed" && d.severity === "error",
      ),
    ).toBe(true);
  });
  it("accepts optional properties, future column types and empty schemas", () => {
    expect(
      scan([
        {
          name: "Users",
          id: "id",
          syncEnabled: true,
          schema: { columns: [{ name: "value", type: "FUTURE_TYPE" }] },
        },
        { name: "Empty", schema: { columns: [] } },
      ]).every((d) => d.status === "passed"),
    ).toBe(true);
    expect(scan([])[0]?.status).toBe("passed");
  });
  it("checks literal requests and preserves live uncertainty", () => {
    const result = scan(
      [{ name: "Users" }],
      'domo.appdb.list("Users"); domo.appdb.update("Missing", id, {}); domo.post("/domo/datastores/v1/collections/Other/documents", {});',
    );
    expect(result.filter((d) => d.status === "failed")).toHaveLength(2);
    expect(result.some((d) => d.status === "unverified")).toBe(true);
    expect(result.some((d) => d.status === "passed")).toBe(true);
  });
  it("accepts declared collection IDs in literal HTTP paths", () => {
    expect(
      scan(
        [{ name: "Users", id: "collection-id" }],
        'domo.get("/domo/datastores/v1/collections/collection-id/documents")',
      ).some((d) => d.status === "failed"),
    ).toBe(false);
  });
  it("does not misclassify collection management or dynamic names", () => {
    const result = scan(
      [],
      'domo.appdb.listCollections(); domo.appdb.createCollection({name:"Users"}); domo.appdb.export(); domo.appdb.list(name); other.run("Users"); domo.get("/data/v1/x");',
    );
    expect(result.some((d) => d.status === "failed")).toBe(false);
  });
  it("resolves immutable local collection tables", () => {
    const result = scan(
      [{ name: "Users" }],
      'const C = {users: "Users", missing: "Missing"}; domo.appdb.list(C.users); domo.appdb.list(C.missing);',
    );
    expect(result.filter((d) => d.status === "failed")).toHaveLength(1);
    expect(result.find((d) => d.status === "failed")?.message).toContain(
      '"Missing"',
    );
  });
  it("detects AppDB proxy use without textual string markers", () => {
    expect(
      sourceReferencesAdvancedProxy(
        makeContext(".", {
          sourceFiles: [
            {
              path: "app.js",
              sourceFile: ts.createSourceFile(
                "app.js",
                "domo.appdb.list(name)",
                ts.ScriptTarget.Latest,
                true,
              ),
            },
          ],
        }),
      ),
    ).toBe(true);
  });
  it.each([
    'let C = {users: "Missing"};',
    "const C = {users: dynamic};",
    'const C = {...other, users: "Missing"};',
    'const C = {users: "Missing"}; C.users = "Users";',
    'const C = {users: "Missing"}; delete C.users;',
    'const C = {users: "Missing"}; C.users++;',
    'const C = {users: "Missing"}; ++C.users;',
    'const C = {users: "Missing"}; mutate(C);',
    'const C = {users: "Missing"}; for (C.users of names) {}',
    'const C = {users: "Missing"}; for (C.users in names) {}',
    'const C = {users: "Missing"}; function f(C) {}',
    'const C = {users: "Missing"}; ({x: C.users} = object);',
  ])(
    "leaves mutable, escaped and shadowed collection tables unresolved: %s",
    (declaration) => {
      expect(
        scan(
          [{ name: "Users" }],
          declaration + "domo.appdb.list(C.users);",
        ).some((d) => d.status === "failed"),
      ).toBe(false);
    },
  );
  it("keeps unknown receivers unverified and ignores comment-only AppDB mentions", () => {
    expect(
      scan([], 'client.appdb.list("Missing")').filter(
        (d) => d.status === "unverified",
      ),
    ).toHaveLength(2);
    expect(scan(undefined, "// appdb is mentioned here")[0]?.status).toBe(
      "skipped",
    );
    expect(
      scan(undefined, 'import toolkit from "@domoinc/toolkit"')[0]?.status,
    ).toBe("unverified");
    expect(
      scan([], 'const domo = other; domo.appdb.list("Missing")').some(
        (d) => d.confidence === "low",
      ),
    ).toBe(true);
  });
});

describe("HTML JavaScript extraction", () => {
  it("preserves original line positions and script contents", () => {
    const result = htmlScripts(
      '<!doctype html>\n<script type="MODULE">\ndomo.get("/data/v1/x")</script>\n<script>const x = 1;</script>',
      "index.html",
      [],
    );
    expect(result.incomplete).toBe(false);
    expect(result.scripts).toHaveLength(1);
    expect(result.scripts[0]).toContain('domo.get("/data/v1/x")');
    expect(
      result.scripts[0]?.split("\n")[2]?.startsWith('domo.get("/data/v1/x")'),
    ).toBe(true);
  });
  it("ignores data scripts and accepts analyzed project and public assets", () => {
    const result = htmlScripts(
      '<script type="application/ld+json">{}</script><script src="./src/main.jsx"></script><script src="./domoapi.js"></script><script src="/src/main.jsx?x"></script>',
      "index.html",
      ["src/main.jsx", "public/domoapi.js"],
    );
    expect(result).toEqual({ scripts: [], incomplete: false });
  });
  it.each([
    '<script src="https://example.com/x.js"></script>',
    '<script src="//example.com/x.js"></script>',
    '<script src="missing.js"></script>',
    "<script>unclosed",
  ])("discloses inaccessible or malformed scripts: %s", (html) => {
    expect(htmlScripts(html, "index.html", []).incomplete).toBe(true);
  });
  it("accepts classic JavaScript MIME types and nested local scripts", () => {
    expect(
      htmlScripts(
        '<script type="text/javascript">x()</script><script type="application/javascript">y()</script><script src="../app.js"></script>',
        "pages/index.html",
        ["app.js"],
      ).incomplete,
    ).toBe(false);
  });
  it("discloses base URL changes and keeps output bounded for many scripts", () => {
    expect(
      htmlScripts(
        '<base href="https://example.com"><script src="app.js"></script>',
        "index.html",
        ["app.js"],
      ).incomplete,
    ).toBe(true);
    const html = "<script>x()</script>".repeat(10000);
    const result = htmlScripts(html, "index.html", []);
    expect(result.scripts[0]!.length).toBeLessThanOrEqual(html.length);
    expect(htmlScripts("<br>".repeat(30000), "index.html", []).scripts).toEqual(
      [],
    );
  });
  it.each([
    '<button onclick="run()">Run</button>',
    '<a href="javascript:run()">Run</a>',
    '<iframe srcdoc="&lt;script>run()&lt;/script>"></iframe>',
  ])("discloses unsupported embedded code: %s", (html) => {
    expect(htmlScripts(html, "index.html", []).incomplete).toBe(true);
  });
});
