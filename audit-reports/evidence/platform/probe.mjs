import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {scanProject} from '../../../dist/index.js';
const base=path.resolve('audit-reports/evidence/platform/cases');
const mapping=[{alias:'sales',dataSetId:'00000000-0000-4000-8000-000000000001',fields:[]}];
const cases=[
['healthy',{mapping},'domo.get("/data/v1/sales");'],
['missing',{mapping},'domo.get("/data/v1/missing");'],
['null-map',{mapping:[null]},'domo.get("/data/v1/missing");'],
['mixed-null-map',{mapping:[null,...mapping]},'domo.get("/data/v1/missing");'],
['primitive-map',{mapping:[1,false,"x"]},'domo.get("/data/v1/missing");'],
['prototype-names',{mapping:[{alias:'__proto__',dataSetId:'id',fields:[{alias:'constructor',columnName:'x'}]}]},'domo.get("/data/v1/__proto__");'],
['bracket-literal',{mapping},'domo["get"]("/data/v1/missing");'],
['window-domo',{mapping},'window.domo.get("/data/v1/missing");'],
['import-renamed',{mapping},'import client from "ryuu.js"; client.get("/data/v1/missing");'],
['wrapped',{mapping},'const get = domo.get.bind(domo); get("/data/v1/missing");'],
['shadowed',{mapping},'function f(domo) { return domo.get("/data/v1/missing"); }'],
['unrelated-object',{mapping},'const domo = new Map(); domo.get("/data/v1/missing");'],
['dynamic',{mapping},'domo.get(`/data/v1/${alias}`);'],
['const-variable',{mapping},'const url = "/data/v1/missing"; domo.get(url);'],
['parenthesized',{mapping},'domo.get(("/data/v1/missing"));'],
['optional',{mapping},'domo?.get?.("/data/v1/missing");'],
['encoded-alias',{mapping},'domo.get("/data/v1/%73ales");'],
['alias-case',{mapping},'domo.get("/data/v1/Sales");'],
['endpoint-case',{mapping},'domo.get("/DATA/V1/missing");'],
['template-literal',{mapping},'domo.get(`/data/v1/missing`);'],
['query',{mapping},'domo.get("/data/v1/sales?limit=1");'],
['v2',{mapping},'domo.get("/data/v2/missing");'],
['html-inline',{mapping},'<script>domo.get("/data/v1/missing");</script>','index.html'],
['malformed-source',{mapping},'const = ;'],
['direct-appdb',{mapping},'domo.get("/domo/datastores/v1/collections/a/documents");'],
['direct-sql',{mapping},'domo.post("/sql/v1/sales", "select * from table");'],
['direct-files',{mapping},'domo.get("/domo/files/v1/files");'],
['comment-appdb',{mapping},'// appdb is not used'],
['empty',{},''],
['version-invalid',{version:'banana',mapping},''],
['invalid-mapping-type',{mapping:{}},'domo.get("/data/v1/sales");'],
['null-fields',{mapping:[{...mapping[0],fields:[null]}]},''],
['source-size',{mapping},'//'+'x'.repeat(1048576)],
];
const results=[];
for(const [name,manifest,source,filename='app.js'] of cases){
 const root=path.join(base,name); await mkdir(root,{recursive:true});
 await writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest));
 await writeFile(path.join(root,filename),source);
 const report=await scanProject({root});
 await writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));
 results.push({name,summary:report.summary,diagnostics:report.diagnostics.filter(d=>['DD-MAP-001','DD-MAP-002','DD-APPDB-001','DD-MAN-007','DD-MAN-003','DD-MAN-006'].includes(d.ruleId)).map(d=>({rule:d.ruleId,status:d.status,message:d.message}))});
}
await writeFile(path.resolve('audit-reports/evidence/platform/results.json'),JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
