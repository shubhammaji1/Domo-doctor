import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
const calls=[]; const originals=[];
for(const [group,object,names] of [['http',http,['request','get']],['https',https,['request','get']],['net',net,['connect','createConnection']],['dns',dns,['lookup','resolve']],['child_process',cp,['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']]]) for(const key of names){originals.push([object,key,object[key]]);object[key]=function(){calls.push(group+'.'+key);throw Error('Blocked synthetic audit external operation');};}
const originalFetch=globalThis.fetch;globalThis.fetch=async function(){calls.push('fetch');throw Error('Blocked synthetic audit fetch');}; syncBuiltinESMExports();
const root=await fs.mkdtemp(path.join(os.tmpdir(),'domo-doctor-passive-'));
async function snapshot(){const names=(await fs.readdir(root)).sort();const out={};for(const name of names)out[name]=crypto.createHash('sha256').update(await fs.readFile(path.join(root,name))).digest('hex');return out;}
try{
 await fs.writeFile(path.join(root,'manifest.json'),'{"mapping":[]}');await fs.writeFile(path.join(root,'app.js'),'throw new Error("SYNTHETIC_CODE_MUST_NOT_EXECUTE"); domo.get("/data/v1/missing");');await fs.writeFile(path.join(root,'.env'),'DOMO_TOKEN=SYNTHETIC_ENV_FILE_CREDENTIAL');
 process.env.DOMO_TOKEN='SYNTHETIC_PROCESS_ENV_CREDENTIAL';
 const before=await snapshot();const {scanProject}=await import('../../../dist/index.js');const report=await scanProject({root});const after=await snapshot();
 const result={externalOperationCalls:calls,projectFilesUnchanged:JSON.stringify(before)===JSON.stringify(after),environmentSecretPrinted:JSON.stringify(report).includes('SYNTHETIC_PROCESS_ENV_CREDENTIAL'),envFileSecretPrinted:JSON.stringify(report).includes('SYNTHETIC_ENV_FILE_CREDENTIAL'),completed:report.scan.status,report};
 await fs.writeFile(new URL('./passive-proof.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,report:undefined}));
}finally{for(const [obj,key,original]of originals)obj[key]=original;globalThis.fetch=originalFetch;syncBuiltinESMExports();delete process.env.DOMO_TOKEN;await fs.rm(root,{recursive:true,force:true});}
