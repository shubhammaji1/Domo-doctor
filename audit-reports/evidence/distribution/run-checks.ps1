$ErrorActionPreference = 'Stop'
$root = (Resolve-Path '.').Path
$ev = Join-Path $root 'audit-reports/evidence/distribution'
$consumer = Join-Path $ev 'consumer'
$globalPrefix = Join-Path $ev 'global-prefix'
New-Item -ItemType Directory -Force $consumer | Out-Null
Set-Content (Join-Path $consumer 'package.json') '{"private":true,"type":"module"}'
$pub = Join-Path $ev 'domo-doctor-0.1.0.tgz'
$candidate = Join-Path $ev 'domo-doctor-0.1.1.tgz'
function Run-Check($name, [scriptblock]$action) {
  "CHECK: $name" | Tee-Object -FilePath (Join-Path $ev 'checks.log') -Append
  & $action 2>&1 | Tee-Object -FilePath (Join-Path $ev 'checks.log') -Append
  "EXIT: $LASTEXITCODE" | Tee-Object -FilePath (Join-Path $ev 'checks.log') -Append
}
Push-Location $consumer
try {
 Run-Check 'published fresh install (scripts disabled after inspection)' { npm install $pub --ignore-scripts --no-audit --no-fund }
 Run-Check 'published CLI direct invocation' { node node_modules/domo-doctor/dist/cli/index.js --help }
 Run-Check 'published ESM import' { node --input-type=module -e 'import("domo-doctor").then(m=>console.log(Object.keys(m)))' }
 Run-Check 'upgrade published to candidate' { npm install $candidate --ignore-scripts --no-audit --no-fund }
 Run-Check 'candidate local CLI help via offline npx' { npx --offline domo-doctor --help }
 Run-Check 'candidate version' { npx --offline domo-doctor --version }
 Run-Check 'candidate ESM package import' { node --input-type=module -e 'import {createDoctor} from "domo-doctor"; console.log(typeof createDoctor)' }
 Run-Check 'candidate CJS require contract' { node -e 'try { require("domo-doctor"); process.exit(1); } catch(e) { console.log(e.code); if(e.code!=="ERR_PACKAGE_PATH_NOT_EXPORTED") process.exit(1); }' }
 Run-Check 'candidate production dependency audit' { npm audit --omit=dev --json }
 Run-Check 'candidate installed dependencies and lifecycle' { node -e 'const fs=require("fs"); for (const n of fs.readdirSync("node_modules")) { if(n.startsWith("."))continue; const p=JSON.parse(fs.readFileSync(`node_modules/${n}/package.json`)); console.log(JSON.stringify({name:p.name,version:p.version,engines:p.engines,lifecycle:Object.fromEntries(Object.entries(p.scripts||{}).filter(([k])=>["preinstall","install","postinstall","prepare"].includes(k)))})); }' }
 Run-Check 'candidate reinstall' { npm install $candidate --ignore-scripts --no-audit --no-fund }
 Run-Check 'candidate uninstall' { npm uninstall domo-doctor --ignore-scripts --no-audit --no-fund }
 Run-Check 'candidate absent after uninstall' { node -e 'try {require.resolve("domo-doctor");process.exit(1)}catch(e){console.log(e.code)}' }
 Run-Check 'candidate clean fresh install' { npm install $candidate --ignore-scripts --no-audit --no-fund }
 Run-Check 'isolated global install' { npm install --global --prefix $globalPrefix $candidate --ignore-scripts --no-audit --no-fund }
 Run-Check 'isolated global CLI help' { & (Join-Path $globalPrefix 'domo-doctor.cmd') --help }
 Run-Check 'isolated global uninstall' { npm uninstall --global --prefix $globalPrefix domo-doctor --ignore-scripts --no-audit --no-fund }
 Run-Check 'candidate npm signature verification' { npm audit signatures }
} finally { Pop-Location }
