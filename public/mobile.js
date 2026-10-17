/* Interface mobile aprovada: utiliza as mesmas APIs e permissões do sistema. */
let mobileKitchenFilter='all';
let mobileCatalogFull=false;
const mobileMedia=()=>matchMedia('(max-width:760px)').matches;
const mobileStatus={new:'Pedido novo',preparing:'Em preparo',ready:'Pronto para retirar',delivered:'Entregue',cancelled:'Cancelado'};
const mobileSymbols={
 home:'<path d="M3 11 12 4l9 7v10H3zM9 21v-7h6v7"/>',
 order:'<path d="M12 5v14M5 12h14"/>',
 bell:'<path d="M18 8a6 6 0 0 0-12 0c0 8-3 8-3 10h18c0-2-3-2-3-10M10 22h4"/>',
 list:'<path d="M7 5h14M7 12h14M7 19h14M3 5h1M3 12h1M3 19h1"/>',
 tiles:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
 users:'<circle cx="9" cy="7" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5v1"/>',
 chart:'<path d="M4 20V12M10 20V6M16 20v-8M22 20V3"/>'
};
function mobileIcon(name){return '<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+mobileSymbols[name]+'</svg>'}
function mobileTabs(){
 if(me.role==='waiter')return [['home','Turno','home'],['orders','Pedido','order'],['notices','Avisos','bell']];
 if(me.role==='kitchen')return [['home','Fila','list'],['products','Itens','tiles'],['team','Equipe','users']];
 if(me.role==='cashier')return [['home','Chamados','bell'],['orders','Pedido','order'],['history','Comandas','list']];
 return [['home','Visão','home'],['team','Equipe','users'],['insights','Análises','chart']];
}
function mobileExtra(){
 if(me.role==='manager')return [['orders','Novo pedido'],['products','Cardápio'],['notices','Avisos']];
 if(me.role==='kitchen')return [['notices','Avisos'],['history','Histórico']];
 if(me.role==='cashier')return [['team','Equipe'],['notices','Avisos']];
 return [['history','Meus pedidos'],['team','Equipe']];
}
function mobileLayout(){
 const mode=state?.server_mode==='cloud'?'Nuvem':'Rede local';
 const role=roleName[me.role]||'Operação';
 const profiles=demoProfiles||[];
 const activeProfile=profiles.find(p=>p.username===me.username);
 const options=profiles.length?'<select aria-label="Trocar perfil de demonstração" class="m-profile" id="mobile-profile"><option value="">Perfil</option>'+profiles.map(p=>'<option value="'+e(p.profile)+'" '+(activeProfile?.profile===p.profile?'selected':'')+'>'+e(p.label)+'</option>').join('')+'</select>':'<span class="m-profile-static">'+e(me.display_name)+'</span>';
 const extras=mobileExtra().map(([id,label])=>'<button data-tab="'+id+'">'+e(label)+'</button>').join('');
 const nav=mobileTabs().map(([id,label,icon])=>'<button class="m-tab '+(screen===id?'active':'')+'" data-tab="'+id+'" aria-current="'+(screen===id?'page':'false')+'">'+mobileIcon(icon)+'<span>'+label+(id==='notices'&&state.unread_notices?' ('+state.unread_notices+')':'')+'</span></button>').join('');
 const notice=state?.server_mode==='cloud'?'<div class="m-offline">Visão remota somente leitura · última sincronização '+e(fmtDate(state.synced_at))+'</div>':'';
 app.innerHTML='<div class="m-shell"><header class="m-header"><div class="m-identity"><span class="m-micro">OPERAÇÃO · '+mode.toUpperCase()+'</span><strong>'+e(role)+'</strong></div><div class="m-head-actions">'+options+'<details class="m-more"><summary aria-label="Mais opções">⋯</summary><div class="m-more-menu">'+extras+'<button data-act="logout">Sair da conta</button></div></details></div></header><main class="m-page">'+notice+mobileContent()+'</main><nav class="m-bottom" aria-label="Navegação principal">'+nav+'</nav></div>';
}
function mobileContent(){
 if(screen==='home')return me.role==='waiter'?mobileWaiter():me.role==='kitchen'?mobileKitchen():me.role==='cashier'?mobileCashier():mobileManager();
 if(screen==='orders')return mobileOrder();
 return '<div class="m-secondary">'+content()+'</div>';
}
function mobileIntro(over,title,lead){
 return '<div class="m-intro"><span class="m-eyebrow">'+e(over)+'</span><h1>'+e(title)+'</h1><p>'+e(lead)+'</p></div>';
}
function mobileMetric(value,label){return '<div class="m-metric"><b>'+e(value)+'</b><span>'+e(label)+'</span></div>'}
function mobileOrderRow(o,view){
 const color=o.status==='ready'?'green':o.status==='new'?'amber':'';
 const items=(o.items||[]).map(x=>x.quantity+' × '+e(x.product_name)+(x.notes?' ('+e(x.notes)+')':'')).join(' · ');
 const info=view==='kitchen'?'Há '+mins(o.created_at)+' · '+e(o.waiter_name):view==='cashier'?e(o.waiter_name)+' · '+mins(o.created_at):e(mobileStatus[o.status]||o.status);
 let action='';
 if(canOperate()){
   if(view==='kitchen'&&o.status==='new')action=btn('Preparar','status:'+o.id+':preparing','m-action');
   else if(view==='kitchen'&&o.status==='preparing')action=btn('Pronto ✓','status:'+o.id+':ready','m-action light');
   else if(view==='waiter'&&o.status==='ready'&&(!state.dispatches.some(d=>d.order_id===o.id&&d.waiter_id===me.id&&d.status==='pending')))action=btn('Entregue ✓','status:'+o.id+':delivered','m-action light');
   else if(view==='cashier'&&o.status==='ready')action=btn('Entregue ✓','status:'+o.id+':delivered','m-action light');
 }
 return '<div class="m-oper"><span class="m-ordid '+color+'">'+e(o.table_no)+'</span><div class="m-grow"><strong>Mesa '+e(o.table_no)+' · '+e(mobileStatus[o.status]||o.status)+'</strong><p>'+items+'</p><small>'+info+'</small></div>'+action+'</div>';
}
function mobileWaiter(){
 const s=currentShift(), orders=state.orders.filter(o=>o.waiter_id===me.id),active=orders.filter(o=>!['delivered','cancelled'].includes(o.status)),pending=state.dispatches.filter(d=>d.waiter_id===me.id&&d.status==='pending');
 const greeting=(me.display_name||'').split(' ')[0];
 if(!s)return mobileIntro('MEU TURNO','Bom trabalho, '+greeting+'.','Registre sua chegada para começar.')+'<div class="m-surface"><strong>Seu turno ainda não começou</strong><p>A cozinha ou a gerência confirmará sua chegada.</p></div>'+btn('Cheguei · Iniciar turno','checkin','primary big block');
 if(!s.confirmed_at)return mobileIntro('MEU TURNO','Chegada registrada.','Aguardando confirmação da cozinha ou gerência.')+'<div class="m-surface"><strong>Recebido às '+clock(s.start_at)+'</strong><p>Você poderá registrar pedidos após a confirmação.</p></div>';
 const av={available:'Disponível',busy:'Ocupado',break:'Em pausa',no_device:'Sem aparelho'};
 let html=mobileIntro('TURNO ATIVO','Bom trabalho, '+greeting+'.','Sua presença está confirmada. Tudo pronto para atender.');
 html+='<div class="m-surface m-availability"><div><strong>'+e(av[s.availability]||'Em serviço')+' para retiradas</strong><p>Presença confirmada</p></div><details class="m-avail-settings"><summary>'+e(av[s.availability]||'Status')+' ▾</summary><div class="m-avail-list"><button data-avail="available">Disponível</button><button data-avail="busy">Ocupado</button><button data-avail="break">Pausa</button></div></details></div>';
 html+='<div class="m-section"><strong>Agora</strong><small>Atualizado em tempo real</small></div><div class="m-metrics">'+mobileMetric(active.length,'Pedidos em andamento')+mobileMetric(pending.length,'Retiradas pendentes')+mobileMetric(orders.length,'Pedidos do turno')+'</div>';
 html+=btn('＋ Novo pedido','go:orders','primary big block m-new-order');
 html+='<div class="m-section"><strong>Precisa de você</strong>'+(pending.length?'<span class="m-tag amber">'+pending.length+' chamado(s)</span>':'<small>Nenhum chamado</small>')+'</div><section class="m-operations">';
 pending.forEach(d=>{const o=orders.find(o=>o.id===d.order_id);html+='<div class="m-oper"><span class="m-ordid amber">'+e(d.table_no)+'</span><div class="m-grow"><strong>Mesa '+e(d.table_no)+' · Pronto para retirar</strong><p>'+((o?.items||[]).map(x=>x.quantity+' × '+e(x.product_name)).join(' · ')||'Pedido liberado')+'</p><small>Aguardando confirmação</small></div>'+btn('Vou buscar','ack:'+d.id,'m-action')+'</div>'});
 active.filter(o=>!pending.some(d=>d.order_id===o.id)).forEach(o=>{html+=mobileOrderRow(o,'waiter')});
 html+=pending.length||active.length?'':'<div class="m-empty">Nenhuma retirada ou pedido pendente.</div>';
 return html+'</section>';
}
function mobileKitchen(){
 const active=state.orders.filter(o=>['new','preparing','ready'].includes(o.status)).sort((a,b)=>a.id-b.id),pending=state.shifts.filter(s=>!s.confirmed_at&&s.role==='waiter');
 let html=mobileIntro('COZINHA · AO VIVO','Fila de pedidos','Organizada por chegada. Um toque para avançar.');
 html+='<div class="m-metrics">'+mobileMetric(active.filter(o=>o.status==='new').length,'Novos pedidos')+mobileMetric(active.filter(o=>o.status==='preparing').length,'Em preparo')+mobileMetric(active.filter(o=>o.status==='ready').length,'Prontos')+'</div>';
 if(pending.length)html+='<div class="m-surface"><strong>Confirmar chegada</strong>'+pending.map(s=>'<div class="m-presence"><span>'+e(s.display_name)+'</span>'+btn('Confirmar','confirm:'+s.id,'m-action')+'</div>').join('')+'</div>';
 html+='<div class="m-filter">'+[['all','Todos'],['new','Novos'],['preparing','Preparo'],['ready','Prontos']].map(([k,t])=>'<button class="'+(mobileKitchenFilter===k?'active':'')+'" data-kitchen-filter="'+k+'">'+t+'</button>').join('')+'</div><section class="m-operations">';
 const selected=active.filter(o=>mobileKitchenFilter==='all'||o.status===mobileKitchenFilter);
 return html+(selected.map(o=>mobileOrderRow(o,'kitchen')).join('')||'<div class="m-empty">Nenhum pedido nesta fila.</div>')+'</section>';
}
function mobileCashier(){
 const active=state.orders.filter(o=>['new','preparing','ready'].includes(o.status));
 const dispatches=state.dispatches.filter(d=>['pending','acknowledged'].includes(d.status)&&active.some(o=>o.id===d.order_id))
 .filter(d=>d.central||state.shifts.find(s=>s.user_id===d.waiter_id)?.availability==='no_device');
 let html=mobileIntro('CAIXA · CENTRAL DE APOIO','Chamados e pedidos','Acompanhe retiradas e atenda garçons sem celular.');
 html+='<div class="m-surface m-availability"><div><strong>'+(dispatches.length?'Chamados aguardando':'Nenhum chamado pendente')+'</strong><p>'+(dispatches.length?'Atenção para as retiradas':'Caixa atualizado')+'</p></div><span class="m-tag '+(dispatches.length?'amber':'')+'">'+dispatches.length+' pendente(s)</span></div>';
 html+=btn('＋ Registrar pedido','go:orders','primary big block m-new-order');
 html+='<div class="m-section"><strong>Avisar presencialmente</strong><small>Prioridade</small></div><section class="m-operations">';
 dispatches.forEach(d=>{const o=active.find(o=>o.id===d.order_id);html+='<div class="m-oper"><span class="m-ordid amber">'+e(d.table_no)+'</span><div class="m-grow"><strong>'+e(o?.waiter_name||'Garçom')+' · Mesa '+e(d.table_no)+'</strong><p>Pedido pronto para retirar</p><small>Terminal de contingência</small></div>'+(d.status==='pending'?btn('Avisei','ack:'+d.id,'m-action'):'<span class="m-tag">Avisado</span>')+'</div>'});
 html+=dispatches.length?'':'<div class="m-empty">Sem avisos pendentes.</div>';
 html+='</section><div class="m-section"><strong>Pedidos em andamento</strong><small>Todos os garçons</small></div><section class="m-operations">'+(active.map(o=>mobileOrderRow(o,'cashier')).join('')||'<div class="m-empty">Sem pedidos em andamento.</div>')+'</section>';
 return html;
}
function mobileManager(){
 const s=state.stats||{},notes=s.notes||[],popular=s.popular||[];
 let html=mobileIntro('GERÊNCIA · HOJE','Como está a operação?','Indicadores para decidir, sem ruído.');
 html+='<div class="m-stats">'+mobileMetric(s.count_today??0,'Pedidos · 24 horas')+mobileMetric(s.mean_prep_minutes==null?'—':s.mean_prep_minutes+' min','Preparo médio')+mobileMetric(s.waiting??0,'Em produção')+mobileMetric(s.ready??0,'Aguardando retirada')+'</div>';
 html+='<div class="m-section"><strong>O que merece atenção</strong><span class="m-tag amber">'+notes.length+' alertas</span></div>';
 html+=notes.length?notes.slice(0,3).map(n=>'<div class="m-analysis"><strong>'+e(n.title)+'</strong><p>'+e(n.detail)+'</p></div>').join(''):'<div class="m-empty">Sem alertas relevantes agora.</div>';
 html+='<div class="m-section"><strong>Produtos mais pedidos</strong><button data-tab="insights" class="m-textbutton">Ver análises</button></div>';
 const max=Math.max(1,...popular.slice(0,5).map(p=>p.qty));
 html+=popular.slice(0,5).map(p=>'<div class="m-graph"><span>'+e(p.name)+'</span><div class="m-graph-track"><i style="width:'+Math.round(p.qty/max*100)+'%"></i></div><b>'+p.qty+'</b></div>').join('')||'<div class="m-empty">Ainda não há vendas registradas.</div>';
 return html;
}
function mobileOrder(){
 const shift=me.role==='waiter'?currentShift():null,waiters=state.shifts.filter(s=>s.role==='waiter'&&s.confirmed_at);
 if(me.role==='waiter'&&(!shift||!shift.confirmed_at))return mobileIntro('GARÇOM','Novo pedido','A cozinha precisa confirmar sua chegada antes de enviar pedidos.');
 const available=state.products.filter(p=>p.active);
 const categories=['Todos',...new Set(available.map(p=>p.category))];
 const shown=available.filter(p=>(category==='Todos'||p.category===category)&&p.name.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>b.sales_count-a.sales_count);
 const filtered=mobileCatalogFull||search||category!=='Todos'?shown:shown.slice(0,5);
 const n=Object.values(cart).reduce((v,c)=>v+c,0),total=state.products.reduce((a,p)=>a+(cart[p.id]||0)*p.price_cents,0);
 const waiterSelect=me.role==='waiter'?'':'<div class="m-field"><label for="waiter-select">Garçom responsável</label><select id="waiter-select"><option value="">Selecione o garçom</option>'+waiters.map(s=>'<option value="'+s.user_id+'" '+(String(checkoutWaiter)===String(s.user_id)?'selected':'')+'>'+e(s.display_name)+'</option>').join('')+'</select></div>';
 const lines=Object.keys(cart).filter(k=>cart[k]>0).map(k=>{const p=state.products.find(p=>String(p.id)===k);return '<div class="m-cart-line"><strong>'+e(p?.name||k)+'</strong><span class="m-qty"><button aria-label="Diminuir '+e(p?.name||k)+'" data-minus="'+k+'">−</button>'+cart[k]+'<button aria-label="Aumentar '+e(p?.name||k)+'" data-product="'+k+'">+</button></span><input class="search" data-note="'+k+'" value="'+e(productNotes[k]||'')+'" placeholder="Observações do item (opcional)"></div>'}).join('');
 let html=mobileIntro('NOVO PEDIDO','Novo pedido','Encontre os itens e envie para a cozinha.');
 html+='<div class="m-order-fields">'+waiterSelect+'<div class="m-field"><label for="table-input">Mesa / comanda</label><input id="table-input" value="'+e(tableNo)+'" placeholder="Ex.: 04" maxlength="15"></div></div>';
 html+='<div class="m-search"><label for="search-products" class="sr-only">Buscar produto</label><input id="search-products" class="search" value="'+e(search)+'" placeholder="⌕  Buscar produto..."></div>';
 html+='<div class="m-filter m-categories">'+categories.map(c=>'<button data-cat="'+e(c)+'" class="'+(category===c?'active':'')+'">'+e(c==='Todos'&&!mobileCatalogFull?'Favoritos':c)+'</button>').join('')+'</div>';
 html+='<div class="m-section"><strong>'+((search||mobileCatalogFull||category!=='Todos')?'Cardápio':'Mais pedidos')+'</strong>'+(mobileCatalogFull?'':'<button data-mobile-full="true" class="m-textbutton">Cardápio completo ↗</button>')+'</div>';
 html+='<section class="m-operations m-product-list">'+(filtered.map(p=>'<div class="m-product '+(p.available?'':'unavailable')+'"><div><strong>'+e(p.name)+'</strong><small>'+(p.available?money(p.price_cents):'Indisponível')+'</small></div><div class="m-item-counter">'+(cart[p.id]?'<button data-minus="'+p.id+'" aria-label="Remover um '+e(p.name)+'">−</button><b>'+cart[p.id]+'</b>':'')+'<button data-product="'+p.id+'" '+(!p.available?'disabled':'')+' aria-label="Adicionar '+e(p.name)+'">+</button></div></div>').join('')||'<div class="m-empty">Nenhum produto encontrado.</div>')+'</section>';
 html+='<details class="m-cart-details"><summary>Revisar pedido e observações ('+n+' itens)</summary><div>'+ (lines||'<p>Adicione produtos para montar o pedido.</p>')+'<div class="m-field"><label for="order-notes">Observações gerais</label><textarea id="order-notes" placeholder="Opcional">'+e(orderNotes)+'</textarea></div></div></details>';
 html+='<div class="m-checkout"><div><strong>'+n+' itens · '+(tableNo?'Mesa '+e(tableNo):'Informe a mesa')+'</strong><small>Total estimado '+money(total)+'</small></div><button data-act="send-order" '+(!n||!canOperate()?'disabled':'')+'>Enviar à cozinha →</button></div>';
 return html;
}
