import { parseManifest } from "../dist/analyzers/manifest.js";
console.log(
  parseManifest({
    manifestPath: "manifest.json",
    manifestText: '{\n  "name": "bad",\n  "mapping": [\n}',
  }),
);
