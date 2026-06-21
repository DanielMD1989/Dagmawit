/* ============================================================
   ATELIER — cloud-synced app logic
   Data is stored in Supabase (one shared row of JSON), so you
   and your partner see the same live data on every device.
   ============================================================ */

/* ---------- Supabase init ---------- */
const CFG = window.ATELIER_CONFIG || {};
let sb = null, configError = '';
if(!CFG.SUPABASE_URL || CFG.SUPABASE_URL.indexOf('PASTE')===0){
  configError = 'Not configured yet. Open config.js and paste your Supabase URL and key.';
}else{
  try{ sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY); }
  catch(e){ configError = 'Could not connect to Supabase: '+e.message; }
}

/* ---------- shared state ---------- */
let mem = {orders:[], expenses:[], loans:[], rolls:[], events:[], customers:[], settings:{currency:'Birr'}};
let SHARED_ID = 'shared';   // single shared business document
let saveTimer = null, realtimeChan = null, applyingRemote = false;

const $ = id => document.getElementById(id);
let hideMoney=false;
try{hideMoney=localStorage.getItem('dagmawit:hideMoney')==='1';}catch(e){}
const MASK='•••••';
const money=n=>hideMoney?(CUR()+' '+MASK):(CUR()+' '+Math.round(n).toLocaleString());
const CUR=()=>mem.settings.currency||'Birr';
const FCUR=()=>mem.settings.fcurrency||'USD';
const fmoney=(n,cur)=>hideMoney?(cur+' '+MASK):(cur+' '+Math.round(n).toLocaleString());
const uid=()=>Date.now()+''+Math.floor(Math.random()*999);
const today=()=>new Date().toISOString().slice(0,10);
function toast(m){const t=$('toast');t.innerHTML=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1900);}
function savedTick(label){
  let tick=$('savedTick');
  if(!tick){tick=document.createElement('div');tick.id='savedTick';tick.className='savedtick';document.body.appendChild(tick);}
  tick.innerHTML='<div class="tickcircle"><svg viewBox="0 0 52 52"><circle class="tickc" cx="26" cy="26" r="24" fill="none"/><path class="tickm" fill="none" d="M14 27 L22 35 L38 18"/></svg></div><div class="ticklabel">'+(label||'Saved')+'</div>';
  tick.classList.remove('show');void tick.offsetWidth;tick.classList.add('show');
  setTimeout(()=>tick.classList.remove('show'),1300);
}
function esc(s){return(s||'').replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));}
function setSync(state){const p=$('syncPill');if(!p)return;if(state==='saving'){p.textContent='Saving…';p.className='syncpill saving';}else if(state==='off'){p.textContent='Offline';p.className='syncpill off';}else{p.textContent='Synced';p.className='syncpill';}}

/* ---------- offline-first load / save ---------- */
const LS_KEY='dagmawit:data';
const LS_DIRTY='dagmawit:dirty';
function saveLocal(){try{localStorage.setItem(LS_KEY,JSON.stringify(mem));}catch(e){}}
function loadLocal(){try{const r=localStorage.getItem(LS_KEY);if(r)return normalize(JSON.parse(r));}catch(e){}return null;}
function markDirty(v){try{localStorage.setItem(LS_DIRTY,v?'1':'0');}catch(e){}}
function isDirty(){try{return localStorage.getItem(LS_DIRTY)==='1';}catch(e){return false;}}

async function cloudLoad(){
  // show local data instantly if present
  const local=loadLocal();
  if(local){mem=local;}
  if(!navigator.onLine){setSync('off');return true;}
  try{
    const {data,error} = await sb.from('business_data').select('content,updated_at').eq('id',SHARED_ID).maybeSingle();
    if(error){console.error(error);setSync('off');return true;}
    if(data && data.content){
      // if we have unsynced local edits, keep local and push; else take cloud
      if(isDirty()){ await pushNow(); }
      else { mem = normalize(data.content); saveLocal(); }
    } else {
      await sb.from('business_data').insert({id:SHARED_ID, content:mem});
      saveLocal();
    }
    setSync('synced');
  }catch(e){console.error(e);setSync('off');}
  return true;
}
function normalize(d){
  d=d||{};d.orders=d.orders||[];d.expenses=d.expenses||[];d.loans=d.loans||[];d.rolls=d.rolls||[];d.events=d.events||[];d.customers=d.customers||[];d.settings=d.settings||{currency:'Birr'};return d;
}
async function pushNow(){
  try{
    const {error}=await sb.from('business_data').update({content:mem, updated_at:new Date().toISOString()}).eq('id',SHARED_ID);
    if(error){throw error;}
    markDirty(false);setSync('synced');return true;
  }catch(e){console.error(e);setSync('off');return false;}
}
async function save(){
  if(applyingRemote) return;          // don't echo remote changes back
  saveLocal();                        // 1) instant local save (works offline)
  markDirty(true);
  if(!navigator.onLine){setSync('off');return;}
  setSync('saving');
  if(saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async()=>{ await pushNow(); }, 500);
}
// when connection returns, push any pending local changes
window.addEventListener('online', async()=>{ setSync('saving'); if(isDirty()){await pushNow();} else {setSync('synced');} });
window.addEventListener('offline', ()=>{ setSync('off'); });
function subscribeRealtime(){
  if(realtimeChan) sb.removeChannel(realtimeChan);
  realtimeChan = sb.channel('biz')
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'business_data',filter:'id=eq.'+SHARED_ID},payload=>{
      if(payload.new && payload.new.content){
        applyingRemote=true;
        mem = normalize(payload.new.content);
        saveLocal(); markDirty(false);
        render();
        applyingRemote=false;
        setSync('synced');
      } else {
        // payload arrived without content (replica identity) -> pull fresh
        refreshFromCloud();
      }
    }).subscribe();
}
async function refreshFromCloud(){
  if(!navigator.onLine) return;
  try{
    const {data,error}=await sb.from('business_data').select('content').eq('id',SHARED_ID).maybeSingle();
    if(!error && data && data.content && !isDirty()){
      applyingRemote=true; mem=normalize(data.content); saveLocal(); render(); applyingRemote=false; setSync('synced');
    }
  }catch(e){setSync('off');}
}
// when the app comes back to the foreground, reconnect realtime and pull latest
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'){
    subscribeRealtime();
    refreshFromCloud();
  }
});
window.addEventListener('focus',()=>{ refreshFromCloud(); });
// periodic safety net: pull latest every 25s while app is open & visible
setInterval(()=>{ if(document.visibilityState==='visible' && navigator.onLine && !isDirty()) refreshFromCloud(); }, 25000);

/* ============================================================
   DOMAIN LOGIC (same as the offline app)
   ============================================================ */
const orderRemaining=o=>Math.max(0,o.total-o.paid);
const orderStatus=o=>o.paid>=o.total?'paid':(o.paid>0?'partial':'unpaid');
const loanRepaid=l=>Math.max(0,l.total-l.balance);
const bagRate=()=>+mem.settings.bagRate||0;
const MFIELDS=[['bust','Bust'],['waist','Waist'],['backShoulder','Back shoulder'],['halfShoulder','Half shoulder'],['shoulderToBust','Shoulder to bust'],['shoulderToWaist','Shoulder to waist'],['hip','Hip'],['sleeve','Sleeve'],['sleeveCup','Sleeve cup'],['skirtLength','Skirt length'],['coatLength','Coat length'],['height','Height']];
function expenseShareForOrder(e,orderId){if(e.rollId)return 0;if(!e.orderIds||!e.orderIds.length)return 0;if(e.orderIds.indexOf(orderId)<0)return 0;return e.amount/e.orderIds.length;}
function orderCost(orderId){let c=0;mem.expenses.forEach(e=>{c+=expenseShareForOrder(e,orderId);});const o=mem.orders.find(x=>x.id===orderId);if(o&&o.bagCost)c+=o.bagCost;return c;}
function orderProfit(o){return o.total-orderCost(o.id);}

function isForeign(o){return o.currency&&o.currency==='foreign';}
function incomeDateOf(o){
  // on-delivery orders: income lands on the delivery day; otherwise on creation day
  if((o.payType==='On delivery')&&o.deliveredOn)return o.deliveredOn;
  return o.created;
}
function totalsForRange(from,to){
  let received=0,owed=0,expBiz=0,expHome=0,loanPay=0,fReceived=0,fOwed=0;
  const inR=d=>(!from||d>=from)&&(!to||d<=to);
  mem.orders.forEach(o=>{
    const idate=incomeDateOf(o);
    if(isForeign(o)){ fOwed+=orderRemaining(o); if(inR(idate))fReceived+=o.paid; }
    else { owed+=orderRemaining(o); if(inR(idate))received+=o.paid; }
  });
  mem.expenses.forEach(e=>{if(!inR(e.date))return;if(e.loanId)loanPay+=e.amount;else if(e.scope==='home')expHome+=e.amount;else expBiz+=e.amount;});
  return {received,owed,expBiz,expHome,loanPay,exp:expBiz+expHome+loanPay,fReceived,fOwed};
}
function ymOf(d){return d.slice(0,7);}
function prevYM(ym){const[y,m]=ym.split('-').map(Number);const d=new Date(y,m-2,1);return d.toISOString().slice(0,7);}
function monthlyNets(){
  // returns array of {ym, label, income, exp, net} for every month with activity, newest first
  const m={};
  mem.orders.forEach(o=>{if(isForeign(o))return;const ym=incomeDateOf(o).slice(0,7);(m[ym]=m[ym]||{inc:0,exp:0}).inc+=o.paid;});
  mem.expenses.forEach(e=>{const ym=(e.date||'').slice(0,7);if(!ym)return;(m[ym]=m[ym]||{inc:0,exp:0}).exp+=e.amount;});
  return Object.keys(m).sort().reverse().map(ym=>({ym:ym,label:new Date(ym+'-01').toLocaleDateString('en',{month:'short',year:'numeric'}),income:m[ym].inc,exp:m[ym].exp,net:m[ym].inc-m[ym].exp}));
}
function monthlySeriesAsc(limit){
  // oldest->newest, with cumulative running balance; last `limit` months
  const asc=monthlyNets().slice().reverse();
  let run=0;
  asc.forEach(r=>{run+=r.net;r.balance=run;});
  return limit?asc.slice(-limit):asc;
}
function monthRange(ym){const[y,m]=ym.split('-').map(Number);const last=new Date(y,m,0).getDate();return [ym+'-01', ym+'-'+String(last).padStart(2,'0')];}
function monthEndProjection(ym){
  // project month-end net by scaling current net by (days in month / days elapsed)
  const[from,to]=monthRange(ym);const t=totalsForRange(from,to);const net=t.received-t.exp;
  const now=new Date();const y=+ym.split('-')[0],m=+ym.split('-')[1];
  const daysInMonth=new Date(y,m,0).getDate();
  const isCurrent=(now.toISOString().slice(0,7)===ym);
  const dayNow=isCurrent?now.getDate():daysInMonth;
  if(dayNow<1)return net;
  return Math.round(net*(daysInMonth/dayNow));
}
function bestItem(){
  const map={};mem.orders.forEach(o=>{if(isForeign(o))return;const k=(o.clothType||'Other').trim()||'Other';map[k]=(map[k]||0)+o.total;});
  let best=null;Object.entries(map).forEach(([k,v])=>{if(!best||v>best.v)best={k,v};});return best;
}
function bestCustomer(){
  const map={};mem.orders.forEach(o=>{if(isForeign(o))return;const k=(o.customer||'').trim();if(!k||k.toLowerCase()==='bazar customer')return;map[k]=(map[k]||0)+o.total;});
  let best=null;Object.entries(map).forEach(([k,v])=>{if(!best||v>best.v)best={k,v};});return best;
}
function upcomingEvents(){
  const out=[],now=new Date();now.setHours(0,0,0,0);
  (mem.events||[]).forEach(ev=>{
    if(!ev.date)return;
    const d=new Date(ev.date+'T00:00:00');
    const days=Math.round((d-now)/86400000);
    if(days<0)return; // past events drop off
    // remind at 14 days, and every day in final 7 (0..7)
    if(days===14 || days<=7){
      const total=(ev.checklist||[]).length, done=(ev.checklist||[]).filter(c=>c.done).length;
      out.push({id:ev.id,name:ev.name||'Event',location:ev.location||'',days:days,prep:total?done+'/'+total+' ready':''});
    }
  });
  return out.sort((a,b)=>a.days-b.days);
}
function upcomingDeliveries(){
  const out=[],now=new Date();now.setHours(0,0,0,0);
  mem.orders.forEach(o=>{
    if(!o.delivery)return;
    if(o.delivered)return; // already handed over
    const d=new Date(o.delivery+'T00:00:00');
    const days=Math.round((d-now)/86400000);
    if(days<=3)out.push({name:o.customer||'Order',item:o.clothType||'',days:days,adj:o.needsAdj});
  });
  return out.sort((a,b)=>a.days-b.days);
}
function upcomingRecurring(){
  const rec=mem.expenses.filter(e=>e.recurring&&!e.loanId);
  const byKey={};rec.forEach(e=>{const k=e.cat+'|'+e.scope+'|'+(e.employee||'');if(!byKey[k]||e.date>byKey[k].date)byKey[k]=e;});
  const out=[],now=new Date();
  Object.values(byKey).forEach(e=>{const next=new Date(e.date);if(e.freq==='week')next.setDate(next.getDate()+7);else next.setMonth(next.getMonth()+(e.freq==='quarter'?3:1));const days=Math.round((next-now)/86400000);if(days<=14)out.push({label:e.cat+(e.employee?' ('+e.employee+')':''),amount:e.amount,days:days});});
  return out.sort((a,b)=>a.days-b.days);
}

