import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'domo-doctor-extra-'));
const cli=new URL('../../../dist/cli/index.js',import.meta.url);
const results=[];
function run(label,args){const r=spawnSync(process.execPath,[cli.pathname.replace(/^\/(\w:)/,'$1'),...args],{encoding:'utf8',timeout:10000});results.push({label,args,status:r.status,stdout:r.stdout,stderr:r.stderr});}
try{
 await fs.writeFile(path.join(root,'manifest.json'),'{}');
 await fs.writeFile(path.join(root,'app.js'),'domo.get('+JSON.stringify('/data/v1/a\u001b[2J\u001b[HFORGED_PASS')+');');
 run('terminal-escape',['scan',root,'--no-color']);
 await fs.writeFile(path.join(root,'token=SYNTHETIC_FILENAME_SECRET.js'),'domo.get("/data/v1/missing");');
 run('filename-secret',['scan',root,'--format','json']);
 const fixture=path.join(root,'fixtures');await fs.mkdir(fixture);
 await fs.writeFile(path.join(fixture,'bad.doctor-test.json'),JSON.stringify({project:'.',expect:[{ruleId:'DD-MAN-001'}],'token=SYNTHETIC_FIXTURE_SECRET':'x'}));
 run('fixture-schema-secret',['test',fixture]);
 await fs.writeFile(new URL('./extra-probes.json',import.meta.url),JSON.stringify(results,null,2));
 console.log(JSON.stringify(results.map(r=>({label:r.label,status:r.status,containsControl:r.stdout.includes('\u001b[2J'),filenameSecret:r.stdout.includes('SYNTHETIC_FILENAME_SECRET'),fixtureSecret:r.stderr.includes('SYNTHETIC_FIXTURE_SECRET'),stderr:r.stderr})),null,2));
}finally{await fs.rm(root,{recursive:true,force:true});}
