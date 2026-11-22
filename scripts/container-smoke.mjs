import {execFile}from'node:child_process';import{promisify}from'node:util';import{randomBytes}from'node:crypto';import{readFile}from'node:fs/promises';import assert from'node:assert/strict';
const exec=promisify(execFile),name='boundary-smoke-'+process.pid,token=randomBytes(32).toString('hex');
try{
  await exec('docker',['run','--detach','--rm','--name',name,'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=384m','-p','127.0.0.1::8084','-e','ADMIN_TOKEN='+token,'boundary:ci']);
  const port=(await exec('docker',['port',name,'8084'])).stdout.trim().split(':').at(-1),base='http://127.0.0.1:'+port;
  let up=false;for(let i=0;i<40;i++){try{up=(await fetch(base+'/health')).ok;}catch{}if(up)break;await new Promise(r=>setTimeout(r,250));}assert.ok(up,'Container health endpoint must become ready');
  assert.equal((await exec('docker',['exec',name,'id','-u'])).stdout.trim(),'1000');
  assert.equal((await fetch(base+'/api/compare',{method:'POST'})).status,401);
  const body=JSON.stringify({baseline:await readFile('examples/v1.json','utf8'),candidate:await readFile('examples/breaking.json','utf8')});
  const r=await fetch(base+'/api/compare',{method:'POST',headers:{'X-Admin-Token':token,'Content-Type':'application/json'},body});assert.equal(r.status,200);assert.equal((await r.json()).verdict,'BLOCK');
  console.log('Nonroot, read-only container: health, token rejection, and real BLOCK report verified.');
}finally{await exec('docker',['rm','--force',name]).catch(()=>{});}
