import { runCli } from "../dist/cli/index.js";
const base = ["node", "cli"];
for (const args of [
  ["scan", "examples/healthy-app", "--format", "json"],
  ["scan", "examples/broken-app", "--no-color"],
  ["scan", "--format", "invalid"],
  ["test", "examples"],
]) {
  process.stderr.write(`BEFORE ${args.join(" ")} exit=${process.exitCode}\n`);
  const code = await runCli([...base, ...args]);
  process.stderr.write(`AFTER code=${code} exit=${process.exitCode}\n`);
}
