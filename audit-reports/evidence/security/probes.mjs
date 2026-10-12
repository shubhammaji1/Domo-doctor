import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../../../', import.meta.url));
const cli=path.join(repo,'dist/cli/index.js');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'domo-doctor-security-'));
const results=[];
async function project(name, manifest={}, source='', config) {
 const root=path.join(temp,name); await fs.mkdir(root,{recursive:true});
 await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest));
 if(source) await fs.writeFile(path.join(root,'app.js'),source);
 if(config) await fs.writeFile(path.join(root,'domo-doctor.config.json'),JSON.stringify(config));
 return root;
}
function run(label,args,options={}) {
 const start=performance.now(); const out=spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:10000,...options});
 const r={label,args,exit:out.status,signal:out.signal,error:out.error?.message,durationMs:Math.round(performance.now()-start),stdout:out.stdout,stderr:out.stderr}; results.push(r); return r;
}
try {
 const root=await project('privacy',{},'domo.get("/data/v1/Authorization: Bearer SYNTHETIC_BEARER_1");');
 for(const format of ['terminal','json','sarif']) run('bearer-'+format,['scan',root,'--format',format,'--no-color','--verbose']);
 const root2=await project('suppression',{mapping:[{alias:'a',dataSetId:'1'},{alias:'a',dataSetId:'2'}]},'',{suppressions:[{ruleId:'DD-MAN-004',reason:'Authorization: Bearer SYNTHETIC_BEARER_2'}]});
 for(const format of ['terminal','json','sarif']) run('suppression-bearer-'+format,['scan',root2,'--format',format,'--no-color','--verbose']);
 const unknown=await project('unknown',{},'',{rules:{'token=SYNTHETIC_RULE_SECRET':'off'}}); run('unknown-rule-secret',['scan',unknown]);
 const bad=await project('malformed'); await fs.writeFile(path.join(bad,'manifest.json'),'{"token":"SYNTHETIC_PARSE_SECRET",broken');run('manifest-parse-secret',['scan',bad,'--format','json']);
 const conf=await project('bad-config'); await fs.writeFile(path.join(conf,'domo-doctor.config.json'),'{"token":"SYNTHETIC_CONFIG_SECRET",broken');run('config-parse-secret',['scan',conf]);
 const escape=await project('escape',{},'',{root:'..'});run('config-root-escape',['scan',escape]);
 const large=await project('large');await fs.writeFile(path.join(large,'manifest.json'),' '.repeat(1048577));run('manifest-size',['scan',large]);
 const proto=await project('prototype',JSON.parse('{"__proto__":{"polluted":"SYNTHETIC_POLLUTION"},"mapping":[{"alias":"__proto__","dataSetId":"x"}]}'));run('prototype',['scan',proto,'--format','json']);
 const deep=await project('deep-source',{},'const x='+ '('.repeat(3000)+'1'+')'.repeat(3000)+';');run('deep-source-stack',['scan',deep,'--format','json']);
 const deepjson=await project('deep-invalid-json');await fs.writeFile(path.join(deepjson,'manifest.json'),'['.repeat(10000)+'broken');run('deep-manifest-stack',['scan',deepjson,'--format','json']);
 const overwrite=await project('overwrite',{name:'original-synthetic-data'});run('output-overwrites-input',['scan',overwrite,'--format','json','--output',path.join(overwrite,'manifest.json')]);results.push({label:'overwrite-observed',after:JSON.parse(await fs.readFile(path.join(overwrite,'manifest.json'),'utf8'))});
 const outside=await project('outside',{name:'outside-synthetic-manifest'});const linked=await project('junction');await fs.symlink(outside,path.join(linked,'nested'),'junction');await fs.writeFile(path.join(linked,'domo-doctor.config.json'),JSON.stringify({manifest:'nested/manifest.json'}));run('manifest-parent-junction',['scan',linked]);
 const ancestor=path.join(temp,'ancestor-link');await fs.symlink(temp,ancestor,'junction');run('root-ancestor-junction',['scan',path.join(ancestor,'outside'),'--format','json']);
 const outlink=path.join(overwrite,'outlink');await fs.symlink(outside,outlink,'junction');await fs.writeFile(path.join(outside,'report.json'),'SYNTHETIC_EXISTING_REPORT');run('output-parent-junction',['scan',overwrite,'--format','json','--output',path.join(outlink,'report.json')]);results.push({label:'output-junction-observed',changed:(await fs.readFile(path.join(outside,'report.json'),'utf8'))!=='SYNTHETIC_EXISTING_REPORT'});
 await fs.writeFile(new URL('./security-probes.json',import.meta.url),JSON.stringify({environment:{node:process.version,platform:process.platform,temp},results},null,2));
 console.log(JSON.stringify(results.map(r=>({label:r.label,exit:r.exit,error:r.error,secretLeaked:/SYNTHETIC_(?:BEARER|RULE_SECRET)/.test((r.stdout??'')+(r.stderr??'')),stderr:r.stderr,changed:r.changed})),null,2));
}finally{await fs.rm(temp,{recursive:true,force:true});}
