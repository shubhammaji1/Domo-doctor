import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { createDoctor } from "../src/index.js";
import { temporaryDirectory } from "./helpers.js";

it("canonicalizes a temporary base alias before creating explicit-config fixtures", async () => {
  const parent = await temporaryDirectory();
  try {
    const target = path.join(parent.root, "real-temp");
    const alias = path.join(parent.root, "temp-alias");
    await mkdir(target);
    await symlink(
      target,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    const fixture = await temporaryDirectory(alias);
    try {
      expect(path.dirname(fixture.root)).toBe(target);
      await writeFile(path.join(fixture.root, "manifest.json"), "{}");
      await writeFile(path.join(fixture.root, "custom.json"), "{}");
      const report = await createDoctor({
        cwd: fixture.root,
        configPath: "custom.json",
      }).scan();
      expect(report.summary.errors).toBe(0);
    } finally {
      await fixture.cleanup();
    }
  } finally {
    await parent.cleanup();
  }
});