/* ============================================================
   TABS & RENDER
   ============================================================ */
let tab='home';
function setTab(t){
  tab=t;
  document.querySelectorAll('nav button[data-tab]').forEach(b=>b.classList.toggle('on',b.dataset.tab===t));
  const titles={home:['Overview','Your business & home, one ledger'],orders:['Orders','Workload and delivered'],expenses:['Expenses','Everything you spend'],measurements:['Measurements','Customers & their sizes (cm)'],loans:['Loans','What you owe, and progress'],audit:['Financial audit','Exactly what is counted, by month'],reports:['Reports','Are you growing?']};
  $('hdrTitle').textContent=titles[t][0];$('hdrSub').textContent=titles[t][1];render();
}
function render(){
  const v=$('view');if(!v)return;
  const titleMap={home:'Overview',orders:'Orders',expenses:'Expenses',measurements:'Measurements',loans:'Loans',audit:'Financial audit',reports:'Reports'};
  const body = tab==='home'?renderHome():tab==='orders'?renderOrders():tab==='expenses'?renderExpenses():tab==='measurements'?renderMeasurements():tab==='loans'?renderLoans():tab==='audit'?renderAudit():renderReports();
  v.innerHTML='<div class="pagetitle">'+(titleMap[tab]||'')+'</div>'+body;
  wireDynamic();
}

function renderHome(){
  const ym=today().slice(0,7);const[from,to]=monthRange(ym);
  const t=totalsForRange(from,to);const net=t.received-t.exp;
  const monthName=new Date().toLocaleDateString('en',{month:'long',year:'numeric'});
  // simple, calm subtitle instead of an alarming comparison
  let deltaHtml='<div class="delta">'+(net>=0?'Net profit this month':'Net loss this month')+'</div>';
  // projection
  const proj=monthEndProjection(ym);
  // alerts
  let alerts='';
  if(t.owed>0)alerts+='<div class="alert due"><span class="dot"></span><span><b>'+money(t.owed)+'</b> still owed to you across orders</span></div>';
  const loanBal=mem.loans.reduce((s,l)=>s+l.balance,0);
  if(loanBal>0)alerts+='<div class="alert loan"><span class="dot"></span><span><b>'+money(loanBal)+'</b> in loans still to repay</span></div>';
  upcomingRecurring().forEach(u=>{const txt=u.days<0?'<b>'+u.label+'</b> overdue '+(-u.days)+'d &mdash; '+money(u.amount):u.days===0?'<b>'+u.label+'</b> due today &mdash; '+money(u.amount):'<b>'+u.label+'</b> due in '+u.days+'d &mdash; '+money(u.amount);alerts+='<div class="alert '+(u.days<=2?'due':'')+'"><span class="dot"></span><span>'+txt+'</span></div>';});
  upcomingDeliveries().forEach(u=>{const tag=u.adj?' (adjustment)':'';const txt=u.days<0?'<b>'+esc(u.name)+'</b>'+tag+' delivery overdue by '+(-u.days)+'d':u.days===0?'<b>'+esc(u.name)+'</b>'+tag+' delivery is today':'<b>'+esc(u.name)+'</b>'+tag+' delivery in '+u.days+'d';alerts+='<div class="alert '+(u.days<=1?'due':'')+'"><span class="dot" style="background:'+(u.days<=1?'var(--accent)':'var(--amber)')+'"></span><span>'+txt+(u.item?' &middot; '+esc(u.item):'')+'</span></div>';});
  upcomingEvents().forEach(u=>{const when=u.days===0?'is TODAY':u.days===1?'is tomorrow':'in '+u.days+' days';const txt='<b>'+esc(u.name)+'</b> '+when+(u.location?' &middot; '+esc(u.location):'')+(u.prep?' &middot; prep '+u.prep:'');alerts+='<div class="alert '+(u.days<=3?'due':'')+'"><span class="dot" style="background:'+(u.days<=3?'var(--accent)':'var(--gold)')+'">&#127881;</span><span>'+txt+'</span></div>';});
  // single insight kept: awaiting delivery (tappable -> pending orders)
  const pending=mem.orders.filter(o=>!o.delivered).length;
  let cards='';
  cards+='<div class="insight wide tap-pending" style="cursor:pointer"><div class="accentbar"></div><div class="ilabel"><span class="em">&#128230;</span>To hand over</div><div class="ival">'+pending+'</div><div class="isub">'+(pending?'order'+(pending>1?'s':'')+' to deliver &rsaquo;':'all delivered &#10003;')+'</div></div>';
  const recent=allLedger().slice(0,4);
  const rec=recent.length?recent.map(ledgerRow).join(''):'<div class="empty"><div class="e-ic">&#9998;</div>No entries yet. Tap + to begin.</div>';
  // all-time totals
  const at=totalsForRange(null,null);const atNet=at.received-at.exp;
  const fLine=(r)=>r>0?'<div style="font-size:11.5px;color:var(--gold);margin-top:8px;position:relative">+ '+fmoney(r,FCUR())+' from website orders (kept separate)</div>':'';
  let html='';
  html+='<div class="hero alt"><div class="lbl">Current balance &middot; all time</div><div class="big">'+(atNet<0?'&minus;':'')+money(Math.abs(atNet))+'</div><div class="delta" style="color:var(--muted)">Total made minus total spent, to date</div><div class="row"><div><div class="k">Total made</div><div class="v pos">'+money(at.received)+'</div></div><div><div class="k">Total spent</div><div class="v neg">'+money(at.exp)+'</div></div></div>'+fLine(at.fReceived)+'</div>';
  html+='<div class="insights">'+cards+'</div>';
  if(alerts)html+='<div class="dash-section">Needs attention</div><div class="alerts">'+alerts+'</div>';
  // upcoming events section
  const futureEvents=(mem.events||[]).filter(ev=>ev.date&&ev.date>=today()).sort((a,b)=>a.date.localeCompare(b.date));
  if(futureEvents.length){
    html+='<div class="dash-section">Upcoming events</div>';
    const now=new Date();now.setHours(0,0,0,0);
    html+='<div class="card">'+futureEvents.map(ev=>{
      const d=new Date(ev.date+'T00:00:00');const days=Math.round((d-now)/86400000);
      const total=(ev.checklist||[]).length,done=(ev.checklist||[]).filter(c=>c.done).length;
      const cd=days===0?'Today':days===1?'Tomorrow':'in '+days+' days';
      const urgent=days<=3;
      return '<div class="item" data-event="'+ev.id+'"><div class="ic '+(urgent?'exp':'sal')+'">&#127881;</div><div class="body"><div class="t1">'+esc(ev.name||'Event')+'</div><div class="t2">'+ev.date+(ev.location?' &middot; '+esc(ev.location):'')+'</div><span class="pill '+(urgent?'unpaid':'partial')+'">'+cd+'</span>'+(total?'<span class="pill '+(done===total?'paid':'adj')+'">Prep '+done+'/'+total+'</span>':'')+'</div></div>';
    }).join('')+'</div>';
  }
  html+='<div class="dash-section">Recent activity</div><div class="card">'+rec+'</div>';
  return html;
}

function orderCardHtml(o){
  const fx=isForeign(o);const oc=fx?FCUR():CUR();const om=n=>hideMoney?(oc+' '+MASK):(oc+' '+Math.round(n).toLocaleString());
  const st=orderStatus(o),rem=orderRemaining(o),pct=o.total>0?Math.min(100,Math.round(o.paid/o.total*100)):0;
  const labels={paid:'Fully paid',partial:'Partial',unpaid:'Unpaid'};
  const barC=st==='paid'?'var(--green)':st==='partial'?'var(--amber)':'var(--accent)';
  const sub=[fx?'Website ('+FCUR()+')':(o.orderType==='bazar'?'Bazar':'Custom'),o.clothType||'',o.phone||'',o.delivery?'&rarr; '+o.delivery:''].filter(Boolean).join(' &middot; ');
  const cost=orderCost(o.id),profit=o.total-cost;
  const profitLine=(!fx&&cost>0)?'<div class="t2" style="margin-top:2px">Cost '+money(cost)+' &middot; <b style="color:'+(profit>=0?'var(--green)':'var(--accent)')+'">Profit '+(profit<0?'&minus;':'')+money(Math.abs(profit))+'</b></div>':'';
  return '<div class="item" data-order="'+o.id+'"><div class="ic sale">'+(fx?'&#127760;':(o.orderType==='bazar'?'&#129509;':'&#10022;'))+'</div><div class="body"><div class="t1">'+esc(o.customer||'Order')+'</div><div class="t2">'+sub+'</div>'+profitLine+'<span class="pill '+st+'">'+labels[st]+(rem>0?' &middot; '+om(rem)+' left':'')+'</span>'+(o.needsAdj?'<span class="pill adj">Needs adjustment</span>':'')+(o.delivered?'<span class="pill paid">Delivered &#10003;</span>':'')+'<div class="prog"><i style="width:'+pct+'%;background:'+barC+'"></i></div></div><div class="amt in">'+om(o.total)+'</div></div>';
}
function renderOrders(){
  const orders=[...mem.orders].sort((a,b)=>(b.id>a.id?1:-1));
  const owed=orders.filter(o=>!isForeign(o)).reduce((s,o)=>s+orderRemaining(o),0);
  const fowed=orders.filter(o=>isForeign(o)).reduce((s,o)=>s+orderRemaining(o),0);
  const pending=orders.filter(o=>!o.delivered);
  const done=orders.filter(o=>o.delivered);
  const owedDisplay=money(owed)+(fowed>0?' <span style="font-size:12px;color:var(--gold)">+ '+fmoney(fowed,FCUR())+'</span>':'');
  let html='<div class="twostat"><div><div class="sl">Owed to you</div><div class="sv" style="color:var(--accent)">'+owedDisplay+'</div></div><div><div class="sl">To deliver</div><div class="sv">'+pending.length+'</div></div></div>';
  if(!orders.length){return html+'<div class="card"><div class="empty"><div class="e-ic">&#10022;</div>No orders yet. Tap + &rarr; New order.</div></div>';}
  // Workload (flat, active)
  html+='<div class="dash-section">Workload &middot; to deliver ('+pending.length+')</div>';
  html+=pending.length?'<div class="card">'+pending.map(orderCardHtml).join('')+'</div>':'<div class="card"><div class="empty" style="padding:18px">Nothing pending &mdash; all caught up &#10003;</div></div>';
  // Delivered, grouped by month (expandable)
  if(done.length){
    html+='<div class="dash-section">Delivered ('+done.length+')</div>';
    const groups={};
    done.forEach(o=>{const ym=(o.deliveredOn||o.delivery||o.created||'').slice(0,7)||'unknown';(groups[ym]=groups[ym]||[]).push(o);});
    const yms=Object.keys(groups).sort().reverse();
    yms.forEach((ym,idx)=>{
      const list=groups[ym];
      const label=ym==='unknown'?'No date':new Date(ym+'-01').toLocaleDateString('en',{month:'long',year:'numeric'});
      const total=list.reduce((s,o)=>s+(isForeign(o)?0:o.total),0);
      const open=idx===0; // newest month expanded by default
      html+='<div class="monthgroup">'
        +'<button class="monthhead" data-mgroup="'+ym+'"><span class="mh-caret">'+(open?'&#9662;':'&#9656;')+'</span><span class="mh-label">'+label+'</span><span class="mh-count">'+list.length+' order'+(list.length>1?'s':'')+' &middot; '+money(total)+'</span></button>'
        +'<div class="monthbody'+(open?' show':'')+'" id="mg_'+ym+'"><div class="card">'+list.map(orderCardHtml).join('')+'</div></div>'
      +'</div>';
    });
  }
  return html;
}

