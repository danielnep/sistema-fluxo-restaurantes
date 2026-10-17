import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
const basePort=37000+Math.floor(Math.random()*1000);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fluxo-sync-'));
function start(name,port,env){const proc=spawn(process.execPath,['--experimental-sqlite','server.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DB_PATH:path.join(temp,name+'.sqlite'),HUB_ID:'test-store',...env},stdio:'ignore'});return proc}
async function wait(port){for(let i=0;i<40;i++){try{let r=await fetch(`http://127.0.0.1:${port}/`);if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('Servidor indisponível')}
async function post(port,url,body,token){const r=await fetch(`http://127.0.0.1:${port}/api/${url}`,{method:'POST',headers:{'Content-Type':'application/json',...(token?{'Authorization':'Bearer '+token}:{})},body:JSON.stringify(body)});return {status:r.status,json:await r.json()}}
test('nuvem aceita sincronização autenticada e respeita revisão',async()=>{
const local=start('local',basePort,{DEMO_MODE:'1'}),cloud=start('cloud',basePort+1,{MODE:'cloud',ADMIN_PASSWORD:'troque-senha-na-nuvem',SYNC_TOKEN:'test-secret-key'});
try{await Promise.all([wait(basePort),wait(basePort+1)]);
const db=new DatabaseSync(path.join(temp,'local.sqlite'));
const names=['users','shifts','products','orders','order_items','dispatches','audit','revisions','notices','notice_reads','order_requests'];
const tables=Object.fromEntries(names.map(t=>[t,db.prepare('SELECT * FROM '+t).all()]));
let denied=await post(basePort+1,'sync/push',{hub:'test-store',revision:1,tables},'invalid');assert.equal(denied.status,401);
let ok=await post(basePort+1,'sync/push',{hub:'test-store',revision:1,tables},'test-secret-key');assert.equal(ok.status,200,JSON.stringify(ok.json));
let repeated=await post(basePort+1,'sync/push',{hub:'test-store',revision:1,tables},'test-secret-key');assert.equal(repeated.json.unchanged,true);
let login=await post(basePort+1,'auth/login',{username:'admin',password:'demo1234'});assert.equal(login.status,200);
let cookie=(await fetch(`http://127.0.0.1:${basePort+1}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'admin',password:'demo1234'})})).headers.get('set-cookie').split(';')[0];
let state=await fetch(`http://127.0.0.1:${basePort+1}/api/state`,{headers:{cookie}});assert.equal(state.status,200);let data=await state.json();assert.equal(data.server_mode,'cloud');assert.equal(data.products.length,8);
const blocked=await fetch(`http://127.0.0.1:${basePort+1}/api/products`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({name:'Teste',category:'Lanches',price_cents:500})});assert.equal(blocked.status,403);
db.close();
}finally{local.kill();cloud.kill()}
});
