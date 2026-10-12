import { chmod, readFile, writeFile } from "node:fs/promises";

const cliPath = new URL("../dist/cli/index.js", import.meta.url);
const contents = await readFile(cliPath, "utf8");
if (!contents.startsWith("#!/usr/bin/env node\n")) {
  await writeFile(cliPath, `#!/usr/bin/env node\n${contents}`, "utf8");
}
await chmod(cliPath, 0o755);