let expFilter='all';
let expCat=null; // optional category drill-down from reports
function dupKey(e){return e.scope+'|'+e.cat+'|'+e.amount+'|'+e.date;}
function duplicateIds(){
  // flag entries sharing scope+category+amount+date (keep first, mark the rest as dup)
  const seen={},dups={};
  mem.expenses.filter(e=>!e.loanId&&!e.rollId).sort((a,b)=>(a.id>b.id?1:-1)).forEach(e=>{
    const k=dupKey(e);
    if(seen[k])dups[e.id]=true; else seen[k]=e.id;
  });
  return dups;
}
function expenseRowHtml(e,dupset){
  const exIcons={Fabric:'&#129525;',Salaries:'&#128101;',Accessories:'&#9988;',Transport:'&#128666;',Bazar:'&#128717;',Shipment:'&#128230;',Fuel:'&#9981;',Rent:'&#127968;',School:'&#127890;',Grocery:'&#9737;',Other:'&middot;'};
  const isDup=dupset&&dupset[e.id];
  if(e.loanId){const loan=mem.loans.find(l=>l.id===e.loanId);return '<div class="item" data-exp="'+e.id+'"><div class="ic loan">&#9672;</div><div class="body"><div class="t1">Loan repayment'+(loan?' &middot; '+esc(loan.lender):'')+'</div><div class="t2">Loan &middot; '+e.date+(e.note?' &middot; '+esc(e.note):'')+'</div></div><div class="amt out">&minus;'+money(e.amount)+'</div></div>';}
  return '<div class="item" data-exp="'+e.id+'"><div class="ic '+(e.scope==='home'?'home':'exp')+'">'+(exIcons[e.cat]||'&minus;')+'</div><div class="body"><div class="t1">'+e.cat+(e.employee?' &middot; '+esc(e.employee):'')+'</div><div class="t2">'+(e.scope==='home'?'Household':'Business')+' &middot; '+e.date+(e.note?' &middot; '+esc(e.note):'')+'</div>'+(isDup?'<span class="pill unpaid">Possible duplicate</span>':'')+'</div><div class="amt out">&minus;'+money(e.amount)+'</div></div>';
}
function renderExpenses(){
  const all=mem.expenses.filter(e=>!e.rollId);
  const biz=all.filter(e=>e.scope!=='home');
  const home=all.filter(e=>e.scope==='home');
  const ym=today().slice(0,7);
  const sumMonth=arr=>arr.filter(e=>e.date.slice(0,7)===ym).reduce((s,e)=>s+e.amount,0);
  let list = expFilter==='biz'?biz : expFilter==='home'?home : all;
  if(expCat)list=list.filter(e=>e.cat===expCat);
  list=[...list].sort((a,b)=>(b.id>a.id?1:-1));
  const total = expFilter==='biz'?sumMonth(biz) : expFilter==='home'?sumMonth(home) : sumMonth(all);
  const labelMap={all:'Total',biz:'Business',home:'Household'};
  const dupset=duplicateIds();
  const dupCount=list.filter(e=>dupset[e.id]).length;
  let html='<div class="twostat"><div><div class="sl">'+labelMap[expFilter]+(expCat?' &middot; '+expCat:'')+' &middot; this month</div><div class="sv" style="color:var(--accent)">'+money(total)+'</div></div><div><div class="sl">Entries</div><div class="sv">'+list.length+'</div></div></div>';
  if(expCat)html+='<div class="filterbar"><button class="on" id="exp_clearcat">&times; '+expCat+' &mdash; show all</button></div>';
  else html+='<div class="filterbar">'+[['all','All'],['biz','Business'],['home','Household']].map(f=>'<button data-expf="'+f[0]+'" class="'+(expFilter===f[0]?'on':'')+'">'+f[1]+'</button>').join('')+'</div>';
  if(dupCount>0)html+='<div class="alert due" style="margin-bottom:10px"><span class="dot"></span><span><b>'+dupCount+' possible duplicate'+(dupCount>1?'s':'')+'</b> found (same category, amount &amp; date). Tap one to review or delete.</span></div>';
  if(!list.length){
    html+='<div class="card"><div class="empty" style="padding:22px"><div class="e-ic">&#128178;</div>No expenses here yet. Tap + &rarr; Expense.</div></div>';
    return html;
  }
  // group by month, expandable (newest month open)
  const groups={};
  list.forEach(e=>{const ym2=(e.date||'').slice(0,7)||'unknown';(groups[ym2]=groups[ym2]||[]).push(e);});
  const yms=Object.keys(groups).sort().reverse();
  yms.forEach((ym2,idx)=>{
    const arr=groups[ym2];
    const label=ym2==='unknown'?'No date':new Date(ym2+'-01').toLocaleDateString('en',{month:'long',year:'numeric'});
    const gtotal=arr.reduce((s,e)=>s+e.amount,0);
    const open=idx===0;
    html+='<div class="monthgroup">'
      +'<button class="monthhead" data-mgroupx="'+ym2+'"><span class="mh-caret">'+(open?'&#9662;':'&#9656;')+'</span><span class="mh-label">'+label+'</span><span class="mh-count">'+arr.length+' &middot; '+money(gtotal)+'</span></button>'
      +'<div class="monthbody'+(open?' show':'')+'" id="xg_'+ym2+'"><div class="card">'+arr.map(e=>expenseRowHtml(e,dupset)).join('')+'</div></div>'
    +'</div>';
  });
  html+='<div class="hint" style="text-align:center;margin-top:10px">Tap a month to expand &middot; tap any expense to edit or delete it.</div>';
  return html;
}

function renderLoans(){
  const loans=[...mem.loans].sort((a,b)=>b.balance-a.balance);
  const totalBal=loans.reduce((s,l)=>s+l.balance,0);const totalBorrowed=loans.reduce((s,l)=>s+l.total,0);
  const list=loans.length?loans.map(l=>{const repaid=loanRepaid(l),pct=l.total>0?Math.round(repaid/l.total*100):0;const cleared=l.balance<=0;return '<div class="item" data-loan="'+l.id+'"><div class="ic loan">&#9672;</div><div class="body"><div class="t1">'+esc(l.lender||'Loan')+'</div><div class="t2">'+money(repaid)+' repaid of '+money(l.total)+(l.note?' &middot; '+esc(l.note):'')+'</div><span class="pill '+(cleared?'paid':'partial')+'">'+(cleared?'Cleared &#10003;':money(l.balance)+' left')+'</span><div class="prog"><i style="width:'+pct+'%;background:var(--purple)"></i></div></div><div class="amt">'+pct+'%</div></div>';}).join(''):'<div class="empty"><div class="e-ic">&#9672;</div>No loans tracked. Tap + &rarr; Add a loan.</div>';
  return '<div class="twostat"><div><div class="sl">Still to repay</div><div class="sv" style="color:var(--purple)">'+money(totalBal)+'</div></div><div><div class="sl">Total borrowed</div><div class="sv">'+money(totalBorrowed)+'</div></div></div><div class="card">'+list+'</div>'+(loans.length?'<div class="hint" style="text-align:center;margin-top:10px">Tap a loan to log a repayment.</div>':'');
}

function allLedger(){
  const rows=[];
  mem.orders.forEach(o=>{const fx=isForeign(o);const oc=fx?FCUR():CUR();const amt=o.paid>0?o.paid:o.total;rows.push({kind:'sale',id:o.id,name:o.customer||'Order',sub:(fx?'Website':(o.orderType==='bazar'?'Bazar':'Custom'))+' &middot; '+orderStatus(o)+(o.clothType?' &middot; '+o.clothType:''),amt:amt,disp:(o.paid>0?'+':'')+oc+' '+Math.round(amt).toLocaleString(),unpaidFlag:o.paid<=0,date:o.created,scope:'biz'});});
  mem.expenses.forEach(e=>rows.push({kind:e.loanId?'loan':'exp',id:e.id,loanId:e.loanId,name:e.loanId?('Repaid: '+((mem.loans.find(l=>l.id===e.loanId)||{}).lender||'loan')):(e.cat+(e.employee?' &middot; '+e.employee:'')),sub:(e.loanId?'Loan':(e.scope==='home'?'Home':'Business'))+(e.note?' &middot; '+e.note:''),amt:-e.amount,date:e.date,scope:e.scope,cat:e.cat,rollId:e.rollId}));
  return rows.sort((a,b)=>b.date.localeCompare(a.date));
}
function ledgerRow(r){
  const icons={Fabric:'&#129525;',Accessories:'&#9988;',Transport:'&#128666;',Bazar:'&#128717;',Shipment:'&#128230;',Fuel:'&#9981;',Salaries:'&#128101;',Rent:'&#127968;',School:'&#127890;',Grocery:'&#9737;',Other:'&middot;'};
  const cls=r.kind==='sale'?'sale':r.kind==='loan'?'loan':(r.scope==='home'?'home':(r.cat==='Salaries'?'sal':'exp'));
  const ic=r.kind==='sale'?'&#10022;':r.kind==='loan'?'&#9672;':(icons[r.cat]||'&minus;');
  const amtStr=r.disp?r.disp:((r.amt>=0?'+':'&minus;')+money(Math.abs(r.amt)));
  return '<div class="item" '+(r.kind==='sale'?'data-order="'+r.id+'"':'data-exp="'+r.id+'"')+'><div class="ic '+cls+'">'+ic+'</div><div class="body"><div class="t1">'+esc(r.name)+'</div><div class="t2">'+r.sub+' &middot; '+r.date+'</div></div><div class="amt '+(r.amt>=0?'in':'out')+'">'+amtStr+'</div></div>';
}

