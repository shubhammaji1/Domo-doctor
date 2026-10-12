#!/usr/bin/env node
import { Command, CommanderError, Option } from "commander";
import { writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../core/config.js";
import { passesFailureThreshold } from "../core/rule-engine.js";
import { scanProject } from "../core/scanner.js";
import {
  formatFixtureTestReport,
  runFixtureTests,
} from "../core/fixture-tests.js";
import type { RuleDefinition, Severity } from "../core/types.js";
import { formatJson } from "../reporters/json.js";
import { createSarif } from "../reporters/sarif.js";
import { formatTerminal } from "../reporters/terminal.js";
import { VERSION } from "../version.js";
import { safeDiagnosticText } from "../core/privacy.js";
import { assertSafePath } from "../core/filesystem.js";

function createProgram(): Command {
  const program = new Command();
  program
    .name("domo-doctor")
    .description("Offline-first diagnostics for Domo custom app projects.")
    .version(VERSION);

  const formats = ["terminal", "json", "sarif"] as const;
  const levels = ["error", "warning", "info"] as const;

  function addOptions(command: Command): Command {
    command.exitOverride();
    return command
      .option("-c, --config <path>", "path to domo-doctor.config.json")
      .addOption(
        new Option("-f, --format <format>", "report format").choices(formats),
      )
      .option("-o, --output <file>", "write report to a file")
      .addOption(
        new Option(
          "--severity <level>",
          "failure threshold for exit code",
        ).choices(levels),
      )
      .option("--no-color", "disable terminal colors")
      .option("-v, --verbose", "include additional scan details");
  }

  addOptions(
    program
      .command("scan [directory]")
      .description("Scan a Domo custom app project."),
  ).action(
    async (
      directory: string | undefined,
      _local: unknown,
      command: Command,
    ) => {
      const options = command.optsWithGlobals() as CliOptions;
      const root = directory
        ? path.resolve(process.cwd(), directory)
        : undefined;
      await executeScan({ options, ...(root ? { root } : {}) });
    },
  );

  const checkCommand = program
    .command("check <target> [directory]")
    .description("Run a focused diagnostic check.");
  addOptions(checkCommand).action(
    async (
      target: string,
      directory: string | undefined,
      _local: unknown,
      command: Command,
    ) => {
      const options = command.optsWithGlobals() as CliOptions;
      const categories = categoryForTarget(target);
      if (!categories)
        throw new CliUsageError(
          `Unknown check target "${target}". Choose manifest, mappings, appdb, or proxy.`,
        );
      const root = directory
        ? path.resolve(process.cwd(), directory)
        : undefined;
      await executeScan({
        options,
        ...(root ? { root } : {}),
        onlyCategories: categories,
      });
    },
  );

  program
    .command("test [fixtureDirectory]")
    .exitOverride()
    .description(
      "Run offline diagnostic expectations from *.doctor-test.json fixtures.",
    )
    .action(async (fixtureDirectory: string | undefined) => {
      const report = await runFixtureTests(
        fixtureDirectory ?? "domo-doctor-tests",
        process.cwd(),
      );
      process.stdout.write(formatFixtureTestReport(report));
      if (report.failed > 0) process.exitCode = 1;
    });

  program
    .command("init [directory]")
    .exitOverride()
    .description(
      "Create a starter Domo Doctor configuration without overwriting files.",
    )
    .action(async (directory: string | undefined) => {
      const root = path.resolve(process.cwd(), directory ?? ".");
      const target = path.join(root, "domo-doctor.config.json");
      const contents = `${JSON.stringify({ root: ".", reporter: "terminal", failOn: "error", ignore: ["node_modules/**", "dist/**", "build/**"] }, null, 2)}\n`;
      try {
        await assertSafePath(path.parse(target).root, target);
        await writeFile(target, contents, { encoding: "utf8", flag: "wx" });
        process.stdout.write(
          `Created ${safeDiagnosticText(path.relative(process.cwd(), target) || "domo-doctor.config.json")}\n`,
        );
      } catch (error) {
        if (isExists(error))
          throw new CliUsageError(
            `Configuration already exists: ${path.relative(process.cwd(), target)}`,
          );
        throw error;
      }
    });

  program
    .command("rules")
    .exitOverride()
    .description("List diagnostic rules.")
    .command("list")
    .exitOverride()
    .description("List available diagnostic rules.")
    .action(() => {
      process.stdout.write("Domo Doctor rules\n\n");
      for (const rule of RULES)
        process.stdout.write(
          `${rule.id}  [${rule.category}]  ${rule.description}\n`,
        );
    });

  program
    .command("explain <ruleId>")
    .exitOverride()
    .description("Explain a diagnostic rule.")
    .action((ruleId: string) => {
      const rule = RULES.find(
        (item) => item.id.toLowerCase() === ruleId.toLowerCase(),
      );
      if (!rule)
        throw new CliUsageError(
          `Unknown rule "${ruleId}". Run "domo-doctor rules list" to see available rules.`,
        );
      process.stdout.write(
        `${rule.id}\n${rule.description}\n\n${RULE_EXPLANATIONS[rule.id] ?? "This rule reports deterministic static checks. See the rule catalog for its current scope."}\n`,
      );
      if (rule.documentationUrl)
        process.stdout.write(`\nDocumentation: ${rule.documentationUrl}\n`);
    });

  const RULES: Array<
    Pick<RuleDefinition, "id" | "description" | "category" | "documentationUrl">
  > = [
    {
      id: "DD-MAN-001",
      description: "Manifest file exists.",
      category: "manifest",
      documentationUrl: "https://developer.domo.com/docs/tools/manifest",
    },
    {
      id: "DD-MAN-002",
      description: "Manifest is valid JSON.",
      category: "manifest",
      documentationUrl: "https://developer.domo.com/docs/tools/manifest",
    },
    {
      id: "DD-MAN-003",
      description: "Documented manifest properties have valid shapes.",
      category: "manifest",
      documentationUrl: "https://developer.domo.com/docs/tools/manifest",
    },
    {
      id: "DD-MAN-004",
      description: "Dataset aliases are unique.",
      category: "mappings",
      documentationUrl: "https://developer.domo.com/docs/tools/manifest",
    },
    {
      id: "DD-MAN-005",
      description: "Field aliases are unique within each dataset mapping.",
      category: "mappings",
      documentationUrl: "https://developer.domo.com/docs/tools/manifest",
    },
    {
      id: "DD-MAN-006",
      description: "Dataset and field mapping definitions are well formed.",
      category: "mappings",
      documentationUrl: "https://developer.domo.com/docs/tools/manifest",
    },
    {
      id: "DD-MAN-007",
      description:
        "Advanced request proxy configuration is checked conditionally.",
      category: "proxy",
      documentationUrl: "https://developer.domo.com/docs/tools/dev-studio-cli",
    },
    {
      id: "DD-MAP-001",
      description:
        "Literal dataset requests use aliases declared in the manifest.",
      category: "mappings",
      documentationUrl: "https://developer.domo.com/docs/tools/manifest",
    },
    {
      id: "DD-MAP-002",
      description: "Dynamic Domo GET paths are reported as unverified.",
      category: "mappings",
      documentationUrl: "https://developer.domo.com/docs/tools/manifest",
    },
    {
      id: "DD-APPDB-001",
      description:
        "AppDB collection declarations and static names are checked; live access remains unverified.",
      category: "appdb",
      documentationUrl: "https://developer.domo.com/docs/tools/dev-studio-cli",
    },
    {
      id: "DD-PROXY-001",
      description:
        "Domo CLI executable availability is checked without reading credentials.",
      category: "proxy",
    },
  ];

  const RULE_EXPLANATIONS: Record<string, string> = {
    "DD-MAN-001":
      "Domo custom app designs use manifest.json in the project base directory. A missing file blocks manifest-based checks.",
    "DD-MAN-002":
      "The manifest must be parseable JSON. The reported line and column come from the parser position when the runtime provides it.",
    "DD-MAN-003":
      "Known documented properties are checked when present. Unknown properties and unpublished-app omissions are not rejected.",
    "DD-MAN-004":
      "Dataset aliases are used by data request paths and must not be ambiguous within one design.",
    "DD-MAN-005":
      "Field aliases name returned fields within one dataset mapping. Repeated names can make field access ambiguous.",
    "DD-MAN-006":
      "Mapping entries and field entries are checked against the documented alias, dataSetId, and columnName shapes. Empty fields arrays are valid.",
    "DD-MAN-007":
      "Domo documents proxyId for advanced requests such as AppDB, DQL, and OAuth through the Dev Studio CLI proxy. Static checks cannot establish publication state or validate the ID.",
    "DD-MAP-001":
      "Recognized literal domo.get data/v1 paths are compared with mapping aliases using the TypeScript AST.",
    "DD-MAP-002":
      "A computed domo.get path is not treated as broken, because static analysis cannot resolve its runtime value.",
    "DD-APPDB-001":
      "Collection mapping shapes and unique collection/column names are checked locally. Literal collection requests and immutable local string tables are compared with declarations. Dynamic names, custom wrappers, deployed existence and permissions require runtime verification.",
    "DD-PROXY-001":
      "The check only looks for the Domo CLI executable on PATH. It never executes the CLI or inspects its credentials.",
  };

  interface CliOptions {
    config?: string;
    format?: (typeof formats)[number];
    output?: string;
    severity?: Severity;
    color?: boolean;
    verbose?: boolean;
  }

  async function executeScan(input: {
    options: CliOptions;
    root?: string;
    onlyCategories?: readonly RuleDefinition["category"][];
  }): Promise<void> {
    const loaded = await loadConfig({
      cwd: process.cwd(),
      ...(input.root ? { rootArg: input.root } : {}),
      ...(input.options.config ? { configArg: input.options.config } : {}),
    });
    const report = await scanProject({
      cwd: process.cwd(),
      ...(input.root ? { root: input.root } : {}),
      ...(input.options.config ? { configPath: input.options.config } : {}),
      ...(input.onlyCategories ? { onlyCategories: input.onlyCategories } : {}),
    });
    const format = input.options.format ?? loaded.config.reporter;
    const failOn = input.options.severity ?? loaded.config.failOn;
    const rendered =
      format === "json"
        ? formatJson(report)
        : format === "sarif"
          ? `${JSON.stringify(createSarif(report), null, 2)}\n`
          : `${formatTerminal(report, {
              ...(input.options.color !== undefined
                ? { color: input.options.color }
                : {}),
              ...(input.options.verbose !== undefined
                ? { verbose: input.options.verbose }
                : {}),
            })}\n`;
    if (input.options.output) {
      const outputPath = path.resolve(process.cwd(), input.options.output);
      await assertSafePath(path.parse(outputPath).root, outputPath);
      await writeFile(outputPath, rendered, { encoding: "utf8", flag: "wx" });
      process.stdout.write(
        `Wrote ${format} report to ${safeDiagnosticText(path.relative(process.cwd(), outputPath))}\n`,
      );
    } else {
      process.stdout.write(rendered);
    }
    if (passesFailureThreshold(report.diagnostics, failOn))
      process.exitCode = 1;
  }

  function categoryForTarget(
    target: string,
  ): RuleDefinition["category"][] | undefined {
    switch (target) {
      case "manifest":
        return ["manifest", "mappings"];
      case "mappings":
        return ["manifest", "mappings"];
      case "appdb":
        return ["manifest", "appdb"];
      case "proxy":
        return ["manifest", "proxy"];
      default:
        return undefined;
    }
  }

  class CliUsageError extends Error {}
  function isExists(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EEXIST"
    );
  }

  program.configureOutput({
    writeErr: (text) => process.stderr.write(safeDiagnosticText(text)),
    outputError: (text, write) => write(text),
  });
  program.exitOverride();
  return program;
}

export async function runCli(argv: string[] = process.argv): Promise<number> {
  process.exitCode = 0;
  try {
    const program = createProgram();
    await program.parseAsync(argv);
    return typeof process.exitCode === "number" ? process.exitCode : 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode === 0 ? 0 : 2;
    }
    const message =
      error instanceof Error ? error.message : "Unexpected command failure.";
    process.stderr.write(`${safeDiagnosticText(message)}\n`);
    return 2;
  } finally {
    process.exitCode = 0;
  }
}

if (
  process.argv[1] &&
  realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await runCli();
}
