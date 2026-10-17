import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'fluxo.sqlite');
const PORT = Number(process.env.PORT || 3050);
const CLOUD_MODE = process.env.MODE === 'cloud';
const HUB_ID = process.env.HUB_ID || 'restaurante-principal';
const SYNC_TOKEN = process.env.SYNC_TOKEN || '';
const CLOUD_SYNC_URL = process.env.CLOUD_SYNC_URL || '';
const DEMO = process.env.DEMO_MODE === '1';
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';
const db = new DatabaseSync(DB_PATH);
db.exec(`PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000;PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,username TEXT NOT NULL UNIQUE,display_name TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN('manager','kitchen','cashier','waiter')),passhash TEXT NOT NULL,approved INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS shifts(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,start_at TEXT NOT NULL,end_at TEXT,confirmed_at TEXT,confirmed_by INTEGER,availability TEXT NOT NULL DEFAULT 'pending',device_id TEXT,last_seen TEXT,last_battery INTEGER,warning TEXT);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY,name TEXT NOT NULL,category TEXT NOT NULL,price_cents INTEGER NOT NULL DEFAULT 0,available INTEGER NOT NULL DEFAULT 1,active INTEGER NOT NULL DEFAULT 1,sort_order INTEGER NOT NULL DEFAULT 100);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY,table_no TEXT NOT NULL,waiter_id INTEGER NOT NULL,operator_id INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'new',created_at TEXT NOT NULL,started_at TEXT,ready_at TEXT,delivered_at TEXT,notes TEXT);
CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY,order_id INTEGER NOT NULL,product_id INTEGER NOT NULL,product_name TEXT NOT NULL,quantity INTEGER NOT NULL,price_cents INTEGER NOT NULL,notes TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS dispatches(id INTEGER PRIMARY KEY,order_id INTEGER NOT NULL,waiter_id INTEGER,assigned_at TEXT NOT NULL,ack_at TEXT,completed_at TEXT,status TEXT NOT NULL DEFAULT 'pending',attempt INTEGER NOT NULL DEFAULT 1,central INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,ts TEXT NOT NULL,actor_id INTEGER,action TEXT NOT NULL,entity TEXT NOT NULL,entity_id TEXT NOT NULL,data TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS notices(id INTEGER PRIMARY KEY,ts TEXT NOT NULL,audience TEXT NOT NULL,title TEXT NOT NULL,message TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notice_reads(notice_id INTEGER NOT NULL,user_id INTEGER NOT NULL,read_at TEXT NOT NULL,PRIMARY KEY(notice_id,user_id));
CREATE TABLE IF NOT EXISTS order_requests(request_id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,order_id INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS revisions(id INTEGER PRIMARY KEY AUTOINCREMENT,ts TEXT NOT NULL,action TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
`);
const now = () => new Date().toISOString();
const run = (sql,...args)=>db.prepare(sql).run(...args);
const get = (sql,...args)=>db.prepare(sql).get(...args);
const all = (sql,...args)=>db.prepare(sql).all(...args);
const hashPassword=(pass,salt=crypto.randomBytes(16).toString('hex'))=>`${salt}:${crypto.scryptSync(pass,salt,64).toString('hex')}`;
const verifyPassword=(pass,stored)=>{const [salt,hash]=stored.split(':');if(!salt||!hash)return false;const a=Buffer.from(hash,'hex');const b=crypto.scryptSync(pass,salt,64);return a.length===b.length&&crypto.timingSafeEqual(a,b)};
const sha = v=>crypto.createHash('sha256').update(v).digest('hex');
const failedLogins=new Map();
function rateLimitLogin(ip){const t=Date.now(),r=failedLogins.get(ip);if(r&&r.until>t&&r.count>=8)throw bad(429,'Muitas tentativas. Aguarde alguns minutos.');if(r&&r.until<=t)failedLogins.delete(ip)}
function rememberFailure(ip){const t=Date.now(),r=failedLogins.get(ip);failedLogins.set(ip,{count:(r&&r.until>t?r.count:0)+1,until:t+300000});if(failedLogins.size>10000)failedLogins.clear()}
const revision=()=>Number(get('SELECT COALESCE(MAX(id),0) AS n FROM revisions').n);
const listeners=new Set();
function bump(action) {run('INSERT INTO revisions(ts,action) VALUES (?,?)',now(),action); const info=JSON.stringify({revision:revision(),action});for(const c of listeners){try{c.write('event: change\ndata: '+info+'\n\n')}catch{listeners.delete(c)}}}
function notice(audience,title,message){run('INSERT INTO notices(ts,audience,title,message) VALUES (?,?,?,?)',now(),audience,title,message);}
function audit(actor,action,entity,id,data={}){run('INSERT INTO audit(ts,actor_id,action,entity,entity_id,data) VALUES (?,?,?,?,?,?)',now(),actor||null,action,entity,String(id),JSON.stringify(data))}
function createUser(username,display_name,role,password,approved=0){if(!/^[a-z0-9_.-]{3,30}$/.test(username))throw bad(400,'Usuário deve ter 3 a 30 caracteres (letras minúsculas, números, ponto ou hífen)');if(!password||password.length<6)throw bad(400,'Senha deve ter pelo menos 6 caracteres');if(!['waiter','kitchen','cashier','manager'].includes(role))throw bad(400,'Perfil inválido');if(!display_name||display_name.trim().length<2)throw bad(400,'Nome muito curto');let r=run('INSERT INTO users(username,display_name,role,passhash,approved,active,created_at) VALUES (?,?,?,?,?,1,?)',username,display_name.trim().slice(0,70),role,hashPassword(password),approved,now());return Number(r.lastInsertRowid)}
if (!get('SELECT id FROM users LIMIT 1')) {
  const adminPassword=process.env.ADMIN_PASSWORD;
  if (!adminPassword && !DEMO) throw new Error('Defina ADMIN_PASSWORD para iniciar o sistema pela primeira vez.');
  createUser('admin','Gerência','manager',adminPassword||(DEMO?'demo1234':''),1);
  if (DEMO) {
    createUser('cozinha','Cozinha','kitchen','demo1234',1);
    createUser('caixa','Caixa','cashier','demo1234',1);
    createUser('carlos','Carlos','waiter','demo1234',1);
    createUser('marina','Marina','waiter','demo1234',1);
    for(const [name,category,price] of [['X-Bacon','Lanches',2100],['X-Salada','Lanches',1900],['X-Tudo','Lanches',2700],['Batata frita','Porções',1800],['Coca-Cola lata','Bebidas',650],['Suco natural','Bebidas',900],['Água mineral','Bebidas',400],['Açaí 300ml','Sobremesas',1600]])run('INSERT INTO products(name,category,price_cents) VALUES (?,?,?)',name,category,price);
  }
}
const bad=(status,message)=>Object.assign(new Error(message),{status});
const PUBLIC_USER='id,username,display_name,role,approved,active';
function auth(req){const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('fluxo_session='));if(!cookie)return null;const raw=decodeURIComponent(cookie.slice(14));const s=get(`SELECT u.${PUBLIC_USER.replaceAll(', ',',u.')},s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`,sha(raw));return s&&s.expires_at>Date.now()&&s.approved&&s.active?s:null}
function publicUser(user){if(!user)return null;return {id:user.id,username:user.username,display_name:user.display_name,role:user.role,approved:user.approved,active:user.active}}
function requireRole(user,...roles){if(!user)throw bad(401,'Entre no sistema');if(!roles.includes(user.role))throw bad(403,'Sem permissão para esta ação')}
function obj(body){if(!body||typeof body!=='object'||Array.isArray(body))throw bad(400,'Dados inválidos');return body}
const write=(res,status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data))};
async function readBody(req){let chunks=[],bytes=0;for await(const c of req){bytes+=c.length;if(bytes>1500000)throw bad(413,'Requisição muito grande');chunks.push(c)}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{throw bad(400,'JSON inválido')}}
function activeShift(userId){return get('SELECT * FROM shifts WHERE user_id=? AND end_at IS NULL ORDER BY id DESC LIMIT 1',userId)}
function snapshot(user){let products=all(`SELECT p.id,p.name,p.category,p.price_cents,p.available,p.active,p.sort_order, COALESCE(SUM(CASE WHEN o.status <> 'cancelled' THEN oi.quantity ELSE 0 END),0) AS sales_count FROM products p LEFT JOIN order_items oi ON oi.product_id=p.id LEFT JOIN orders o ON o.id=oi.order_id GROUP BY p.id ORDER BY sales_count DESC,p.sort_order,p.name`);
let shifts=all(`SELECT s.*,u.display_name,u.role FROM shifts s JOIN users u ON u.id=s.user_id WHERE s.end_at IS NULL ORDER BY u.display_name`);if(user?.role==='waiter')shifts=shifts.filter(s=>s.user_id===user.id);
let orders=all(`SELECT o.*,u.display_name AS waiter_name, op.display_name AS operator_name FROM orders o JOIN users u ON o.waiter_id=u.id JOIN users op ON o.operator_id=op.id WHERE datetime(o.created_at) >= datetime('now','-14 days') ORDER BY o.id DESC LIMIT 300`);if(user?.role==='waiter')orders=orders.filter(o=>o.waiter_id===user.id);
let ids=orders.map(x=>x.id);let items=ids.length?all(`SELECT * FROM order_items WHERE order_id IN (${ids.map(()=>'?').join(',')})`,...ids):[];for(const o of orders)o.items=items.filter(i=>i.order_id===o.id);
let dispatches=all(`SELECT d.*,u.display_name AS waiter_name,o.table_no FROM dispatches d LEFT JOIN users u ON u.id=d.waiter_id JOIN orders o ON d.order_id=o.id WHERE d.status IN ('pending','acknowledged') ORDER BY d.id DESC LIMIT 100`);if(user?.role==='waiter')dispatches=dispatches.filter(d=>d.waiter_id===user.id);
let users=all(`SELECT ${PUBLIC_USER} FROM users WHERE active=1 ORDER BY display_name`);
const notices=all(`SELECT n.id,n.ts,n.audience,n.title,n.message,CASE WHEN nr.user_id IS NULL THEN 0 ELSE 1 END AS read
 FROM notices n LEFT JOIN notice_reads nr ON nr.notice_id=n.id AND nr.user_id=?
 WHERE n.audience='all' OR n.audience=? ORDER BY n.id DESC LIMIT 80`,user.id,user.role);
return {notices,unread_notices:notices.filter(n=>!n.read).length,revision:revision(),server_mode:CLOUD_MODE?'cloud':'local',synced_at:get("SELECT value FROM meta WHERE key='synced_at'")?.value||null,products,shifts,orders,dispatches,users:user?.role==='manager'||user?.role==='cashier'||user?.role==='kitchen'?users:users.filter(x=>x.role==='waiter').map(x=>({id:x.id,display_name:x.display_name,role:x.role})),me:publicUser(user),audit:user?.role==='manager'?all('SELECT a.*,u.display_name AS actor_name FROM audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 60'):[]};}
function insights(){
const today=all("SELECT * FROM orders WHERE datetime(created_at) >= datetime('now','-1 day') AND status<>'cancelled'");
const ready=today.filter(o=>o.ready_at);
let prep=ready.map(o=>(Date.parse(o.ready_at)-Date.parse(o.created_at))/60000).filter(x=>Number.isFinite(x)&&x>=0);
let retrieval=today.filter(o=>o.delivered_at&&o.ready_at).map(o=>(Date.parse(o.delivered_at)-Date.parse(o.ready_at))/60000).filter(x=>Number.isFinite(x)&&x>=0);
let popular=all(`SELECT p.name, SUM(oi.quantity) AS qty, p.available FROM order_items oi JOIN products p ON p.id=oi.product_id JOIN orders o ON o.id=oi.order_id WHERE datetime(o.created_at)>=datetime('now','-7 days') AND o.status <> 'cancelled' GROUP BY p.id ORDER BY qty DESC LIMIT 8`);
let waiting=Number(get("SELECT COUNT(*) AS n FROM orders WHERE status IN ('new','preparing')").n);
let outstanding=Number(get("SELECT COUNT(*) AS n FROM orders WHERE status='ready'").n);
let cancelled=Number(get("SELECT COUNT(*) AS n FROM orders WHERE datetime(created_at)>=datetime('now','-7 days') AND status='cancelled'").n);
let estimatedValue=Number(get(`SELECT COALESCE(SUM(i.price_cents*i.quantity),0) AS n FROM order_items i JOIN orders o ON o.id=i.order_id WHERE datetime(o.created_at)>=datetime('now','-7 days') AND o.status<>'cancelled'`).n);
const days=all(`SELECT SUBSTR(created_at,1,10) AS day,COUNT(*) AS count FROM orders WHERE datetime(created_at)>=datetime('now','-7 days') AND status<>'cancelled' GROUP BY SUBSTR(created_at,1,10) ORDER BY day ASC`);
const hours=all(`SELECT SUBSTR(created_at,12,2) AS hour,COUNT(*) AS count FROM orders WHERE datetime(created_at)>=datetime('now','-7 days') AND status<>'cancelled' GROUP BY SUBSTR(created_at,12,2) ORDER BY hour ASC`);
const waiters=all(`SELECT u.display_name AS name,COUNT(o.id) AS orders,SUM(CASE WHEN o.status='delivered' THEN 1 ELSE 0 END) AS delivered FROM orders o JOIN users u ON u.id=o.waiter_id WHERE datetime(o.created_at)>=datetime('now','-7 days') AND o.status<>'cancelled' GROUP BY o.waiter_id ORDER BY orders DESC`);
const unavailable=all("SELECT COUNT(*) AS n FROM products WHERE active=1 AND available=0")[0].n;
const overSla=prep.filter(x=>x>20).length;
let notes=[];
if(outstanding>=2)notes.push({kind:'warning',title:'Retiradas acumuladas',detail:`${outstanding} pedidos aguardam entrega. Priorize a retirada antes de aumentar a produção.`});
if(popular[0])notes.push({kind:'info',title:'Mais pedido da semana',detail:`${popular[0].name} lidera com ${popular[0].qty} unidades. Use esse dado para planejar compras.`});
for(const item of popular.filter(x=>!x.available))notes.push({kind:'warning',title:'Produto popular indisponível',detail:`${item.name} está indisponível apesar da alta procura. Verifique reposição.`});
if(overSla>=2)notes.push({kind:'warning',title:'Preparo acima do esperado',detail:`${overSla} pedidos concluídos nas últimas 24h levaram mais de 20 minutos até ficarem prontos.`});
if(retrieval.length>=3&&retrieval.reduce((a,b)=>a+b,0)/retrieval.length>5)notes.push({kind:'warning',title:'Gargalo na entrega',detail:'O tempo médio entre preparo e entrega supera cinco minutos. Revise a distribuição de chamadas.'});
if(!notes.length)notes.push({kind:'info',title:'Acompanhamento disponível',detail:'Os indicadores serão enriquecidos conforme os pedidos forem registrados.'});
return {count_today:today.length,waiting,ready:outstanding,mean_prep_minutes:prep.length?Math.round(10*prep.reduce((a,b)=>a+b,0)/prep.length)/10:null,mean_delivery_minutes:retrieval.length?Math.round(10*retrieval.reduce((a,b)=>a+b,0)/retrieval.length)/10:null,popular,notes,cancelled_week:cancelled,estimated_value_cents:estimatedValue,days,hours,waiters,unavailable,over_sla:overSla};
}
function assign(orderId,excluded=[]){const candidates=all(`SELECT s.user_id,s.availability,s.last_seen,s.last_battery, u.display_name, COALESCE((SELECT MAX(d.assigned_at) FROM dispatches d WHERE d.waiter_id=s.user_id),'1970-01-01') AS last_dispatch FROM shifts s JOIN users u ON u.id=s.user_id WHERE s.end_at IS NULL AND s.confirmed_at IS NOT NULL AND s.availability='available' AND u.active=1 ORDER BY last_dispatch ASC,s.start_at ASC`);
const owner=get('SELECT s.availability FROM orders o JOIN shifts s ON s.user_id=o.waiter_id AND s.end_at IS NULL WHERE o.id=? ORDER BY s.id DESC LIMIT 1',orderId);
const best=owner?.availability==='no_device'?null:candidates.find(c=>!excluded.includes(c.user_id)&&c.last_seen&&Date.now()-Date.parse(c.last_seen)<90000);
const prior=get('SELECT MAX(attempt) AS n FROM dispatches WHERE order_id=?',orderId)?.n||0;
const result=run('INSERT INTO dispatches(order_id,waiter_id,assigned_at,attempt,central) VALUES (?,?,?,?,?)',orderId,best?.user_id||null,now(),prior+1,best?0:1);
audit(null,best?'dispatch_assigned':'dispatch_central','dispatch',result.lastInsertRowid,{orderId,waiter_id:best?.user_id||null});bump('dispatch');return {id:Number(result.lastInsertRowid),waiter_id:best?.user_id||null,central:!best};}
function tickDispatch(){if(CLOUD_MODE)return;const expired=all("SELECT * FROM dispatches WHERE status='pending' AND central=0 AND assigned_at < ?",new Date(Date.now()-45000).toISOString());for(const d of expired){run("UPDATE dispatches SET status='expired' WHERE id=?",d.id);let excluded=all('SELECT waiter_id FROM dispatches WHERE order_id=? AND waiter_id IS NOT NULL',d.order_id).map(x=>x.waiter_id);assign(d.order_id,excluded)}}
const syncTables=['users','shifts','products','orders','order_items','dispatches','audit','revisions','notices','notice_reads','order_requests'];
const snapshotSync=()=>Object.fromEntries(syncTables.map(t=>[t,all('SELECT * FROM '+t)]));
function applySync(payload){if(!CLOUD_MODE)throw bad(403,'Sincronização recebida apenas na nuvem');if(!payload||payload.hub!==HUB_ID)throw bad(400,'Identificação do estabelecimento incorreta');const latest=Number(get("SELECT value FROM meta WHERE key='sync_revision'")?.value||0);if(payload.revision<=latest)return {revision:latest,unchanged:true};db.exec('BEGIN IMMEDIATE');try{for(const t of syncTables){const rows=payload.tables?.[t];if(!Array.isArray(rows))throw bad(400,'Tabela ausente: '+t);db.exec('DELETE FROM '+t);for(const row of rows){const keys=Object.keys(row);if(!keys.length)continue;run(`INSERT INTO ${t} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,...keys.map(k=>row[k]));}}run("INSERT INTO meta(key,value) VALUES ('sync_revision',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",String(payload.revision));run("INSERT INTO meta(key,value) VALUES ('synced_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",now());db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}bump('cloud_sync');return {revision:payload.revision}}
let syncing=false;async function cloudSync(){if(CLOUD_MODE||!CLOUD_SYNC_URL||!SYNC_TOKEN||syncing)return;syncing=true;try{const rev=revision();const synced=Number(get("SELECT value FROM meta WHERE key='last_pushed_revision'")?.value||0);if(rev===synced)return;const url=CLOUD_SYNC_URL.replace(/\/$/,'')+'/api/sync/push';if(!/^https:\/\//.test(url)&&!/^http:\/\/localhost/.test(url))throw Error('CLOUD_SYNC_URL precisa usar HTTPS');const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+SYNC_TOKEN},body:JSON.stringify({hub:HUB_ID,revision:rev,tables:snapshotSync()}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Cloud sync: HTTP '+r.status);run("INSERT INTO meta(key,value) VALUES ('last_pushed_revision',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",String(rev));run("INSERT INTO meta(key,value) VALUES ('synced_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",now());}catch(e){console.error('Sync pendente:',e.message)}finally{syncing=false}}
function route(method,pathname,user,body,req,res){
if(pathname==='/api/auth/login'&&method==='POST'){const ip=req.socket.remoteAddress||'unknown';rateLimitLogin(ip);const u=get(`SELECT * FROM users WHERE username=? AND active=1`,String(body.username||'').trim().toLowerCase());if(!u||!verifyPassword(String(body.password||''),u.passhash)){rememberFailure(ip);throw bad(401,'Usuário ou senha inválidos')};failedLogins.delete(ip);if(!u.approved)throw bad(403,'Cadastro aguardando aprovação');if(u.role==='waiter')run('DELETE FROM sessions WHERE user_id=?',u.id);const token=crypto.randomBytes(32).toString('hex');run('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)',sha(token),u.id,Date.now()+14*24*3600*1000);write(res,200,{user:publicUser(u)},{'Set-Cookie':`fluxo_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=1209600${COOKIE_SECURE?'; Secure':''}`});return;}
if(pathname==='/api/auth/register'&&method==='POST'){if(CLOUD_MODE)throw bad(403,'Registre-se no terminal local');const role=body.role==='waiter'?'waiter':'waiter';const id=createUser(String(body.username||'').trim().toLowerCase(),String(body.display_name||''),role,String(body.password||''));audit(null,'registration_requested','user',id);bump('users');write(res,201,{ok:true,message:'Cadastro enviado à gerência para aprovação.'});return;}
if(pathname==='/api/auth/logout'&&method==='POST'){const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('fluxo_session='));if(cookie)run('DELETE FROM sessions WHERE token_hash=?',sha(cookie.slice(14)));write(res,200,{ok:true},{'Set-Cookie':'fluxo_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'});return;}
if(pathname==='/api/sync/push'&&method==='POST'){if(!SYNC_TOKEN||req.headers.authorization!=='Bearer '+SYNC_TOKEN)throw bad(401,'Token de sincronização inválido');write(res,200,applySync(body));return;}
if(!user)throw bad(401,'Entre no sistema');
if(pathname==='/api/state'&&method==='GET'){write(res,200,{...snapshot(user),stats:user.role==='manager'?insights():null});return;}
if(pathname==='/api/notices/read'&&method==='POST'){
 const id=Number(body.id);if(!Number.isSafeInteger(id))throw bad(400,'Aviso inválido');
 const n=get("SELECT id FROM notices WHERE id=? AND (audience=? OR audience='all')",id,user.role);
 if(!n)throw bad(404,'Aviso não encontrado');
 run('INSERT OR IGNORE INTO notice_reads(notice_id,user_id,read_at) VALUES (?,?,?)',id,user.id,now());
 bump('notices');write(res,200,{ok:true});return;}
if(pathname==='/api/events'&&method==='GET'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive'});res.write('event: connected\ndata: '+JSON.stringify({revision:revision()})+'\n\n');listeners.add(res);req.on('close',()=>listeners.delete(res));return;}
if(CLOUD_MODE)throw bad(403,'Nuvem disponível somente para consultas: operações devem ocorrer no terminal local');
if(pathname==='/api/shift/checkin-on-behalf'&&method==='POST'){
 requireRole(user,'manager');const target=Number(body.user_id);const waiter=get("SELECT id FROM users WHERE id=? AND role='waiter' AND active=1 AND approved=1",target);
 if(!waiter)throw bad(404,'Garçom não encontrado ou não aprovado');let shift=activeShift(target);
 if(!shift){const r=run("INSERT INTO shifts(user_id,start_at,availability,warning) VALUES (?,?,'pending','no_device')",target,now());shift=get('SELECT * FROM shifts WHERE id=?',Number(r.lastInsertRowid));audit(user.id,'checkin_on_behalf','shift',shift.id,{no_device:true});bump('shifts');}
 write(res,200,{shift});return;}
if(pathname==='/api/shift/checkin'&&method==='POST'){requireRole(user,'waiter');let shift=activeShift(user.id);if(!shift){let r=run("INSERT INTO shifts(user_id,start_at,availability) VALUES (?,?, 'pending')",user.id,now());shift=get('SELECT * FROM shifts WHERE id=?',Number(r.lastInsertRowid));audit(user.id,'checked_in','shift',shift.id);bump('shifts')}write(res,200,{shift});return;}
if(pathname==='/api/shift/confirm'&&method==='POST'){requireRole(user,'kitchen','manager');const shift=get('SELECT * FROM shifts WHERE id=? AND end_at IS NULL',Number(body.shift_id));if(!shift)throw bad(404,'Turno não encontrado');run("UPDATE shifts SET confirmed_at=?,confirmed_by=?,availability=? WHERE id=?",now(),user.id,shift.warning==='no_device'?'no_device':'available',shift.id);audit(user.id,'presence_confirmed','shift',shift.id);bump('shifts');write(res,200,{ok:true});return;}
if(pathname==='/api/shift/availability'&&method==='POST'){requireRole(user,'waiter','manager','kitchen');const targetId=user.role==='waiter'?user.id:Number(body.user_id);const shift=activeShift(targetId);if(!shift||!shift.confirmed_at)throw bad(409,'Presença ainda não confirmada');if(!['available','busy','break','no_device'].includes(body.availability))throw bad(400,'Estado inválido');run('UPDATE shifts SET availability=? WHERE id=?',body.availability,shift.id);
if(body.availability!=='available'){
 const pending=all("SELECT id,order_id FROM dispatches WHERE waiter_id=? AND status='pending'",targetId);
 for(const d of pending){run("UPDATE dispatches SET status='expired' WHERE id=?",d.id);
 const excluded=all('SELECT waiter_id FROM dispatches WHERE order_id=? AND waiter_id IS NOT NULL',d.order_id).map(x=>x.waiter_id);assign(d.order_id,excluded);}
}
audit(user.id,'availability_changed','shift',shift.id,{availability:body.availability});bump('shifts');write(res,200,{ok:true});return;}
if(pathname==='/api/shift/checkout'&&method==='POST'){requireRole(user,'waiter','manager');const targetId=user.role==='waiter'?user.id:Number(body.user_id);const shift=activeShift(targetId);if(!shift)throw bad(404,'Turno inexistente');run("UPDATE shifts SET end_at=?,availability='off' WHERE id=?",now(),shift.id);audit(user.id,'checked_out','shift',shift.id);bump('shifts');write(res,200,{ok:true});return;}
if(pathname==='/api/device/pulse'&&method==='POST'){requireRole(user,'waiter','kitchen','cashier','manager');const shift=activeShift(user.id);if(shift){const bat=Number.isInteger(body.battery)&&body.battery>=0&&body.battery<=100?body.battery:null;run('UPDATE shifts SET last_seen=?,last_battery=COALESCE(?,last_battery),device_id=? WHERE id=?',now(),bat,String(body.device_id||'').slice(0,100),shift.id);if(bat!==null&&bat<=20&&(!shift.last_battery||shift.last_battery>20))bump('low_battery')}write(res,200,{ok:true});return;}
if(pathname==='/api/users'&&method==='POST'){requireRole(user,'manager');const id=createUser(String(body.username||'').trim().toLowerCase(),String(body.display_name||''),String(body.role||''),String(body.password||''),1);audit(user.id,'user_created','user',id);bump('users');write(res,201,{id});return;}
if(pathname==='/api/users/approve'&&method==='POST'){requireRole(user,'manager');const target=get('SELECT id FROM users WHERE id=?',Number(body.user_id));if(!target)throw bad(404,'Usuário inexistente');run('UPDATE users SET approved=1 WHERE id=?',target.id);audit(user.id,'user_approved','user',target.id);bump('users');write(res,200,{ok:true});return;}
if(pathname==='/api/products'&&method==='POST'){requireRole(user,'manager');let price=Number(body.price_cents);if(!Number.isSafeInteger(price)||price<0)throw bad(400,'Preço inválido');let r=run('INSERT INTO products(name,category,price_cents) VALUES (?,?,?)',String(body.name||'').trim().slice(0,80),String(body.category||'Outros').trim().slice(0,40),price);audit(user.id,'product_created','product',r.lastInsertRowid);bump('products');write(res,201,{id:Number(r.lastInsertRowid)});return;}
if(pathname==='/api/products/availability'&&method==='POST'){requireRole(user,'kitchen','manager');const p=get('SELECT * FROM products WHERE id=?',Number(body.id));if(!p)throw bad(404,'Produto não encontrado');const available=body.available===true?1:body.available===false?0:null;if(available===null)throw bad(400,'Disponibilidade inválida');run('UPDATE products SET available=? WHERE id=?',available,p.id);audit(user.id,'product_availability','product',p.id,{available});notice('all',available?'Produto disponível':'Produto indisponível',p.name+(available?' voltou ao cardápio.':' foi retirado temporariamente do cardápio.'));bump('products');write(res,200,{ok:true});return;}
if(pathname==='/api/orders'&&method==='POST'){requireRole(user,'waiter','cashier','manager');const waiterId=user.role==='waiter'?user.id:Number(body.waiter_id);const waiter=get("SELECT id FROM users WHERE id=? AND role='waiter' AND active=1",waiterId);const shift=activeShift(waiterId);if(!waiter||!shift||!shift.confirmed_at)throw bad(409,'Garçom não confirmado em serviço');const table=String(body.table_no||'').trim();if(!/^[\w\- ]{1,15}$/.test(table))throw bad(400,'Informe uma mesa válida');if(!Array.isArray(body.items)||!body.items.length||body.items.length>50)throw bad(400,'Pedido sem itens');
const requestId=String(body.client_request_id||'');
if(!/^[0-9a-fA-F-]{36}$/.test(requestId))throw bad(400,'Identificador do pedido inválido');
const previous=get('SELECT order_id,user_id FROM order_requests WHERE request_id=?',requestId);
if(previous){if(previous.user_id!==user.id)throw bad(409,'Identificador já utilizado');write(res,200,{id:previous.order_id,duplicate:true});return;}
db.exec('BEGIN IMMEDIATE');try{const validated=body.items.map(item=>{const p=get('SELECT * FROM products WHERE id=?',Number(item.product_id));if(!p||!p.available||!p.active)throw bad(409,`Produto indisponível: ${p?.name||item.product_id}`);const q=Number(item.quantity);if(!Number.isInteger(q)||q<1||q>99)throw bad(400,'Quantidade inválida');return {p,q,notes:String(item.notes||'').slice(0,160)}});const r=run('INSERT INTO orders(table_no,waiter_id,operator_id,created_at,notes) VALUES (?,?,?,?,?)',table,waiterId,user.id,now(),String(body.notes||'').slice(0,500));for(const item of validated)run('INSERT INTO order_items(order_id,product_id,product_name,quantity,price_cents,notes) VALUES (?,?,?,?,?,?)',Number(r.lastInsertRowid),item.p.id,item.p.name,item.q,item.p.price_cents,item.notes);run('INSERT INTO order_requests(request_id,user_id,order_id) VALUES (?,?,?)',requestId,user.id,Number(r.lastInsertRowid));audit(user.id,'order_created','order',r.lastInsertRowid,{waiter_id:waiterId,table_no:table});db.exec('COMMIT');bump('orders');write(res,201,{id:Number(r.lastInsertRowid)});return;}catch(e){db.exec('ROLLBACK');throw e}}
if(pathname==='/api/orders/status'&&method==='POST'){requireRole(user,'kitchen','manager','waiter','cashier');const order=get('SELECT * FROM orders WHERE id=?',Number(body.id));if(!order)throw bad(404,'Pedido inexistente');const status=String(body.status);const allowed={new:['preparing','cancelled'],preparing:['ready','cancelled'],ready:['delivered'],delivered:[],cancelled:[]};if(!allowed[order.status]?.includes(status))throw bad(409,'Transição de estado inválida');if(['preparing','ready'].includes(status))requireRole(user,'kitchen','manager');if(status==='delivered')requireRole(user,'waiter','cashier','manager','kitchen');if(status==='cancelled')requireRole(user,'manager','kitchen');if(status==='delivered'){const pending=get("SELECT * FROM dispatches WHERE order_id=? AND status IN ('pending','acknowledged') ORDER BY id DESC LIMIT 1",order.id);if(pending?.waiter_id&&user.role==='waiter'&&pending.waiter_id!==user.id)throw bad(403,'Esta retirada foi atribuída a outro garçom');run("UPDATE dispatches SET status='completed',completed_at=? WHERE order_id=? AND status IN ('pending','acknowledged')",now(),order.id)}
let when=status==='preparing'?'started_at':status==='ready'?'ready_at':status==='delivered'?'delivered_at':null;run(`UPDATE orders SET status=?${when?`,${when}=?`:''} WHERE id=?`,...(when?[status,now(),order.id]:[status,order.id]));audit(user.id,'order_status','order',order.id,{from:order.status,to:status});if(status==='ready')assign(order.id);bump('orders');write(res,200,{ok:true});return;}
if(pathname==='/api/dispatch/ack'&&method==='POST'){requireRole(user,'waiter','cashier','manager','kitchen');const d=get('SELECT * FROM dispatches WHERE id=?',Number(body.id));if(!d||d.status!=='pending')throw bad(409,'Chamada não está pendente');if(d.waiter_id&&user.role==='waiter'&&d.waiter_id!==user.id)throw bad(403,'Chamada de outro garçom');if(d.central&&user.role==='waiter')throw bad(403,'Chamada atribuída ao terminal central');run("UPDATE dispatches SET ack_at=?,status='acknowledged' WHERE id=?",now(),d.id);audit(user.id,'dispatch_ack','dispatch',d.id);bump('dispatch');write(res,200,{ok:true});return;}
throw bad(404,'Rota não encontrada');}
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
const server=http.createServer(async(req,res)=>{let url;try{
 if(req.method==='POST'&&req.headers.origin){let origin;try{origin=new URL(req.headers.origin)}catch{throw bad(403,'Origem inválida')}if(origin.host!==req.headers.host)throw bad(403,'Origem não autorizada');}
 url=new URL(req.url,'http://localhost');if(url.pathname.startsWith('/api/')){const user=auth(req);const body=req.method==='POST'?obj(await readBody(req)):{};return route(req.method,url.pathname,user,body,req,res)}const file=url.pathname==='/'?'index.html':url.pathname.replace(/^\//,'');const full=path.resolve(ROOT,'public',file);if(!full.startsWith(path.join(ROOT,'public')+path.sep)&&full!==path.join(ROOT,'public','index.html'))throw bad(404,'Arquivo não encontrado');if(!fs.existsSync(full)||!fs.statSync(full).isFile())throw bad(404,'Arquivo não encontrado');res.writeHead(200,{'Content-Type':mime[path.extname(full)]||'application/octet-stream','Cache-Control':'no-cache'});fs.createReadStream(full).pipe(res)}catch(e){console.error(e.status||500,e.message);if(!res.headersSent)write(res,e.status||500,{error:e.message&&e.status?e.message:'Erro interno'});else res.end()}});
if(process.env.NODE_ENV!=='test'){server.listen(PORT,'0.0.0.0',()=>{console.log(`Sistema de Restaurantes (${CLOUD_MODE?'nuvem':'local'}) em http://localhost:${PORT}`);if(!CLOUD_MODE)for(const list of Object.values(os.networkInterfaces()))for(const net of list||[])if(net.family==='IPv4'&&!net.internal)console.log(`Acesso pela rede Wi-Fi/LAN: http://${net.address}:${PORT}`)});setInterval(tickDispatch,8000).unref();setInterval(cloudSync,20000).unref();}
export {server,db,bump,insights,cloudSync};