let repGran='month';
function periodKey(d,gran){const dt=new Date(d+'T00:00:00');if(gran==='day')return d;if(gran==='week'){const t=new Date(dt);const day=(t.getDay()+6)%7;t.setDate(t.getDate()-day);return t.toISOString().slice(0,10);}return d.slice(0,7);}
function periodLabel(k,gran){if(gran==='month'){const p=k.split('-');return new Date(p[0],p[1]-1,1).toLocaleDateString('en',{month:'short'});}const d=new Date(k+'T00:00:00');return d.toLocaleDateString('en',{month:'short',day:'numeric'});}
function buildSeries(gran){const map={};mem.orders.forEach(o=>{if(o.paid>0&&!isForeign(o)){const k=periodKey(incomeDateOf(o),gran);(map[k]=map[k]||{income:0,cost:0}).income+=o.paid;}});mem.expenses.forEach(e=>{const k=periodKey(e.date,gran);(map[k]=map[k]||{income:0,cost:0}).cost+=e.amount;});const keys=Object.keys(map).sort();const N=gran==='day'?10:gran==='week'?8:6;return keys.slice(-N).map(k=>({k:k,label:periodLabel(k,gran),income:map[k].income,cost:map[k].cost}));}
function lineChart(series){
  if(!series.length)return '<div class="empty" style="padding:30px">No data yet &mdash; add a few entries to see your trend.</div>';
  const W=Math.max(320,series.length*54+40),H=180,P=28;
  const maxV=Math.max(1,...series.map(s=>Math.max(s.income,s.cost)));
  const x=i=>P+(series.length===1?(W-2*P)/2:i*(W-2*P)/(series.length-1));
  const y=v=>H-P-(v/maxV)*(H-2*P);
  const path=key=>series.map((s,i)=>(i===0?'M':'L')+x(i).toFixed(1)+','+y(s[key]).toFixed(1)).join(' ');
  const dots=key=>series.map((s,i)=>'<circle cx="'+x(i).toFixed(1)+'" cy="'+y(s[key]).toFixed(1)+'" r="3.5" fill="'+(key==='income'?'var(--green)':'var(--accent)')+'"/>').join('');
  const labels=series.map((s,i)=>'<text x="'+x(i).toFixed(1)+'" y="'+(H-8)+'" font-size="10" fill="var(--muted)" text-anchor="middle" font-family="Archivo">'+s.label+'</text>').join('');
  return '<div class="chartwrap"><svg viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" xmlns="http://www.w3.org/2000/svg"><line x1="'+P+'" y1="'+(H-P)+'" x2="'+(W-P)+'" y2="'+(H-P)+'" stroke="var(--line)" stroke-width="1"/><path d="'+path('cost')+'" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/><path d="'+path('income')+'" fill="none" stroke="var(--green)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>'+dots('cost')+dots('income')+labels+'</svg></div><div class="legend"><span><i style="background:var(--green)"></i>Income</span><span><i style="background:var(--accent)"></i>Cost</span></div>';
}
let custSearch='';
function findCustomerById(id){return mem.customers.find(c=>c.id===id);}
function findCustomerByName(name){const n=(name||'').trim().toLowerCase();return mem.customers.find(c=>(c.name||'').trim().toLowerCase()===n);}
function upsertCustomer(name,phone,measurements){
  // returns customer id; creates if new, updates measurements/phone if existing
  let c=findCustomerByName(name);
  if(!c){c={id:uid(),name:(name||'').trim(),phone:phone||'',m:{}};mem.customers.push(c);}
  if(phone)c.phone=phone;
  if(measurements&&Object.keys(measurements).length)c.m=measurements;
  return c.id;
}
function ordersForCustomerId(cid,name){
  // match by customerId primarily; fall back to name for older orders
  const n=(name||'').trim().toLowerCase();
  return mem.orders.filter(o=>(o.customerId&&o.customerId===cid)||(!o.customerId&&(o.customer||'').trim().toLowerCase()===n));
}
function renderMeasurements(){
  const q=custSearch.trim().toLowerCase();
  let custs=[...mem.customers].sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  if(q)custs=custs.filter(c=>(c.name||'').toLowerCase().includes(q)||(c.phone||'').includes(q));
  let html='<div class="twostat"><div><div class="sl">Customers</div><div class="sv">'+mem.customers.length+'</div></div><div><div class="sl">With measurements</div><div class="sv">'+mem.customers.filter(c=>c.m&&Object.keys(c.m).length).length+'</div></div></div>';
  html+='<input class="searchbox" id="cust_search" placeholder="&#128269; Search customer by name or phone" value="'+esc(custSearch)+'">';
  html+='<div class="hint" style="margin:-4px 0 10px">Customers are also added automatically when you create their order. Tap a customer to view or edit measurements.</div>';
  html+='<button class="save" id="cust_add" style="margin-top:0">+ New customer</button>';
  if(!custs.length){html+='<div class="card" style="margin-top:12px"><div class="empty"><div class="e-ic">&#128207;</div>'+(q?'No customer matches.':'No customers yet. Add one to save their measurements.')+'</div></div>';return html;}
  html+='<div class="card" style="margin-top:12px">'+custs.map(c=>{
    const ords=ordersForCustomerId(c.id,c.name);
    const prods=ords.map(o=>o.clothType).filter(Boolean).slice(0,3).join(', ');
    const hasM=c.m&&Object.keys(c.m).filter(k=>c.m[k]).length;
    return '<div class="item custcard" data-cust="'+c.id+'"><div class="ic sale">&#128100;</div><div class="body"><div class="t1">'+esc(c.name||'Customer')+'</div><div class="t2">'+(c.phone?esc(c.phone)+' &middot; ':'')+(hasM?hasM+' measurements':'no measurements yet')+'</div>'+(prods?'<div class="t2">Orders: '+esc(prods)+(ords.length>3?'…':'')+'</div>':'')+'</div><div class="amt" style="color:var(--muted)">'+ords.length+'&nbsp;ord</div></div>';
  }).join('')+'</div>';
  return html;
}
function customerForm(existing){
  const c=existing||{};const m=c.m||{};
  let html='<h2>'+(existing?'Customer':'New customer')+'</h2>';
  html+='<label>Name</label><input id="c_name" value="'+esc(c.name||'')+'" placeholder="Full name">';
  html+='<label>Phone (optional)</label><input id="c_phone" type="tel" value="'+esc(c.phone||'')+'" placeholder="09...">';
  html+='<label>Measurements (cm)</label><div class="measure-grid">';
  html+=MFIELDS.map(f=>'<div><label style="font-size:10.5px">'+f[1]+'</label><input id="m_'+f[0]+'" type="number" inputmode="decimal" value="'+(m[f[0]]||'')+'" placeholder="cm"></div>').join('');
  html+='</div>';
  html+='<label style="margin-top:14px">Notes (optional)</label><input id="c_note" value="'+esc(c.note||'')+'" placeholder="fit preferences, etc.">';
  if(existing){
    const ords=ordersForCustomerId(c.id,c.name);
    if(ords.length)html+='<div class="dash-section" style="font-size:16px">Order history</div><div class="card">'+ords.sort((a,b)=>b.created.localeCompare(a.created)).map(o=>'<div class="item" data-order="'+o.id+'"><div class="ic sale">&#10022;</div><div class="body"><div class="t1">'+esc(o.clothType||'Order')+'</div><div class="t2">'+o.created+' &middot; '+orderStatus(o)+'</div></div><div class="amt in">'+(isForeign(o)?FCUR():CUR())+' '+Math.round(o.total).toLocaleString()+'</div></div>').join('')+'</div>';
  }
  html+='<button class="save" id="c_save">'+(existing?'Save customer':'Add customer')+'</button>';
  if(existing)html+='<button class="ghost del" id="c_del">Delete customer</button>';
  openSheet(html);
  $('c_save').onclick=async()=>{
    const name=$('c_name').value.trim();if(!name){toast('Enter a name');return;}
    const mm={};MFIELDS.forEach(f=>{const v=$('m_'+f[0]).value;if(v)mm[f[0]]=+v;});
    const data={name:name,phone:$('c_phone').value,note:$('c_note').value,m:mm};
    if(existing)Object.assign(existing,data);else mem.customers.push(Object.assign({id:uid()},data));
    await save();closeSheet();toast(existing?'Customer saved':'Customer added');render();
  };
  if(existing)$('c_del').onclick=async()=>{if(confirm('Delete this customer and their measurements? Their orders stay.')){mem.customers=mem.customers.filter(x=>x.id!==existing.id);await save();closeSheet();toast('Deleted');render();}};
}

function renderAudit(){
  // Plain, no-assumption breakdown of exactly what the app counts, grouped by month
  const byMonth={};
  mem.orders.forEach(o=>{
    if(isForeign(o))return; // foreign shown separately
    const d=incomeDateOf(o);const ym=(d||'????').slice(0,7);
    (byMonth[ym]=byMonth[ym]||{income:0,exp:0,orders:[],expenses:[]});
    byMonth[ym].income+=o.paid;
    byMonth[ym].orders.push(o);
  });
  mem.expenses.forEach(e=>{
    const ym=(e.date||'????').slice(0,7);
    (byMonth[ym]=byMonth[ym]||{income:0,exp:0,orders:[],expenses:[]});
    byMonth[ym].exp+=e.amount;
    byMonth[ym].expenses.push(e);
  });
  const months=Object.keys(byMonth).sort().reverse();
  let totIncome=0,totExp=0;
  mem.orders.forEach(o=>{if(!isForeign(o))totIncome+=o.paid;});
  mem.expenses.forEach(e=>totExp+=e.amount);
  let html='<div class="twostat"><div><div class="sl">All income counted</div><div class="sv" style="color:var(--green)">'+money(totIncome)+'</div></div><div><div class="sl">All spent counted</div><div class="sv" style="color:var(--accent)">'+money(totExp)+'</div></div></div>';
  html+='<div class="hint" style="margin-bottom:10px">This shows <b>exactly</b> what the app counts and the month each amount is filed under (by order date, or delivery date for on-delivery). If a number looks wrong, the order/expense date is the cause &mdash; tap it to fix the date.</div>';
  if(!months.length)return html+'<div class="card"><div class="empty">No data yet.</div></div>';
  months.forEach(ym=>{
    const b=byMonth[ym];const net=b.income-b.exp;
    const label=ym==='????'?'No date set (!)':new Date(ym+'-01').toLocaleDateString('en',{month:'long',year:'numeric'});
    html+='<div class="dash-section" style="font-size:16px">'+label+' &mdash; <span style="color:'+(net>=0?'var(--green)':'var(--accent)')+'">net '+(net<0?'&minus;':'')+money(Math.abs(net))+'</span></div>';
    html+='<div class="card">';
    html+='<div class="item" style="cursor:default"><div class="ic sale">&#8599;</div><div class="body"><div class="t1">Income this month</div><div class="t2">'+b.orders.length+' order(s) collected</div></div><div class="amt in">'+money(b.income)+'</div></div>';
    b.orders.forEach(o=>{html+='<div class="item" data-order="'+o.id+'"><div class="ic sale" style="opacity:.5">&#10022;</div><div class="body"><div class="t2">'+esc(o.customer||'Order')+' &middot; '+(o.clothType||'')+' &middot; date '+(incomeDateOf(o))+'</div></div><div class="amt in">'+money(o.paid)+(orderRemaining(o)>0?' <span style="color:var(--muted);font-size:11px">('+money(orderRemaining(o))+' owed)</span>':'')+'</div></div>';});
    html+='<div class="item" style="cursor:default"><div class="ic exp">&#8600;</div><div class="body"><div class="t1">Spent this month</div><div class="t2">'+b.expenses.length+' expense(s)</div></div><div class="amt out">&minus;'+money(b.exp)+'</div></div>';
    b.expenses.forEach(e=>{html+='<div class="item" data-exp="'+e.id+'"><div class="ic exp" style="opacity:.5">&minus;</div><div class="body"><div class="t2">'+e.cat+' &middot; '+(e.scope==='home'?'Household':'Business')+' &middot; '+e.date+'</div></div><div class="amt out">&minus;'+money(e.amount)+'</div></div>';});
    html+='</div>';
  });
  return html;
}

function monthlyBarChart(rows){
  // grouped vertical bars: income + expense per month, last 12 months, tappable
  if(!rows.length)return '<div class="empty" style="padding:20px">No monthly data yet.</div>';
  if(hideMoney)return '<div class="empty" style="padding:20px">Money hidden &mdash; tap the eye to show.</div>';
  const max=Math.max(1,...rows.map(r=>Math.max(r.income,r.exp)));
  const H=120; // px chart height
  let bars=rows.map(r=>{
    const ih=Math.round(r.income/max*H), eh=Math.round(r.exp/max*H);
    const short=r.label.split(' ')[0]; // "Jun"
    return '<div class="mbar" data-gomonth="'+r.ym+'" title="'+r.label+'">'
      +'<div class="mbar-cols" style="height:'+H+'px">'
        +'<div class="mbar-col inc" style="height:'+Math.max(2,ih)+'px"></div>'
        +'<div class="mbar-col exp" style="height:'+Math.max(2,eh)+'px"></div>'
      +'</div>'
      +'<div class="mbar-label">'+short+'</div>'
    +'</div>';
  }).join('');
  return '<div class="mchart-legend"><span><i class="lg inc"></i>Income</span><span><i class="lg exp"></i>Expense</span></div>'
    +'<div class="mchart">'+bars+'</div>'
    +'<div class="hint" style="margin-top:8px">Tap a month to see its full income &amp; expense detail.</div>';
}
function renderMonthDetail(ym){
  // full income & expense detail for a single month
  const[from,to]=monthRange(ym);
  const label=new Date(ym+'-01').toLocaleDateString('en',{month:'long',year:'numeric'});
  const inR=d=>d>=from&&d<=to;
  const incomeOrders=mem.orders.filter(o=>!isForeign(o)&&inR(incomeDateOf(o))&&o.paid>0);
  const exps=mem.expenses.filter(e=>inR(e.date));
  const incTot=incomeOrders.reduce((s,o)=>s+o.paid,0);
  const expTot=exps.reduce((s,e)=>s+e.amount,0);
  let html='<h2>'+label+'</h2>';
  html+='<div class="twostat"><div><div class="sl">Income</div><div class="sv" style="color:var(--green)">'+money(incTot)+'</div></div><div><div class="sl">Expense</div><div class="sv" style="color:var(--accent)">'+money(expTot)+'</div></div></div>';
  html+='<div class="dash-section">Income ('+incomeOrders.length+')</div><div class="card">'+(incomeOrders.length?incomeOrders.sort((a,b)=>b.paid-a.paid).map(o=>'<div class="item" style="cursor:default"><div class="ic sale">&#10022;</div><div class="body"><div class="t1">'+esc(o.customer||'Order')+'</div><div class="t2">'+(o.clothType||'')+' &middot; '+incomeDateOf(o)+'</div></div><div class="amt in">'+money(o.paid)+'</div></div>').join(''):'<div class="empty" style="padding:16px">No income this month.</div>')+'</div>';
  html+='<div class="dash-section">Expense ('+exps.length+')</div><div class="card">'+(exps.length?exps.sort((a,b)=>b.amount-a.amount).map(e=>'<div class="item" style="cursor:default"><div class="ic '+(e.scope==='home'?'home':'exp')+'">&minus;</div><div class="body"><div class="t1">'+(e.loanId?'Loan repayment':e.cat)+'</div><div class="t2">'+(e.scope==='home'?'Household':'Business')+' &middot; '+e.date+(e.note?' &middot; '+esc(e.note):'')+'</div></div><div class="amt out">&minus;'+money(e.amount)+'</div></div>').join(''):'<div class="empty" style="padding:16px">No expenses this month.</div>')+'</div>';
  openSheet(html);
}

