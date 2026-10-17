import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sistema-restaurantes-test-'));
const port=33000+Math.floor(Math.random()*2500);
const server=spawn(process.execPath,['--experimental-sqlite','server.mjs'],{cwd:path.resolve(''),env:{...process.env,DEMO_MODE:'1',PORT:String(port),DB_PATH:path.join(dir,'test.sqlite')},stdio:['ignore','pipe','pipe']});
const base=`http://127.0.0.1:${port}`;let logs='';server.stderr.on('data',d=>logs+=d);
async function wait(){for(let i=0;i<35;i++){try{const r=await fetch(base+'/');if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw new Error('Servidor não iniciou: '+logs)}
async function request(route,data,cookie){let r=await fetch(base+'/api/'+route,{method:data===undefined?'GET':'POST',headers:{'content-type':'application/json',...(cookie?{'cookie':cookie}:{})},body:data===undefined?undefined:JSON.stringify(data)});let body=await r.json();return {status:r.status,data:body,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
async function login(username){const r=await request('auth/login',{username,password:'demo1234'});assert.equal(r.status,200,JSON.stringify(r.data));return r.cookie}
test('fluxo completo: autenticação, chegada, pedido, preparo, retirada, entrega, disponibilidade e indicadores',async()=>{await wait();try{
const manager=await login('admin'),kitchen=await login('cozinha'),waiter=await login('carlos'),cashier=await login('caixa');
const state1=await request('state',undefined,manager);assert.equal(state1.status,200);assert.equal(state1.data.products.length,8);
let anon=await request('orders',{table_no:'1',items:[]});assert.equal(anon.status,401);
let newUser=await request('auth/register',{username:'novogarcom',display_name:'Novo Garçom',password:'p45678'});assert.equal(newUser.status,201);let denied=await request('auth/login',{username:'novogarcom',password:'p45678'});assert.equal(denied.status,403);
let check=await request('shift/checkin',{},waiter);assert.equal(check.status,200);assert.equal(check.data.shift.confirmed_at,null);
const before=await request('orders',{table_no:'04',waiter_id:4,items:[{product_id:1,quantity:1}]},waiter);assert.equal(before.status,409);
let confirm=await request('shift/confirm',{shift_id:check.data.shift.id},kitchen);assert.equal(confirm.status,200);
await request('device/pulse',{battery:77,device_id:'phone-1'},waiter);
const orderRequestId=crypto.randomUUID();
let order=await request('orders',{table_no:'04',waiter_id:4,items:[{product_id:1,quantity:2,notes:'sem cebola'},{product_id:5,quantity:1}],notes:'Prioridade normal',client_request_id:orderRequestId},waiter);assert.equal(order.status,201,JSON.stringify(order.data));const id=order.data.id;
let repeatedOrder=await request('orders',{table_no:'04',waiter_id:4,items:[{product_id:1,quantity:2}],client_request_id:orderRequestId},waiter);assert.equal(repeatedOrder.status,200);assert.equal(repeatedOrder.data.id,id);assert.equal(repeatedOrder.data.duplicate,true);
let preparing=await request('orders/status',{id,status:'preparing'},kitchen);assert.equal(preparing.status,200);
let ready=await request('orders/status',{id,status:'ready'},kitchen);assert.equal(ready.status,200);
let kitchenState=await request('state',undefined,kitchen);let d=kitchenState.data.dispatches.find(x=>x.order_id===id);assert.ok(d);assert.equal(d.waiter_id,4);
let ack=await request('dispatch/ack',{id:d.id},waiter);assert.equal(ack.status,200);
let deliver=await request('orders/status',{id,status:'delivered'},waiter);assert.equal(deliver.status,200);
let set=await request('products/availability',{id:1,available:false},kitchen);assert.equal(set.status,200);
let unavailable=await request('orders',{table_no:'05',waiter_id:4,items:[{product_id:1,quantity:1}],client_request_id:crypto.randomUUID()},waiter);assert.equal(unavailable.status,409);
let waiterNotices=await request('state',undefined,waiter);assert.ok(waiterNotices.data.unread_notices>0);let notification=waiterNotices.data.notices.find(n=>n.title==='Produto indisponível');assert.ok(notification);let read=await request('notices/read',{id:notification.id},waiter);assert.equal(read.status,200);let afterRead=await request('state',undefined,waiter);assert.equal(afterRead.data.notices.find(n=>n.id===notification.id).read,1);
let managerState=await request('state',undefined,manager);assert.ok(managerState.data.stats.count_today>=1);assert.ok(managerState.data.audit.find(x=>x.action==='product_availability'));
let security=await request('products/availability',{id:1,available:true},waiter);assert.equal(security.status,403);
let noPhone=await request('shift/checkin-on-behalf',{user_id:5},manager);assert.equal(noPhone.status,200);
let noPhoneConfirm=await request('shift/confirm',{shift_id:noPhone.data.shift.id},kitchen);assert.equal(noPhoneConfirm.status,200);
let noPhoneState=await request('state',undefined,manager);assert.equal(noPhoneState.data.shifts.find(s=>s.user_id===5).availability,'no_device');
let noPhoneOrder=await request('orders',{table_no:'11',waiter_id:5,items:[{product_id:5,quantity:1}],client_request_id:crypto.randomUUID()},cashier);assert.equal(noPhoneOrder.status,201);
await request('orders/status',{id:noPhoneOrder.data.id,status:'preparing'},kitchen);
await request('orders/status',{id:noPhoneOrder.data.id,status:'ready'},kitchen);
let centralState=await request('state',undefined,cashier);assert.ok(centralState.data.dispatches.find(d=>d.order_id===noPhoneOrder.data.id && d.central===1));
let fakeSource=await fetch(base+'/api/products/availability',{method:'POST',headers:{cookie:kitchen,'content-type':'application/json',origin:'https://site-malicioso.example'},body:JSON.stringify({id:1,available:true})});assert.equal(fakeSource.status,403);
let logged=await request('auth/logout',{},waiter);assert.equal(logged.status,200);
let after=await request('state',undefined,waiter);assert.equal(after.status,401);
}finally{server.kill('SIGTERM')}});
