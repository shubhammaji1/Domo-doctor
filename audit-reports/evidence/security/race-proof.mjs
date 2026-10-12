import fs from 'node:fs';
import fsp from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import os from 'node:os';
const root=await fsp.mkdtemp(path.join(os.tmpdir(),'domo-doctor-race-'));
const inside=path.join(root,'project'); const parent=path.join(inside,'stable');const outside=path.join(root,'outside');
await fsp.mkdir(parent,{recursive:true});await fsp.mkdir(outside);
await fsp.writeFile(path.join(parent,'manifest.json'),'INSIDE_SYNTHETIC_CONTENT');await fsp.writeFile(path.join(outside,'manifest.json'),'OUTSIDE_SYNTHETIC_CONTENT');
const original=fsp.open;let instrumented=false;
fsp.open=async function(file,...args){
 if(file===path.join(parent,'manifest.json')&&!instrumented){instrumented=true;await fsp.rename(parent,path.join(inside,'old-stable'));await fsp.symlink(outside,parent,'junction');}
 return original.call(this,file,...args);
};syncBuiltinESMExports();
try{
 const {readProjectFile}=await import('../../../dist/core/filesystem.js');
 const content=await readProjectFile(inside,path.join(parent,'manifest.json'));
 const result={method:'deterministic instrumentation at open boundary after lstat path validation; synthetic directory rename+junction; not a naturally scheduled exploit',instrumented,content,boundaryEscape:content==='OUTSIDE_SYNTHETIC_CONTENT'};
 await fsp.writeFile(new URL('./race-proof.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{fsp.open=original;syncBuiltinESMExports();await fsp.rm(root,{recursive:true,force:true});}