function renderReports(){
  const series=buildSeries(repGran);let trendTag='',growMsg='';
  if(series.length>=2){const last=series[series.length-1],prev=series[series.length-2];const lastNet=last.income-last.cost,prevNet=prev.income-prev.cost;const netUp=lastNet>=prevNet;trendTag=netUp?'<span class="tag up">&#9650; Growing</span>':'<span class="tag down">&#9660; Tightening</span>';growMsg=netUp?'Your net improved vs the previous '+repGran+'. Keep it up.':'Costs are catching up to income this '+repGran+'. Watch spending.';}
  const cur=series[series.length-1]||{income:0,cost:0};const curNet=cur.income-cur.cost;
  const ym=today().slice(0,7);
  // this-month figures
  const monthExp=mem.expenses.filter(e=>e.date.slice(0,7)===ym);
  let bizTotal=0,homeTotal=0;
  const bizCats={},homeCats={};
  monthExp.forEach(e=>{const k=e.loanId?'Loan repay':e.cat;if(e.scope==='home'){homeTotal+=e.amount;homeCats[k]=(homeCats[k]||0)+e.amount;}else{bizTotal+=e.amount;bizCats[k]=(bizCats[k]||0)+e.amount;}});
  const ordersThisMonth=mem.orders.filter(o=>o.created.slice(0,7)===ym).length;
  const totalOrders=mem.orders.length;
  const deliveredCount=mem.orders.filter(o=>o.delivered).length;
  const notDeliveredCount=totalOrders-deliveredCount;
  const palette=['#b5482e','#a07c2c','#3f6b4a','#7a6f60','#c08a2d','#6b4a6b','#8a5a44'];
  const barsFor=(obj,scope)=>{const max=Math.max(1,...Object.values(obj));return Object.entries(obj).sort((a,b)=>b[1]-a[1]).map((e,i)=>'<div class="bar tapbar" data-gocat="'+e[0]+'" data-goscope="'+scope+'" style="cursor:pointer"><div class="bn">'+e[0]+'</div><div class="bt"><i style="width:'+Math.round(e[1]/max*100)+'%;background:'+palette[i%palette.length]+'"></i></div><div class="ba">'+money(e[1])+' &rsaquo;</div></div>').join('');};
  const bizBars=Object.keys(bizCats).length?barsFor(bizCats,'biz'):'<div class="empty" style="padding:10px">No business expenses this month.</div>';
  const homeBars=Object.keys(homeCats).length?barsFor(homeCats,'home'):'<div class="empty" style="padding:10px">No household expenses this month.</div>';
  const series12=monthlySeriesAsc(12);
  let html='<div class="repcard"><h3>Monthly income vs expense</h3>'+monthlyBarChart(series12)+'</div>';
  html+='<div class="twostat"><div><div class="sl">Orders this month</div><div class="sv">'+ordersThisMonth+'</div></div><div><div class="sl">Orders all-time</div><div class="sv">'+totalOrders+'</div></div></div>';
  html+='<div class="twostat"><div><div class="sl">Delivered</div><div class="sv" style="color:var(--green)">'+deliveredCount+'</div></div><div class="tap-pending" style="cursor:pointer"><div class="sl">Not delivered &rsaquo;</div><div class="sv" style="color:var(--accent)">'+notDeliveredCount+'</div></div></div>';
  html+='<div class="repcard"><h3>Expenses this month</h3><div class="bar tapbar" data-goscope="biz" style="cursor:pointer"><div class="bn" style="font-weight:600">Business</div><div class="bt"><i style="width:'+Math.round(bizTotal/Math.max(1,bizTotal+homeTotal)*100)+'%;background:var(--accent)"></i></div><div class="ba">'+money(bizTotal)+' &rsaquo;</div></div><div class="bar tapbar" data-goscope="home" style="cursor:pointer"><div class="bn" style="font-weight:600">Household</div><div class="bt"><i style="width:'+Math.round(homeTotal/Math.max(1,bizTotal+homeTotal)*100)+'%;background:var(--gold)"></i></div><div class="ba">'+money(homeTotal)+' &rsaquo;</div></div><div class="hint" style="margin-top:8px;font-weight:600;color:var(--ink)">Total: '+money(bizTotal+homeTotal)+'</div></div>';
  html+='<div class="repcard"><h3>Business expenses &middot; detail</h3>'+bizBars+'</div>';
  html+='<div class="repcard"><h3>Household expenses &middot; detail</h3>'+homeBars+'</div>';
  // loans section (moved here from its own tab)
  const loans=[...mem.loans].sort((a,b)=>b.balance-a.balance);
  const totalBal=loans.reduce((s,l)=>s+l.balance,0);
  const loanRows=loans.length?loans.map(l=>{const repaid=loanRepaid(l),pct=l.total>0?Math.round(repaid/l.total*100):0;const cleared=l.balance<=0;return '<div class="item" data-loan="'+l.id+'"><div class="ic loan">&#9672;</div><div class="body"><div class="t1">'+esc(l.lender||'Loan')+'</div><div class="t2">'+money(repaid)+' repaid of '+money(l.total)+(l.note?' &middot; '+esc(l.note):'')+'</div><span class="pill '+(cleared?'paid':'partial')+'">'+(cleared?'Cleared &#10003;':money(l.balance)+' left')+'</span><div class="prog"><i style="width:'+pct+'%;background:var(--purple)"></i></div></div><div class="amt">'+pct+'%</div></div>';}).join(''):'<div class="empty" style="padding:18px">No loans tracked. Tap + &rarr; Expense &rarr; Loan.</div>';
  html+='<div class="dash-section">Loans <span style="font-family:Archivo;font-style:normal;font-size:12px;color:var(--muted)">&mdash; '+money(totalBal)+' to repay &middot; tap to manage</span></div><div class="card">'+loanRows+'</div>';
  // Previous months — tappable list showing money at end of each month (running balance)
  const ser=monthlySeriesAsc(12).slice().reverse(); // newest first for display
  if(ser.length){
    let rows=ser.map(r=>'<div class="item monthrow" data-gomonth="'+r.ym+'" style="cursor:pointer"><div class="body"><div class="t1">'+r.label+'</div><div class="t2">in '+money(r.income)+' &middot; out '+money(r.exp)+'</div></div><div class="amt" style="color:'+(r.balance>=0?'var(--green)':'var(--accent)')+'">'+(r.balance<0?'&minus;':'')+money(Math.abs(r.balance))+' &rsaquo;</div></div>').join('');
    html+='<div class="dash-section">Previous months &middot; balance at month end</div><div class="hint" style="margin:0 0 8px">Money you had at the end of each month. Tap a month to see its full income &amp; expense report.</div><div class="card">'+rows+'</div>';
  }
  html+='<button class="ghost" id="setBtn">&#9881; Settings &amp; account</button>';
  return html;
}

/* ============================================================
   SHEETS / FORMS
   ============================================================ */
const scrim=$('scrim'),sheet=$('sheet'),sheetInner=$('sheetInner');
function lockScroll(){document.body.style.overflow='hidden';document.body.style.touchAction='none';}
function unlockScroll(){if(!sheet.classList.contains('show')&&!$('sideMenu').classList.contains('show')){document.body.style.overflow='';document.body.style.touchAction='';}}
function openSheet(html){
  sheetInner.innerHTML='<div class="grab" id="grabClose"></div><button class="sheetback" id="sheetBack" aria-label="Back">&#8592;</button><button class="sheetclose" id="sheetClose" aria-label="Close">&times;</button>'+html;
  scrim.classList.add('show');sheet.classList.add('show');sheet.scrollTop=0;lockScroll();
  const sc=$('sheetClose');if(sc)sc.onclick=closeSheet;
  const sb=$('sheetBack');if(sb)sb.onclick=closeSheet;
  // swipe-down to dismiss: only starts when the sheet is scrolled to the very top
  let startY=null,curY=0,dragging=false;
  const onStart=e=>{if(sheet.scrollTop>2){startY=null;return;}startY=e.touches?e.touches[0].clientY:e.clientY;curY=0;dragging=false;sheet.style.transition='none';};
  const onMove=e=>{if(startY===null)return;const y=e.touches?e.touches[0].clientY:e.clientY;curY=y-startY;if(curY>0){dragging=true;sheet.style.transform='translateY('+curY+'px)';scrim.style.opacity=Math.max(0,1-curY/400);}};
  const onEnd=()=>{if(startY===null)return;sheet.style.transition='';scrim.style.opacity='';if(curY>120){closeSheet();}else{sheet.style.transform='';}startY=null;dragging=false;};
  sheet.addEventListener('touchstart',onStart,{passive:true});
  sheet.addEventListener('touchmove',onMove,{passive:true});
  sheet.addEventListener('touchend',onEnd);
  // edge-swipe-right to go back (iOS-style): start within 30px of left edge, drag right
  let exStart=null,exDx=0,exActive=false;
  const exOnStart=e=>{const t=e.touches?e.touches[0]:e;if(t.clientX<=30){exStart=t.clientX;exDx=0;exActive=true;sheet.style.transition='none';}else{exStart=null;exActive=false;}};
  const exOnMove=e=>{if(!exActive||exStart===null)return;const t=e.touches?e.touches[0]:e;exDx=t.clientX-exStart;if(exDx>0){sheet.style.transform='translateX('+exDx+'px)';scrim.style.opacity=Math.max(0,1-exDx/400);}};
  const exOnEnd=()=>{if(!exActive){return;}sheet.style.transition='';scrim.style.opacity='';if(exDx>80){closeSheet();}else{sheet.style.transform='';}exStart=null;exActive=false;exDx=0;};
  sheet.addEventListener('touchstart',exOnStart,{passive:true});
  sheet.addEventListener('touchmove',exOnMove,{passive:true});
  sheet.addEventListener('touchend',exOnEnd);
  document.querySelectorAll('.addopt').forEach(b=>b.onclick=()=>{const t=b.dataset.t;if(t==='order')orderForm();else if(t==='expense')expenseForm('biz');else if(t==='home')expenseForm('home');else if(t==='loan')loanForm();else if(t==='bazar')bazarForm();else if(t==='incomegroup')incomeMenu();else if(t==='expensegroup')expenseMenu();else if(t==='event')eventForm();});
}
function closeSheet(){scrim.classList.remove('show');sheet.classList.remove('show');sheet.style.transform='';scrim.style.opacity='';unlockScroll();}
scrim.onclick=closeSheet;
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeSheet();closeSide();}});

