import { createDoctor } from "domo-doctor";
const doctor = createDoctor({ root: "examples/healthy-app" });
const report = await doctor.scan();
if (report.summary.errors !== 0) throw new Error("Expected zero errors from packed API");
process.stdout.write(`PACKED_API_OK ${report.tool.version}\n`);
