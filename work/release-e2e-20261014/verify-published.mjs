import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const base = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(base, '../..');
const consumer = path.join(base, 'consumer');
const installed = path.join(consumer, 'node_modules/domo-doctor');
const cli = path.join(installed, 'dist/cli/index.js');
const pod = 'D:/GWC/Projects/POCs/pod_demo';
const checks = [];
function run(args, expected = 0, cwd = consumer) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 30000 });
    assert.ifError(result.error);
    assert.equal(result.status, expected, `${args.join(' ')}: ${result.stderr}`);
    return result.stdout;
}
function check(name, fn) {
    fn(); checks.push({name, result:'PASS'});
}
async function project(name, manifest, source = '') {
    const dir = path.join(base, 'fixtures', name);
    await mkdir(path.join(dir,'public'), {recursive:true});
    if (manifest !== null) await writeFile(path.join(dir,'public/manifest.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
    await writeFile(path.join(dir,'index.js'), source);
    return dir;
}
const manifest = {name:'Published release test', mapping:[], collectionsMapping:[{name:'Items'}]};
const good = await project('good', manifest, 'domo.appdb.list("Items");');
const missing = await project('missing', null);
const invalid = await project('invalid', '{"name":');
const alias = await project('unknown-alias', manifest, 'domo.get("/data/v1/unknown");');
const dynamic = await project('dynamic', manifest, 'domo.get(`/data/v1/${alias}`);');
const unknownCollection = await project('unknown-collection', manifest, 'domo.appdb.list("Undeclared");');
const malicious = await project('never-execute', manifest, 'throw new Error("PROJECT_CODE_EXECUTED");');
const packageJson = JSON.parse(await readFile(path.join(installed,'package.json')));
assert.equal(packageJson.version,'0.1.3');
assert.ok(!['preinstall','install','postinstall','prepare'].some(key => packageJson.scripts?.[key]));
checks.push({name:'Published manifest: correct version, no install lifecycle execution',result:'PASS'});
const tarball = await readFile(path.join(base,'domo-doctor-0.1.3.tgz'));
assert.equal('sha512-'+createHash('sha512').update(tarball).digest('base64'), 'sha512-VmoUJyC3c8isXlEdtuWiTuPKmxoFZ7aePEvhkGTDE3DJJhyelFGMUMzZf6ZJcLTnSY3suIFF2w6k+zP0cLIUrA==');
checks.push({name:'Tarball integrity matches npm registry',result:'PASS'});
check('CLI version',()=>assert.equal(run(['--version']).trim(),'0.1.3'));
check('CLI help',()=>assert.match(run(['--help']),/scan/));
check('Rules and explanations',()=>{assert.match(run(['rules','list']),/DD-MAN-001/);assert.match(run(['explain','DD-APPDB-001']),/DD-APPDB-001/);});
check('Public manifest discovery and AppDB local declarations',()=>{
    const report=JSON.parse(run(['scan',good,'--format','json']));
    assert.equal(report.summary.errors,0);
    assert.ok(report.diagnostics.some(d=>d.ruleId==='DD-MAN-001' && d.status==='passed' && d.file==='public/manifest.json'));
    assert.ok(report.diagnostics.some(d=>d.ruleId==='DD-APPDB-001' && d.status==='unverified'));
});
check('Missing manifest returns exit 1',()=>assert.match(run(['scan',missing,'--format','json'],1),/DD-MAN-001/));
check('Invalid manifest returns exit 1',()=>assert.match(run(['scan',invalid,'--format','json'],1),/DD-MAN-002/));
check('Unknown alias fails warning threshold',()=>assert.match(run(['scan',alias,'--severity','warning','--format','json'],1),/DD-MAP-001/));
check('Dynamic requests remain unverified',()=>assert.ok(JSON.parse(run(['scan',dynamic,'--format','json'])).diagnostics.some(d=>d.ruleId==='DD-MAP-002'&&d.status==='unverified')));
check('Undeclared AppDB collection is reported',()=>assert.ok(JSON.parse(run(['scan',unknownCollection,'--severity','warning','--format','json'],1)).diagnostics.some(d=>d.ruleId==='DD-APPDB-001'&&d.status==='failed')));
check('Source code is never executed',()=>run(['scan',malicious,'--format','json']));
check('Focused checks',()=>{for(const target of ['manifest','mappings','appdb','proxy']) run(['check',target,good,'--format','json']);});
check('SARIF is parseable 2.1.0',()=>assert.equal(JSON.parse(run(['scan',good,'--format','sarif'])).version,'2.1.0'));
check('Terminal no-color mode',()=>{const output=run(['scan',good,'--no-color']);assert.doesNotMatch(output,/\x1b\[/);assert.match(output,/unverified/i);});
check('Invalid arguments return exit 2',()=>run(['scan',good,'--format','bad'],2));
check('Existing example fixtures pass',()=>run(['test',path.join(repo,'examples')]));
const init = await mkdtemp(path.join(base,'fixtures/init-'));
check('Init creates configuration and refuses overwrite',()=>{run(['init',init]);run(['init',init],2);});
const secret = 'SYNTHETIC_PRIVATE_20261014_DO_NOT_PRINT';
await writeFile(path.join(good,'.env'),`SECRET=${secret}`);
check('Environment file remains excluded',()=>assert.ok(!run(['scan',good,'--format','json']).includes(secret)));
const {createDoctor}=await import(pathToFileURL(path.join(installed,'dist/index.js')));
assert.equal((await createDoctor({root:good}).scan()).summary.errors,0);
checks.push({name:'Published ESM library API',result:'PASS'});
async function hashes(root) {
    const result={};
    async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
        if(entry.isSymbolicLink())continue;
        const file=path.join(dir,entry.name);
        if(entry.isDirectory())await walk(file);
        else if(/\.(?:json|js|jsx|ts|tsx|html|css|svg|png)$/.test(entry.name))result[path.relative(root,file)]=createHash('sha256').update(await readFile(file)).digest('hex');
    }}
    for(const dir of ['src','public'])await walk(path.join(root,dir));
    return result;
}
const before=await hashes(pod);
const podReport=JSON.parse(run(['scan',pod,'--format','json']));
await writeFile(path.join(base,'pod-demo-report.json'),JSON.stringify(podReport,null,2));
assert.equal(podReport.summary.errors,0);
assert.ok(podReport.diagnostics.some(d=>d.ruleId==='DD-MAN-001'&&d.status==='passed'&&d.file==='public/manifest.json'));
assert.deepEqual(await hashes(pod),before);
checks.push({name:'Published package scans POD_DEMO and leaves source/public files unchanged',result:'PASS'});
let compared=0;
async function compare(dir,relative='') {for(const entry of await readdir(dir,{withFileTypes:true})){
    const rel=path.join(relative,entry.name);if(entry.isDirectory())await compare(path.join(dir,entry.name),rel);
    else if(entry.name.endsWith('.js')){assert.deepEqual(await readFile(path.join(dir,entry.name)),await readFile(path.join(repo,'dist',rel)),`Published/local difference: ${rel}`);compared++;}
}}
await compare(path.join(installed,'dist'));
checks.push({name:`Published runtime matches local build (${compared} JavaScript files)`,result:'PASS'});
await writeFile(path.join(base,'published-results.json'),JSON.stringify({version:'0.1.3',node:process.version,platform:process.platform,checks,podSummary:podReport.summary},null,2));
console.log(JSON.stringify({passed:checks.length,podSummary:podReport.summary},null,2));