let fs={};
function orderForm(existing){
  const o=existing||{};
  // resolve linked customer for prefill of measurements
  let linkedCust = o.customerId?findCustomerById(o.customerId):(o.customer?findCustomerByName(o.customer):null);
  const startM = (existing && existing.m)?existing.m : (linkedCust&&linkedCust.m?linkedCust.m:{});
  fs={payType:o.payType||'Full upfront',channel:o.channel||'In person',orderType:o.orderType||'custom',needsAdj:o.needsAdj||false,delivered:o.delivered||false,currency:o.currency||'local',m:Object.assign({},startM),mOpen:false};
  let profitPanel='';
  if(existing){
    const linked=mem.expenses.filter(e=>(e.orderIds||[]).indexOf(existing.id)>=0);
    const cost=orderCost(existing.id),profit=existing.total-cost;
    const lines=linked.map(e=>{const share=expenseShareForOrder(e,existing.id);const shared=(e.orderIds.length>1);return '<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0"><span>'+e.cat+(shared?' <span style=color:var(--muted)>(split '+e.orderIds.length+')</span>':'')+(e.note?' &middot; '+esc(e.note):'')+'</span><span style="color:var(--accent)">&minus;'+money(share)+'</span></div>';}).join('');
    const bagLine=existing.bagCost?'<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0"><span>Packaging bag</span><span style="color:var(--accent)">&minus;'+money(existing.bagCost)+'</span></div>':'';
    profitPanel='<div class="repcard" style="margin-bottom:8px;padding:14px 16px"><div style="display:flex;justify-content:space-between;align-items:baseline"><span style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)">Profit on this order</span><span style="font-family:Fraunces,serif;font-size:22px;font-weight:600;color:'+(profit>=0?'var(--green)':'var(--accent)')+'">'+(profit<0?'&minus;':'')+money(Math.abs(profit))+'</span></div><div style="font-size:12px;color:var(--muted);margin:4px 0 8px">Sold '+money(existing.total)+' &middot; costs '+money(cost)+'</div>'+(lines||'<div class="hint" style="margin:0">No costs linked yet.</div>')+bagLine+'</div>';
  }
  let html='<h2>'+(existing?'Edit order':'New order')+'</h2>'+profitPanel;
  html+='<label>Order date</label><input id="f_created" type="date" value="'+(o.created||today())+'"><div class="hint" style="margin:4px 0 0">The date this order/income belongs to. Income counts on this date (or delivery date if paid on delivery).</div>';
  html+='<label>Customer name</label><input id="f_cust" list="custlist" value="'+esc(o.customer||'')+'" placeholder="type or pick existing" autocomplete="off"><datalist id="custlist">'+mem.customers.map(c=>'<option value="'+esc(c.name)+'">').join('')+'</datalist><div class="hint" id="f_custhint" style="margin:4px 0 0">Pick an existing name to auto-fill their saved measurements.</div>';
  html+='<label>Phone number</label><input id="f_phone" type="tel" value="'+esc(o.phone||'')+'" placeholder="09...">';
  html+='<label>Cloth type / item</label><input id="f_cloth" value="'+esc(o.clothType||'')+'" placeholder="e.g. Habesha dress">';
  // collapsible measurements section
  const filled=Object.keys(fs.m).filter(k=>fs.m[k]).length;
  html+='<div id="f_mtoggle" class="toggle" style="cursor:pointer"><span class="tl">&#128207; Measurements (cm)'+(filled?' &middot; '+filled+' saved':'')+'</span><span class="sw" style="background:none;width:auto"><span id="f_mcaret" style="font-size:18px">&#9656;</span></span></div>';
  html+='<div id="f_mwrap" style="display:none"><div class="measure-grid">'+MFIELDS.map(f=>'<div><label style="font-size:10.5px">'+f[1]+'</label><input id="fm_'+f[0]+'" type="number" inputmode="decimal" value="'+(fs.m[f[0]]||'')+'" placeholder="cm"></div>').join('')+'</div><div class="hint" style="margin-top:6px">Saved to this customer for next time.</div></div>';
  const curLbl=fs.currency==='foreign'?FCUR():CUR();
  html+='<div class="toggle '+(fs.currency==='foreign'?'on':'')+'" id="f_cur"><span class="tl">Website / foreign order (paid in '+FCUR()+')</span><span class="sw"><i></i></span></div>';
  html+='<label>Price / order total (<span id="f_curl">'+curLbl+'</span>)</label><input id="f_total" type="number" inputmode="decimal" value="'+(o.total||'')+'" placeholder="0">';
  html+='<label>Payment type</label><div class="seg" id="seg_pay">'+['Advance','Full upfront','On delivery','Website'].map(p=>'<button data-pay="'+p+'" class="'+(fs.payType===p?'sel':'')+'">'+p+'</button>').join('')+'</div>';
  html+='<label>Paid so far (<span id="f_curl2">'+curLbl+'</span>)</label><input id="f_paid" type="number" inputmode="decimal" value="'+(o.paid||'')+'" placeholder="0">';
  html+='<div class="balbox"><span class="bl">Remaining</span><span class="bv" id="f_rem">'+curLbl+' 0</span></div>';
  html+='<label>Delivery date</label><input id="f_deliv" type="date" value="'+(o.delivery||'')+'">';
  html+='<div class="toggle '+(fs.needsAdj?'on':'')+'" id="f_adj"><span class="tl">Needs adjustment</span><span class="sw"><i></i></span></div>';
  html+='<div class="toggle '+(fs.delivered?'on':'')+'" id="f_deliv_tog"><span class="tl">Delivered to customer</span><span class="sw"><i></i></span></div>';
  html+='<button class="save" id="f_save">'+(existing?'Save changes':'Add order')+'</button>';
  if(existing && orderRemaining(existing)>0)html+='<button class="ghost" id="f_pay" style="color:var(--green);font-weight:600">&#128176; Add payment ('+money(orderRemaining(existing))+' left)</button>';
  if(existing)html+='<button class="ghost del" id="f_del">Delete order</button>';
  openSheet(html);
  const curOf=()=>fs.currency==='foreign'?FCUR():CUR();
  const upd=()=>{const tot=+$('f_total').value||0,pd=+$('f_paid').value||0;$('f_rem').textContent=curOf()+' '+Math.max(0,tot-pd).toLocaleString();};
  $('f_total').oninput=upd;$('f_paid').oninput=upd;upd();
  $('f_cur').onclick=function(){fs.currency=fs.currency==='foreign'?'local':'foreign';this.classList.toggle('on',fs.currency==='foreign');const l=curOf();$('f_curl').textContent=l;$('f_curl2').textContent=l;upd();};
  document.querySelectorAll('#seg_pay button').forEach(b=>b.onclick=()=>{fs.payType=b.dataset.pay;document.querySelectorAll('#seg_pay button').forEach(x=>x.classList.remove('sel'));b.classList.add('sel');const tot=+$('f_total').value||0;if(b.dataset.pay==='Full upfront'||b.dataset.pay==='Website')$('f_paid').value=tot;if(b.dataset.pay==='On delivery')$('f_paid').value=0;upd();});
  $('f_adj').onclick=function(){fs.needsAdj=!fs.needsAdj;this.classList.toggle('on',fs.needsAdj);};
  $('f_deliv_tog').onclick=function(){fs.delivered=!fs.delivered;this.classList.toggle('on',fs.delivered);};
  // measurements collapsible
  $('f_mtoggle').onclick=function(){fs.mOpen=!fs.mOpen;$('f_mwrap').style.display=fs.mOpen?'block':'none';$('f_mcaret').innerHTML=fs.mOpen?'&#9662;':'&#9656;';};
  // customer pick auto-fills saved measurements & phone
  $('f_cust').onchange=function(){const c=findCustomerByName(this.value);if(c){if(c.phone&&!$('f_phone').value)$('f_phone').value=c.phone;if(c.m){MFIELDS.forEach(f=>{const el=$('fm_'+f[0]);if(el&&c.m[f[0]]!=null)el.value=c.m[f[0]];});$('f_custhint').innerHTML='&#10003; Loaded '+esc(c.name)+' saved measurements &mdash; edit if changed.';}}};
  $('f_save').onclick=async()=>{
    const total=+$('f_total').value||0;if(total<=0){toast('Enter a price');return;}
    let paid=+$('f_paid').value||0;if(paid>total)paid=total;
    const wasDelivered=existing?existing.delivered:false;
    const orderDate=$('f_created').value||today();
    const delivDate=$('f_deliv').value;
    const custName=$('f_cust').value.trim();
    const phone=$('f_phone').value;
    // collect measurements
    const mm={};MFIELDS.forEach(f=>{const v=$('fm_'+f[0]).value;if(v)mm[f[0]]=+v;});
    // create/update the customer profile (only if a name was given)
    let custId=existing?existing.customerId:null;
    if(custName)custId=upsertCustomer(custName,phone,mm);
    const data={created:orderDate,customer:custName,customerId:custId,phone:phone,clothType:$('f_cloth').value,total:total,paid:paid,payType:fs.payType,orderType:fs.orderType,channel:fs.channel,delivery:delivDate,needsAdj:fs.needsAdj,delivered:fs.delivered,currency:fs.currency};
    if(fs.delivered && !wasDelivered){data.delivery=delivDate||today();data.deliveredOn=delivDate||today();}
    else if(fs.delivered && existing){data.deliveredOn=delivDate||existing.deliveredOn||orderDate;}
    if(existing)Object.assign(existing,data);else mem.orders.push(Object.assign({id:uid(),bagCost:bagRate()},data));
    await save();closeSheet();savedTick(existing?'Order updated':'Order saved');render();
  };
  if(existing && orderRemaining(existing)>0)$('f_pay').onclick=()=>orderPaymentForm(existing);
  if(existing)$('f_del').onclick=async()=>{mem.orders=mem.orders.filter(x=>x.id!==existing.id);await save();closeSheet();toast('Deleted');render();};
}

function orderPaymentForm(order){
  const oc=isForeign(order)?FCUR():CUR();const om=n=>hideMoney?(oc+' '+MASK):(oc+' '+Math.round(n).toLocaleString());
  openSheet('<h2>Add payment</h2><div class="hint" style="margin-bottom:6px">'+esc(order.customer||'Order')+' &mdash; '+om(orderRemaining(order))+' remaining of '+om(order.total)+'</div><label>Amount received now ('+oc+')</label><input id="op_amt" type="number" inputmode="decimal" placeholder="0"><div class="seg" id="op_quick" style="margin-top:8px"><button data-q="full">Pay all '+om(orderRemaining(order))+'</button></div><label>Date</label><input id="op_date" type="date" value="'+today()+'"><button class="save" id="op_save">Save payment</button>');
  document.querySelectorAll('#op_quick button').forEach(b=>b.onclick=()=>{$('op_amt').value=orderRemaining(order);});
  $('op_save').onclick=async()=>{const amt=+$('op_amt').value||0;if(amt<=0){toast('Enter an amount');return;}order.paid=Math.min(order.total,order.paid+amt);await save();closeSheet();savedTick(orderRemaining(order)===0?'Fully paid!':'Payment saved');render();};
}

function bazarForm(){
  fs={needsAdj:false,advance:false};
  let html='<h2>Bazar sale (cash)</h2>';
  html+='<div class="hint" style="margin:0 0 6px">Direct cash sale on the spot. Recorded as paid in full unless it needs adjustment.</div>';
  html+='<label>Item / cloth type</label><input id="bz_item" placeholder="e.g. Habesha dress">';
  html+='<label>Customer name (optional)</label><input id="bz_cust" placeholder="walk-in customer">';
  html+='<label>Phone (optional)</label><input id="bz_phone" type="tel" placeholder="09...">';
  html+='<label>Sale price ('+CUR()+')</label><input id="bz_total" type="number" inputmode="decimal" placeholder="0">';
  html+='<div class="toggle" id="bz_adj"><span class="tl">Needs adjustment (deliver later)</span><span class="sw"><i></i></span></div>';
  html+='<div id="bz_adjbox" style="display:none">';
  html+='<div class="toggle" id="bz_advtog"><span class="tl">Took advance payment</span><span class="sw"><i></i></span></div>';
  html+='<label>Amount paid now ('+CUR()+')</label><input id="bz_paid" type="number" inputmode="decimal" placeholder="0">';
  html+='<label>Delivery / pickup date</label><input id="bz_deliv" type="date">';
  html+='</div>';
  html+='<button class="save" id="bz_save">Add bazar sale</button>';
  openSheet(html);
  $('bz_adj').onclick=function(){fs.needsAdj=!fs.needsAdj;this.classList.toggle('on',fs.needsAdj);$('bz_adjbox').style.display=fs.needsAdj?'block':'none';};
  $('bz_advtog').onclick=function(){fs.advance=!fs.advance;this.classList.toggle('on',fs.advance);};
  $('bz_save').onclick=async()=>{
    const total=+$('bz_total').value||0;if(total<=0){toast('Enter sale price');return;}
    let paid=total, deliv='', adj=false;
    if(fs.needsAdj){ adj=true; deliv=$('bz_deliv').value; paid=fs.advance?(+$('bz_paid').value||0):0; if(paid>total)paid=total; }
    mem.orders.push({id:uid(),created:today(),customer:$('bz_cust').value||'Bazar customer',phone:$('bz_phone').value,clothType:$('bz_item').value,total:total,paid:paid,payType:fs.needsAdj?(fs.advance?'Advance':'On delivery'):'Full upfront',orderType:'bazar',channel:'In person',delivery:deliv,needsAdj:adj,bagCost:bagRate()});
    await save();closeSheet();toast('Bazar sale added');render();
  };
}

