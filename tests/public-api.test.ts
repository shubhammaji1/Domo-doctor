import path from "node:path";
import { writeFile } from "node:fs/promises";
import { describe, it, expect } from "vitest";
import { createDoctor } from "../src/index.js";
import { temporaryDirectory } from "./helpers.js";

describe("public API", () => {
  it("scans with defaults and supports root, cwd, config and category selection", async () => {
    const fixture = await temporaryDirectory();
    try {
      await writeFile(path.join(fixture.root, "manifest.json"), "{}");
      await writeFile(
        path.join(fixture.root, "custom.json"),
        JSON.stringify({ reporter: "json" }),
      );
      expect(createDoctor().scan).toBeTypeOf("function");
      const defaultReport = await createDoctor({ cwd: fixture.root }).scan({
        onlyCategories: ["manifest"],
      });
      expect(defaultReport.schemaVersion).toBe("1.0.0");
      const report = await createDoctor({
        root: fixture.root,
        cwd: fixture.root,
        configPath: "custom.json",
      }).scan();
      expect(
        report.diagnostics.some(
          (item) => item.ruleId === "DD-MAN-001" && item.status === "passed",
        ),
      ).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });
});
