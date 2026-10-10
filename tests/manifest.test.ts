import { describe, expect, it } from "vitest";
import {
  checkManifestStructure,
  checkMappings,
  isRecord,
  nonEmptyString,
  parseManifest,
} from "../src/analyzers/manifest.js";

describe("manifest parser and validation", () => {
  it("parses a documented manifest while allowing unknown properties and omitted publish ID", () => {
    const parsed = parseManifest({
      manifestPath: "manifest.json",
      manifestText: JSON.stringify({
        name: "Example",
        version: "1.0.0",
        mapping: [{ alias: "sales", dataSetId: "abc", fields: [] }],
        futureDomoProperty: true,
      }),
    });
    expect(parsed.manifest?.name).toBe("Example");
    expect(parsed.manifest?.id).toBeUndefined();
    expect(parsed.diagnostic).toBeUndefined();
    expect(checkManifestStructure(parsed.manifest!, "manifest.json")).toEqual(
      [],
    );
    expect(checkMappings(parsed.manifest!, "manifest.json")).toEqual([]);
  });

  it("accepts documented optional properties when their types are valid", () => {
    const manifest = {
      name: "Optional values",
      version: "2.0.0",
      id: "published-design-id",
      proxyId: "card-proxy-id",
      fullpage: false,
      size: { width: 1, height: 0.5 },
      ignore: ["sample/**"],
      mapping: [{ alias: "events", dataSetId: "source-id" }],
    };
    expect(checkManifestStructure(manifest, "manifest.json")).toEqual([]);
    expect(checkMappings(manifest, "manifest.json")).toEqual([]);
  });

  it("reports parser positions for malformed JSON", () => {
    const parsed = parseManifest({
      manifestPath: "manifest.json",
      manifestText: '{\n  "name": "broken",\n  "mapping": [\n}',
    });
    expect(parsed.diagnostic?.ruleId).toBe("DD-MAN-002");
    expect(parsed.diagnostic?.status).toBe("failed");
    expect(parsed.diagnostic?.line).toBeGreaterThan(0);
    expect(parsed.diagnostic?.column).toBeGreaterThan(0);
  });

  it("identifies a non-object JSON root and leaves a missing file to the caller", () => {
    expect(
      parseManifest({ manifestPath: "manifest.json", manifestText: "[]" }),
    ).toEqual({ invalidRoot: true });
    expect(parseManifest({ manifestPath: "manifest.json" })).toEqual({});
  });

  it("validates known fields but accepts optional fields and an empty field list", () => {
    const manifest = {
      fullpage: "yes",
      size: { width: 0, height: "2" },
      proxyId: 42,
      id: "",
      ignore: ["src/**", 3],
      name: "",
      version: 3,
      mapping: "wrong",
      someUnknownProperty: { any: true },
    } as never;
    const result = checkManifestStructure(manifest, "manifest.json");
    expect(result).toHaveLength(9);
    expect(
      result.every(
        (item) => item.ruleId === "DD-MAN-003" && item.status === "failed",
      ),
    ).toBe(true);
    expect(checkMappings({ mapping: [] }, "manifest.json")).toEqual([]);
  });

  it("reports malformed mapping values, missing values, and field shape problems", () => {
    const result = checkMappings(
      {
        mapping: [
          null,
          { alias: " ", dataSetId: "id", fields: [] },
          { alias: "customers", dataSetId: "id", fields: "all" },
          {
            alias: "products",
            dataSetId: "id",
            fields: [null, { alias: "sku" }, { alias: " ", columnName: "SKU" }],
          },
          { alias: "incomplete", fields: [] },
        ],
      } as never,
      "manifest.json",
    );
    expect(
      result.filter((item) => item.ruleId === "DD-MAN-006").length,
    ).toBeGreaterThanOrEqual(7);
    expect(
      result.some(
        (item) => item.propertyPath === "mapping[3].fields[1].columnName",
      ),
    ).toBe(true);
    expect(result.every((item) => item.status === "failed")).toBe(true);
  });

  it("detects repeated dataset aliases and repeated field aliases only within one mapping", () => {
    const result = checkMappings(
      {
        mapping: [
          {
            alias: "orders",
            dataSetId: "one",
            fields: [
              { alias: "amount", columnName: "gross" },
              { alias: "amount", columnName: "net" },
            ],
          },
          {
            alias: "orders",
            dataSetId: "two",
            fields: [{ alias: "amount", columnName: "count" }],
          },
          { alias: "Orders", dataSetId: "three", fields: [] },
        ],
      },
      "manifest.json",
    );
    expect(result.filter((item) => item.ruleId === "DD-MAN-004")).toHaveLength(
      1,
    );
    expect(result.filter((item) => item.ruleId === "DD-MAN-005")).toHaveLength(
      1,
    );
    expect(
      result.find((item) => item.ruleId === "DD-MAN-004")?.propertyPath,
    ).toBe("mapping[1].alias");
  });

  it("does not invent findings when mapping is absent or non-array (structure owns the type error)", () => {
    expect(checkMappings({}, "manifest.json")).toEqual([]);
    expect(
      checkMappings({ mapping: "not-an-array" } as never, "manifest.json"),
    ).toEqual([]);
  });
});

describe("manifest helper guards", () => {
  it("checks record and non-empty string values", () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(nonEmptyString("x")).toBe(true);
    expect(nonEmptyString("   ")).toBe(false);
    expect(nonEmptyString(1)).toBe(false);
  });
});