function expenseForm(scope,existing){
  const e=existing||{};
  const isLoanExp = e.loanId ? true : false;
  if(isLoanExp){
    // loan repayment expense: editable amount/date/note, stays linked to loan
    const loan=mem.loans.find(l=>l.id===e.loanId);
    let html='<h2>Edit loan repayment</h2>';
    html+='<div class="hint" style="margin-bottom:8px">Repayment to <b>'+esc((loan&&loan.lender)||'lender')+'</b>. This is listed as an expense and counts in your spending.</div>';
    html+='<label>Amount ('+CUR()+')</label><input id="le_amt" type="number" inputmode="decimal" value="'+(e.amount||'')+'">';
    html+='<label>Date</label><input id="le_date" type="date" value="'+(e.date||today())+'">';
    html+='<label>Note (optional)</label><input id="le_note" value="'+esc(e.note||'')+'">';
    html+='<button class="save" id="le_save">Save changes</button>';
    html+='<button class="ghost del" id="le_del">Delete this repayment</button>';
    openSheet(html);
    $('le_save').onclick=async()=>{const amt=+$('le_amt').value||0;e.amount=amt;e.date=$('le_date').value;e.note=$('le_note').value;await save();closeSheet();savedTick('Repayment saved');render();};
    $('le_del').onclick=async()=>{if(confirm('Delete this repayment entry? The loan record stays.')){mem.expenses=mem.expenses.filter(x=>x.id!==e.id);await save();closeSheet();toast('Deleted');render();}};
    return;
  }
  const bizCats=[['Fabric','&#129525;'],['Salaries','&#128101;'],['Accessories','&#9988;'],['Transport','&#128666;'],['Bazar','&#128717;'],['Shipment','&#128230;'],['Fuel','&#9981;'],['Other','&middot;']];
  const homeCats=[['Grocery','&#129004;'],['Rent','&#127968;'],['Salaries','&#128101;'],['School','&#127890;'],['Other','&middot;']];
  const cats=scope==='home'?homeCats:bizCats;
  fs={cat:e.cat||cats[0][0],freq:e.freq||'once',orderIds:(e.orderIds||[]).slice()};
  const linkSection=scope==='biz'?buildOrderLinkSection():'';
  let html='<h2>'+(existing?'Edit':scope==='home'?'Home / salary':'Business expense')+'</h2>';
  html+='<label>Category</label><div class="cats">'+cats.map(c=>'<button data-cat="'+c[0]+'" class="'+(fs.cat===c[0]?'sel':'')+'"><span class="ce">'+c[1]+'</span>'+c[0]+'</button>').join('')+'</div>';
  html+='<div id="e_empwrap" style="display:'+(fs.cat==='Salaries'?'block':'none')+'"><label>Employee / person name</label><input id="e_emp" value="'+esc(e.employee||'')+'" placeholder="e.g. Almaz"></div>';
  html+='<label>Amount ('+CUR()+')</label><input id="e_amt" type="number" inputmode="decimal" value="'+(e.amount||'')+'" placeholder="0">';
  html+='<label>Date</label><input id="e_date" type="date" value="'+(e.date||today())+'">'+linkSection;
  html+='<label>Note (optional)</label><input id="e_note" value="'+esc(e.note||'')+'" placeholder="e.g. cotton from Merkato">';
  html+='<label>Repeats?</label><div class="seg" id="seg_freq">'+[['once','One-time'],['week','Weekly'],['month','Monthly'],['quarter','Every 3 months']].map(f=>'<button data-freq="'+f[0]+'" class="'+(fs.freq===f[0]?'sel':'')+'">'+f[1]+'</button>').join('')+'</div>';
  html+='<div class="hint">Recurring costs remind you 2 weeks before they are due.</div>';
  html+='<button class="save" id="e_save">'+(existing?'Save changes':'Add expense')+'</button>';
  if(existing)html+='<button class="ghost del" id="e_del">Delete</button>';
  openSheet(html);
  document.querySelectorAll('.cats button').forEach(b=>b.onclick=()=>{fs.cat=b.dataset.cat;document.querySelectorAll('.cats button').forEach(x=>x.classList.remove('sel'));b.classList.add('sel');$('e_empwrap').style.display=fs.cat==='Salaries'?'block':'none';});
  document.querySelectorAll('#seg_freq button').forEach(b=>b.onclick=()=>{fs.freq=b.dataset.freq;document.querySelectorAll('#seg_freq button').forEach(x=>x.classList.remove('sel'));b.classList.add('sel');});
  if(scope==='biz')wireOrderLink();
  $('e_save').onclick=async()=>{const amount=+$('e_amt').value||0;if(amount<=0){toast('Enter an amount');return;}const rec=fs.freq!=='once';const emp=fs.cat==='Salaries'?($('e_emp').value||''):'';const data={cat:fs.cat,amount:amount,date:$('e_date').value,note:$('e_note').value,employee:emp,scope:scope,recurring:rec,freq:fs.freq,orderIds:scope==='biz'?fs.orderIds.slice():[]};if(existing)Object.assign(existing,data);else mem.expenses.push(Object.assign({id:uid()},data));await save();closeSheet();savedTick(existing?'Expense updated':'Expense saved');render();};
  if(existing)$('e_del').onclick=async()=>{mem.expenses=mem.expenses.filter(x=>x.id!==existing.id);await save();closeSheet();toast('Deleted');render();};
}
function buildOrderLinkSection(){
  const orders=[...mem.orders].sort((a,b)=>b.created.localeCompare(a.created)).slice(0,40);
  if(!orders.length)return '<div class="hint" style="margin-top:14px">No orders yet to link this cost to.</div>';
  const chips=orders.map(o=>'<button type="button" class="ochip" data-oid="'+o.id+'">'+esc(o.customer||'Order')+(o.clothType?' &middot; '+esc(o.clothType):'')+'</button>').join('');
  return '<label>Link to order(s) <span style="text-transform:none;font-weight:400;color:var(--muted)">&mdash; optional</span></label><div class="ochips" id="e_ochips">'+chips+'</div><div class="hint" id="e_splithint">Tag this cost to an order to track true profit. Pick several to split evenly.</div>';
}
function wireOrderLink(){
  const upd=()=>{document.querySelectorAll('.ochip').forEach(c=>c.classList.toggle('sel',fs.orderIds.indexOf(c.dataset.oid)>=0));const amt=+$('e_amt').value||0;const n=fs.orderIds.length;const h=$('e_splithint');if(n===0)h.innerHTML='Tag this cost to an order to track true profit. Pick several to split evenly.';else if(n===1)h.innerHTML='Whole cost assigned to 1 order.';else h.innerHTML='Split evenly: '+money(amt/n)+' to each of '+n+' orders.';};
  document.querySelectorAll('.ochip').forEach(c=>c.onclick=()=>{const id=c.dataset.oid;const i=fs.orderIds.indexOf(id);if(i>=0)fs.orderIds.splice(i,1);else fs.orderIds.push(id);upd();});
  const amtEl=$('e_amt');if(amtEl)amtEl.addEventListener('input',upd);upd();
}

function eventForm(existing){
  const ev=existing||{};
  fs={checklist:(ev.checklist||[]).map(c=>({txt:c.txt,done:c.done}))};
  let html='<h2>'+(existing?'Event':'New event')+'</h2>';
  html+='<label>Event name</label><input id="ev_name" value="'+esc(ev.name||'')+'" placeholder="e.g. Bole fashion show">';
  html+='<label>Event date</label><input id="ev_date" type="date" value="'+(ev.date||'')+'">';
  html+='<label>Location (optional)</label><input id="ev_loc" value="'+esc(ev.location||'')+'" placeholder="e.g. Millennium Hall">';
  html+='<label>Notes (optional)</label><input id="ev_note" value="'+esc(ev.notes||'')+'" placeholder="anything to remember">';
  html+='<label>Prep checklist</label><div id="ev_clist"></div>';
  html+='<div style="display:flex;gap:8px;margin-top:6px"><input id="ev_citem" placeholder="add a task, e.g. prepare 20 dresses" style="flex:1"><button class="seg" id="ev_cadd" style="flex:0 0 auto;width:auto;padding:0 16px;border:1px solid var(--line);border-radius:11px;background:var(--card2);color:var(--ink);font-weight:600">Add</button></div>';
  html+='<button class="save" id="ev_save">'+(existing?'Save event':'Add event')+'</button>';
  if(existing)html+='<button class="ghost del" id="ev_del">Delete event</button>';
  openSheet(html);
  const drawList=()=>{
    const c=$('ev_clist');
    c.innerHTML=fs.checklist.length?fs.checklist.map((it,i)=>'<div class="toggle '+(it.done?'on':'')+'" data-ci="'+i+'" style="margin-top:6px"><span class="tl" style="'+(it.done?'text-decoration:line-through;opacity:.6':'')+'">'+esc(it.txt)+'</span><span style="display:flex;gap:8px;align-items:center"><span class="sw"><i></i></span><span data-cidel="'+i+'" style="color:var(--accent);font-size:20px;padding:0 4px">&times;</span></span></div>').join(''):'<div class="hint" style="margin:4px 0">No tasks yet. Add prep items below.</div>';
    c.querySelectorAll('[data-ci]').forEach(el=>el.onclick=(e)=>{if(e.target.hasAttribute('data-cidel'))return;const i=+el.dataset.ci;fs.checklist[i].done=!fs.checklist[i].done;drawList();});
    c.querySelectorAll('[data-cidel]').forEach(el=>el.onclick=()=>{fs.checklist.splice(+el.dataset.cidel,1);drawList();});
  };
  drawList();
  $('ev_cadd').onclick=()=>{const v=$('ev_citem').value.trim();if(!v)return;fs.checklist.push({txt:v,done:false});$('ev_citem').value='';drawList();};
  $('ev_save').onclick=async()=>{const name=$('ev_name').value.trim(),date=$('ev_date').value;if(!name){toast('Enter event name');return;}if(!date){toast('Pick the event date');return;}const data={name:name,date:date,location:$('ev_loc').value,notes:$('ev_note').value,checklist:fs.checklist};if(existing)Object.assign(existing,data);else mem.events.push(Object.assign({id:uid()},data));await save();closeSheet();toast(existing?'Event saved':'Event added');render();};
  if(existing)$('ev_del').onclick=async()=>{mem.events=mem.events.filter(x=>x.id!==existing.id);await save();closeSheet();toast('Event deleted');render();};
}

function loanForm(existing){
  const l=existing||{};
  let html='<h2>'+(existing?'Loan':'Add a loan')+'</h2><label>Lender / source</label><input id="l_lender" value="'+esc(l.lender||'')+'" placeholder="e.g. Bank, cousin">';
  html+='<label>Total loan amount ('+CUR()+')</label><input id="l_total" type="number" inputmode="decimal" value="'+(l.total||'')+'" placeholder="0" '+(existing?'disabled style="opacity:.5"':'')+'>';
  if(existing)html+='<label>Current balance ('+CUR()+')</label><input id="l_bal" type="number" inputmode="decimal" value="'+l.balance+'">';
  html+='<label>Note (optional)</label><input id="l_note" value="'+esc(l.note||'')+'" placeholder="e.g. monthly due 5th">';
  if(existing)html+='<div class="balbox"><span class="bl">Repaid</span><span class="bv">'+money(loanRepaid(l))+' of '+money(l.total)+'</span></div>';
  html+='<button class="save" id="l_save">'+(existing?'Save':'Add loan')+'</button>';
  if(existing)html+='<button class="ghost" id="l_repay" style="color:var(--purple);font-weight:600">&#65291; Log a repayment</button><button class="ghost del" id="l_del">Delete loan</button>';
  openSheet(html);
  $('l_save').onclick=async()=>{if(existing){existing.lender=$('l_lender').value;existing.note=$('l_note').value;const b=+$('l_bal').value;if(!isNaN(b))existing.balance=Math.max(0,Math.min(existing.total,b));}else{const total=+$('l_total').value||0;if(total<=0){toast('Enter loan amount');return;}mem.loans.push({id:uid(),lender:$('l_lender').value,total:total,balance:total,note:$('l_note').value,created:today()});}await save();closeSheet();toast(existing?'Saved':'Loan added');render();};
  if(existing){$('l_repay').onclick=()=>repayForm(existing);$('l_del').onclick=async()=>{mem.loans=mem.loans.filter(x=>x.id!==existing.id);mem.expenses=mem.expenses.filter(x=>x.loanId!==existing.id);await save();closeSheet();toast('Loan deleted');render();};}
}
function repayForm(loan){
  openSheet('<h2>Repay: '+esc(loan.lender||'loan')+'</h2><div class="hint" style="margin-bottom:6px">'+money(loan.balance)+' remaining</div><label>Repayment amount ('+CUR()+')</label><input id="r_amt" type="number" inputmode="decimal" placeholder="0"><label>Date</label><input id="r_date" type="date" value="'+today()+'"><button class="save" id="r_save">Log repayment</button>');
  $('r_save').onclick=async()=>{const amt=+$('r_amt').value||0;if(amt<=0){toast('Enter an amount');return;}const pay=Math.min(loan.balance,amt);loan.balance=Math.max(0,loan.balance-pay);mem.expenses.push({id:uid(),cat:'Loan repay',amount:pay,date:$('r_date').value,note:loan.lender,scope:'biz',loanId:loan.id,recurring:false,freq:'once'});await save();closeSheet();toast(loan.balance===0?'Loan cleared! &#10003;':'Repayment logged');render();};
}
function bagRateForm(){
  openSheet('<h2>Packaging bag cost</h2><label>Cost per bag ('+CUR()+')</label><input id="bg_rate" type="number" inputmode="decimal" value="'+(bagRate()||'')+'" placeholder="0"><div class="hint">Added automatically to every <b>new</b> order. Include bag fabric + logo print + making cost per bag. Past orders keep their original rate.</div><button class="save" id="bg_save">Save bag rate</button>');
  $('bg_save').onclick=async()=>{const v=+$('bg_rate').value||0;mem.settings.bagRate=v;await save();closeSheet();toast('Bag rate saved');render();};
}
function settingsForm(){
  openSheet('<h2>Settings &amp; account</h2><label>Local currency label</label><input id="s_cur" value="'+esc(CUR())+'" placeholder="Birr, ETB, $..."><label>Website / foreign currency</label><input id="s_fcur" value="'+esc(FCUR())+'" placeholder="USD"><button class="save" id="s_save">Save</button><button class="ghost" id="s_bag" style="margin-top:10px">&#128717; Packaging bag cost: '+(bagRate()>0?money(bagRate()):'not set')+'</button><div class="hint" style="margin-top:18px">Signed in as <b>'+esc(currentEmail||'')+'</b>. Your data lives in the cloud and syncs live with your partner.</div><button class="ghost" id="s_export">&#11015; Download a backup copy</button><button class="ghost del" id="s_signout">Sign out</button>');
  $('s_save').onclick=async()=>{mem.settings.currency=$('s_cur').value||'Birr';mem.settings.fcurrency=$('s_fcur').value||'USD';await save();closeSheet();toast('Saved');render();};
  $('s_bag').onclick=bagRateForm;
  $('s_export').onclick=()=>{const blob=new Blob([JSON.stringify(mem,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='dagmawit-backup-'+today()+'.json';a.click();};
  $('s_signout').onclick=async()=>{await sb.auth.signOut();location.reload();};
}

/* ============================================================
   WIRING
   ============================================================ */
async function deleteEntity(kind,id){
  if(kind==='order')mem.orders=mem.orders.filter(x=>x.id!==id);
  else if(kind==='exp')mem.expenses=mem.expenses.filter(x=>x.id!==id);
  else if(kind==='loan')mem.loans=mem.loans.filter(x=>x.id!==id);
  else if(kind==='cust')mem.customers=mem.customers.filter(x=>x.id!==id);
  else if(kind==='event')mem.events=mem.events.filter(x=>x.id!==id);
  await save();savedTick('Deleted');render();
}
function attachSwipeDelete(){
  const map=[['data-order','order'],['data-exp','exp'],['data-loan','loan'],['data-cust','cust'],['data-event','event']];
  map.forEach(([attr,kind])=>{
    document.querySelectorAll('.item['+attr+']').forEach(item=>{
      if(item.dataset.swipeWired)return; item.dataset.swipeWired='1';
      const id=item.getAttribute(attr);
      item.classList.add('has-swipe');
      const content=document.createElement('div');content.className='swipe-content';
      while(item.firstChild){content.appendChild(item.firstChild);}
      const del=document.createElement('button');del.className='swipe-del';del.textContent='Delete';
      del.onclick=(e)=>{e.stopPropagation();if(confirm('Delete this item?')){deleteEntity(kind,id);}};
      item.appendChild(del);
      item.appendChild(content);
      let sx=null,dx=0,opened=false;const W=88;
      const setX=x=>{content.style.transform='translateX('+x+'px)';};
      const reset=()=>{content.style.transition='transform .2s';setX(0);opened=false;item.classList.remove('swiped');};
      const openIt=()=>{content.style.transition='transform .2s';setX(-W);opened=true;item.classList.add('swiped');};
      content.addEventListener('touchstart',e=>{sx=e.touches[0].clientX;dx=0;content.style.transition='none';},{passive:true});
      content.addEventListener('touchmove',e=>{if(sx===null)return;dx=e.touches[0].clientX-sx;const base=opened?-W:0;const nx=Math.min(0,Math.max(-W,base+dx));setX(nx);},{passive:true});
      content.addEventListener('touchend',()=>{if(sx===null)return;const base=opened?-W:0;const final=base+dx;if(final<-W/2)openIt();else reset();sx=null;
        setTimeout(()=>{document.addEventListener('touchstart',function once(ev){if(!item.contains(ev.target)){reset();}document.removeEventListener('touchstart',once);},{passive:true,once:true});},0);
      });
    });
  });
}
function wireDynamic(){
  attachSwipeDelete();
  document.querySelectorAll('[data-order]').forEach(el=>el.onclick=()=>{const o=mem.orders.find(x=>x.id===el.dataset.order);if(o)orderForm(o);});
  document.querySelectorAll('[data-exp]').forEach(el=>el.onclick=()=>{const e=mem.expenses.find(x=>x.id===el.dataset.exp);if(e){if(e.rollId){toast('Fabric use is recorded — edit the roll or order');}else expenseForm(e.scope,e);}});
  document.querySelectorAll('[data-loan]').forEach(el=>el.onclick=()=>{const l=mem.loans.find(x=>x.id===el.dataset.loan);if(l)loanForm(l);});
  document.querySelectorAll('[data-event]').forEach(el=>el.onclick=()=>{const ev=mem.events.find(x=>x.id===el.dataset.event);if(ev)eventForm(ev);});
  document.querySelectorAll('[data-gran]').forEach(b=>b.onclick=()=>{repGran=b.dataset.gran;render();});
  document.querySelectorAll('[data-expf]').forEach(b=>b.onclick=()=>{expFilter=b.dataset.expf;expCat=null;render();});
  document.querySelectorAll('.tapbar').forEach(b=>b.onclick=()=>{const sc=b.dataset.goscope;expFilter=sc==='home'?'home':'biz';expCat=b.dataset.gocat||null;setTab('expenses');});
  document.querySelectorAll('.tap-pending').forEach(b=>b.onclick=()=>setTab('orders'));
  document.querySelectorAll('[data-gomonth]').forEach(b=>b.onclick=()=>renderMonthDetail(b.dataset.gomonth));
  document.querySelectorAll('[data-mgroup]').forEach(b=>b.onclick=()=>{const ym=b.dataset.mgroup;const body=$('mg_'+ym);if(body){const showing=body.classList.contains('show');body.classList.toggle('show');const c=b.querySelector('.mh-caret');if(c)c.innerHTML=showing?'&#9656;':'&#9662;';}});
  document.querySelectorAll('[data-mgroupx]').forEach(b=>b.onclick=()=>{const ym=b.dataset.mgroupx;const body=$('xg_'+ym);if(body){const showing=body.classList.contains('show');body.classList.toggle('show');const c=b.querySelector('.mh-caret');if(c)c.innerHTML=showing?'&#9656;':'&#9662;';}});
  const ecc=$('exp_clearcat');if(ecc)ecc.onclick=()=>{expCat=null;render();};
  const cs=$('cust_search');if(cs)cs.oninput=()=>{custSearch=cs.value;const v=renderMeasurements();const view=$('view');view.innerHTML=v;wireDynamic();const cs2=$('cust_search');if(cs2){cs2.focus();cs2.setSelectionRange(cs2.value.length,cs2.value.length);}};
  const ca=$('cust_add');if(ca)ca.onclick=()=>customerForm();
  document.querySelectorAll('[data-cust]').forEach(el=>el.onclick=()=>{const c=mem.customers.find(x=>x.id===el.dataset.cust);if(c)customerForm(c);});
  const sb2=$('setBtn');if(sb2)sb2.onclick=settingsForm;
}
document.querySelectorAll('nav button[data-tab]').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
// hamburger side menu
function openSide(){$('sideScrim').classList.add('show');$('sideMenu').classList.add('show');lockScroll();}
function closeSide(){const sm=$('sideMenu');$('sideScrim').classList.remove('show');sm.classList.remove('show');sm.style.transform='';unlockScroll();}
$('menuBtn').onclick=openSide;
(function(){
  const eb=$('eyeBtn');
  function paint(){eb.innerHTML=hideMoney?'&#128584;':'&#128065;';eb.classList.toggle('on',hideMoney);}
  paint();
  eb.onclick=()=>{hideMoney=!hideMoney;try{localStorage.setItem('dagmawit:hideMoney',hideMoney?'1':'0');}catch(e){}paint();render();toast(hideMoney?'Money hidden':'Money shown');};
})();
// swipe-left to close the side menu
(function(){
  const sm=$('sideMenu');let sx=null,dx=0;
  sm.addEventListener('touchstart',e=>{sx=e.touches[0].clientX;dx=0;sm.style.transition='none';},{passive:true});
  sm.addEventListener('touchmove',e=>{if(sx===null)return;dx=e.touches[0].clientX-sx;if(dx<0){sm.style.transform='translateX('+dx+'px)';}},{passive:true});
  sm.addEventListener('touchend',()=>{if(sx===null)return;sm.style.transition='';if(dx<-70){closeSide();}else{sm.style.transform='';}sx=null;});
})();
$('sideClose').onclick=closeSide;
$('sideScrim').onclick=closeSide;
document.querySelectorAll('.sideitem').forEach(b=>b.onclick=()=>{const go=b.dataset.go;closeSide();if(go==='settings'){settingsForm();}else{setTab(go);}});
$('addBtn').onclick=()=>openSheet('<h2>Add</h2>'
  +'<div class="addsection">Income</div><div class="addgrid">'
  +'<button class="addopt" data-t="order"><span class="ce">&#10022;</span>Customer order</button>'
  +'<button class="addopt" data-t="bazar"><span class="ce">&#129509;</span>Bazar sale</button>'
  +'</div>'
  +'<div class="addsection">Expense</div><div class="addgrid">'
  +'<button class="addopt" data-t="expense"><span class="ce">&#128666;</span>Business expense</button>'
  +'<button class="addopt" data-t="home"><span class="ce">&#127968;</span>Household expense</button>'
  +'</div>'
  +'<div class="addsection">More</div><div class="addgrid">'
  +'<button class="addopt" data-t="event"><span class="ce">&#127881;</span>Event</button>'
  +'<button class="addopt" data-t="loan"><span class="ce">&#9672;</span>Loan</button>'
  +'</div>');
function incomeMenu(){openSheet('<h2>Add income</h2><div class="cats" style="grid-template-columns:repeat(2,1fr)"><button class="addopt" data-t="order"><span class="ce">&#10022;</span>Customer order</button><button class="addopt" data-t="bazar"><span class="ce">&#129509;</span>Bazar sale (cash)</button></div><div class="hint" style="margin-top:14px;text-align:center">A <b>customer order</b> may be paid in advance, on delivery, or in parts &mdash; open the order later to add payments. A <b>bazar sale</b> is direct cash on the spot.</div>');}
function expenseMenu(){openSheet('<h2>Add expense</h2><div class="cats" style="grid-template-columns:repeat(2,1fr)"><button class="addopt" data-t="expense"><span class="ce">&#128666;</span>Business expense</button><button class="addopt" data-t="home"><span class="ce">&#127968;</span>Household expense</button><button class="addopt" data-t="loan"><span class="ce">&#9672;</span>Loan</button></div><div class="hint" style="margin-top:14px;text-align:center">Business and household are tracked separately in your reports. Fabric, thread, buttons, transport &mdash; all go under Business expense.</div>');}

/* ============================================================
   AUTH FLOW
   ============================================================ */
let currentEmail='';
function showAuth(msg,cls){$('loadingView').style.display='none';$('appView').style.display='none';$('authView').style.display='flex';if(msg){const m=$('au_msg');m.textContent=msg;m.className='auth-msg '+(cls||'');}}
function showApp(){$('loadingView').style.display='none';$('authView').style.display='none';$('appView').style.display='block';}

async function bootSession(){
  const {data:{session}} = await sb.auth.getSession();
  if(!session){ showAuth(''); return; }
  currentEmail = session.user.email;
  $('loadingView').style.display='flex';
  const ok = await cloudLoad();
  if(!ok){ toast('Could not load data'); }
  subscribeRealtime();
  showApp(); setSync('synced'); render();
}

$('au_signin').onclick=async()=>{
  const email=$('au_email').value.trim(),pass=$('au_pass').value;
  if(!email||!pass){showAuth('Enter email and password','err');return;}
  $('au_signin').disabled=true;
  const {error}=await sb.auth.signInWithPassword({email,password:pass});
  $('au_signin').disabled=false;
  if(error){showAuth(error.message,'err');return;}
  bootSession();
};
$('au_signup').onclick=async()=>{
  const email=$('au_email').value.trim(),pass=$('au_pass').value;
  if(!email||pass.length<6){showAuth('Enter email and a password of at least 6 characters','err');return;}
  $('au_signup').disabled=true;
  const {error}=await sb.auth.signUp({email,password:pass});
  $('au_signup').disabled=false;
  if(error){showAuth(error.message,'err');return;}
  showAuth('Account created. If email confirmation is on, check your inbox, then sign in.','ok');
};

/* ============================================================
   START
   ============================================================ */
(function start(){
  if(configError){ showAuth(configError,'err'); $('au_signin').disabled=true; $('au_signup').disabled=true; return; }
  bootSession();
})();
