// ======= CONFIG =======
const API_BASE = "http://localhost:8000";

// ======= CHAIN CONFIG (kept but unused if no button exists) =======
const CONTRACT_ADDRESS = "0xYOUR_DEPLOYED_CONTRACT_ADDRESS";
const CONTRACT_ABI = [ /* … unchanged … */ ];
const DEMO_MODE = true;

// ======= STATE =======
let users = [];
let currentUser = null;
let providerPrice = 0.20;
let suggestedSell = 0.19;

let wallet = { provider:null, signer:null, account:null, contract:null };

// ======= CHARTS =======
let chartProvider, chartBalance, chartSurplus;
let energyUsageChart, energyProductionChart;

let providerSeries = [];
let balanceSeries = [];
let surplusSeries = [];
let usageSeries = [];
let productionSeries = [];

const MAX_POINTS = 145;

// ======= BOOT =======
document.addEventListener('DOMContentLoaded', async () => {
  setupNavWithAnimations();

  // Connect button may not exist anymore (we removed it in HTML)
  const connectBtn = document.getElementById('btnConnect');
  if (connectBtn) connectBtn.addEventListener('click', connectWallet);

  await loadUsers();
  buildUserSelect();

  // Always select a user if available
  const sel = document.getElementById('userSelect');
  if (sel && sel.options.length > 0) {
    selectUser(sel.value);
  }

  const fundBtn = document.getElementById('btnFund');
  if (fundBtn) fundBtn.addEventListener('click', onFund);
  const sellBtn = document.getElementById('btnSell');
  if (sellBtn) sellBtn.addEventListener('click', onSell);

  setupChartsOnce();

  await refreshAll();
  await updateChartsFromMetrics();

  setInterval(async () => {
    await refreshAll();
    await updateChartsFromMetrics();
  }, 15000);
});

// ======= WALLET (unchanged; harmless if no button) =======
async function connectWallet(){
  if (!window.ethereum) return alert("MetaMask not found.");
  try {
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    wallet.account = accounts[0];
    wallet.provider = new ethers.BrowserProvider(window.ethereum);
    wallet.signer = await wallet.provider.getSigner();
    wallet.contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, wallet.signer);
    const btn = document.getElementById('btnConnect');
    if (btn) btn.textContent = shorten(wallet.account);
  } catch (e) {
    console.error(e);
    alert("Wallet connection failed");
  }
}
function shorten(addr){ return addr ? `${addr.slice(0,6)}…${addr.slice(-4)}` : ""; }

// ======= NAV =======
function setupNavWithAnimations(){
  const buttons = document.querySelectorAll('.nav-btn');
  buttons.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      buttons.forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const next = btn.dataset.page;
      document.querySelectorAll('.page').forEach(p=>{
        if (p.id === `page-${next}`) {
          p.classList.add('show'); p.offsetHeight; p.classList.add('enter');
        } else {
          p.classList.remove('enter'); p.classList.remove('show');
        }
      });
      if(next==='marketplace') refreshMarketplace();
    });
  });
}

// ======= USERS =======
async function loadUsers(){
  try {
    const res = await fetch(`${API_BASE}/users`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    users = await res.json();
  } catch (e) {
    console.error('Failed to load users:', e);
    users = [];
  }
}

function normalizeRole(u){
  // handle role field variations gracefully
  const r = String(u.role ?? u.user_role ?? u.type ?? '').toLowerCase();
  return r;
}

function buildUserSelect(){
  const sel = document.getElementById('userSelect');
  if (!sel) { console.error('#userSelect not found in DOM'); return; }

  sel.innerHTML = '';

  // Prefer non-providers; if that empties the list, show all
  let list = users.filter(u => normalizeRole(u) !== 'provider');
  if (list.length === 0) list = users.slice();

  list.forEach(u=>{
    const opt = document.createElement('option');
    opt.value = String(u.id);
    const label = u.email || u.username || `User #${u.id}`;
    opt.textContent = `${label}`;
    sel.appendChild(opt);
  });

  sel.onchange = () => selectUser(sel.value);
}

async function selectUser(userId){
  const id = Number(userId);
  currentUser = users.find(u => u.id === id);
  if (!currentUser) { console.warn('User not found for id', id); return; }

  await hydrateChartsForUser(id);
  await refreshAll();
}

// ======= REFRESH ALL =======
async function refreshAll(){
  if(!currentUser) return;
  await Promise.all([
    refreshStatus(),
    refreshMarketplace(),
    refreshTrades(),
    refreshSellPane()
  ]);
}

// ======= DASHBOARD =======
async function refreshStatus(){
  if (!currentUser) return;
  let data = null;
  try {
    const r = await fetch(`${API_BASE}/status/extended?user_id=${currentUser.id}`);
    if (r.ok) data = await r.json();
  } catch {}
  if (!data || typeof data.balance_eur !== 'number') {
    try {
      const r2 = await fetch(`${API_BASE}/status/${currentUser.id}`);
      if (r2.ok) {
        const s2 = await r2.json();
        data = {
          balance_eur: Number(s2.balance_eur) || 0,
          available_kwh: Number(s2.stored_surplus_kwh) || 0
        };
      }
    } catch {}
  }
  if (!data) return;
  const balEl = document.getElementById('balance');
  const surEl = document.getElementById('surplus');
  if (balEl) balEl.textContent = Number(data.balance_eur).toFixed(2);
  if (surEl) surEl.textContent = Number(data.available_kwh).toFixed(2);
}

async function onFund(){
  if (!currentUser) return;
  const amtEl = document.getElementById('fundAmount');
  const amt = parseFloat((amtEl && amtEl.value) || '0');
  if(!(amt>0)) return alert('Enter a positive amount.');
  const res = await fetch(`${API_BASE}/users/${currentUser.id}/fund/${amt}`, { method:'POST' });
  if(!res.ok){
    const j = await res.json().catch(()=>({}));
    return alert(j.detail || 'Fund failed');
  }
  if (amtEl) amtEl.value = '';
  await refreshStatus();
}

// ======= TRADES =======
async function refreshTrades(){
  if (!currentUser) return;
  const r = await fetch(`${API_BASE}/trades?user_id=${currentUser.id}`);
  const trades = await r.json();
  const ul = document.getElementById('tradesList');
  if (!ul) return;
  ul.innerHTML = '';
  trades.slice(0,6).forEach(t=>{
    const li = document.createElement('li');
    li.innerHTML = `
      <span>#${t.id} • ${Number(t.kwh).toFixed(2)} kWh</span>
      <span>€${Number(t.total_eur).toFixed(2)} • ${new Date(t.ts*1000).toLocaleTimeString()}</span>
    `;
    ul.appendChild(li);
  });
}

// ======= MARKETPLACE =======
async function refreshMarketplace(){
  const grid = document.getElementById('marketGrid');
  if (!grid) return;
  const r = await fetch(`${API_BASE}/offers`);
  const items = await r.json();

  const providers = items.filter(it=>it.kind==='provider');
  const offers    = items.filter(it=>it.kind==='household');

  if (providers.length>0){
    providerPrice = providers[0].price_eur_per_kwh;
    suggestedSell = Math.max(0.01, providerPrice * 0.98);
    const sp = document.getElementById('suggestedPrice');
    if (sp) sp.textContent = providerPrice.toFixed(2);
  }

  grid.innerHTML = '';

  // Providers (pinned)
  providers.slice(0,2).forEach(p=>{
    const col = document.createElement('div');
    col.className = 'col-12 col-md-6 col-lg-4';
    col.innerHTML = `
      <div class="card mkt-card provider h-100">
        <div class="card-body d-flex flex-column gap-2">
          <div class="d-flex justify-content-between align-items-center">
            <span class="badge text-bg-success-subtle border">PROVIDER</span>
            <strong>${p.provider_name}</strong>
          </div>
          <div class="fs-5 fw-bold text-success">€${p.price_eur_per_kwh.toFixed(3)} / kWh</div>
          <small class="text-muted">Always available • Hourly dynamic price</small>
          <div class="d-flex gap-2 mt-1">
            <input type="number" step="0.1" min="0.1" placeholder="kWh" class="form-control" disabled>
            <button class="btn btn-secondary" disabled>Buy</button>
          </div>
        </div>
      </div>
    `;
    grid.appendChild(col);
  });

  // Household offers
  offers.forEach(o=>{
    const isMine = currentUser && (o.seller_id === currentUser.id);
    const col = document.createElement('div');
    col.className = 'col-12 col-md-6 col-lg-4';
    col.innerHTML = `
      <div class="card mkt-card h-100">
        <div class="card-body d-flex flex-column gap-2">
          <div class="d-flex justify-content-between align-items-center">
            <span class="badge text-bg-light border">HOUSEHOLD</span>
            <span class="small text-muted">Seller #${o.seller_id}</span>
          </div>
          <div class="fs-5 fw-bold text-success">€${o.price_eur_per_kwh.toFixed(3)} / kWh</div>
          <div class="text-muted">Remaining: ${o.kwh_remaining.toFixed(3)} kWh</div>
          <div class="d-flex gap-2 mt-auto">
            <input type="number" step="0.1" min="0.1" placeholder="kWh" class="form-control" ${isMine?'disabled':''}>
            <button class="btn btn-success" ${isMine?'disabled':''}>Buy</button>
          </div>
        </div>
      </div>
    `;
    const input = col.querySelector('input');
    const btn = col.querySelector('button');
    btn.addEventListener('click', async ()=>{
      const k = parseFloat((input && input.value) || '0');
      if(!(k>0)) return alert('Enter kWh > 0');
      await buyHousehold(o.offer_id, Math.min(k, o.kwh_remaining), o.price_eur_per_kwh);
    });
    grid.appendChild(col);
  });
}

async function buyHousehold(offerId, kwh, unitPrice){
  let res = await fetch(`${API_BASE}/accept`,{
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ buyer_id: currentUser.id, offer_id: offerId, kwh })
  });

  if(!res.ok){
    const j = await res.json().catch(()=>({}));
    if((j.detail||'').toLowerCase().includes('insufficient')){
      const need = Math.ceil((kwh*unitPrice + 0.5)*100)/100;
      await fetch(`${API_BASE}/users/${currentUser.id}/fund/${need}`, {method:'POST'});
      res = await fetch(`${API_BASE}/accept`,{
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ buyer_id: currentUser.id, offer_id: offerId, kwh })
      });
    }
  }

  if(!res.ok){
    const j = await res.json().catch(()=>({}));
    return alert(j.detail || 'Purchase failed');
  }

  const trade = await res.json();

  // Optional on-chain audit (safe if wallet button removed)
  try {
    const txHash = await auditOnChain(trade);
    if (txHash) {
      await fetch(`${API_BASE}/chain/trade-confirm`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ trade_id: trade.id, tx_hash: txHash })
      });
    }
  } catch (e) { console.warn("On-chain audit skipped/failed:", e); }

  await Promise.all([refreshStatus(), refreshMarketplace(), refreshTrades(), refreshSellPane()]);
}

// ======= SELL PAGE =======
async function refreshSellPane(){
  if (!currentUser) return;
  const r = await fetch(`${API_BASE}/status/${currentUser.id}`);
  const s = await r.json();
  const ss = document.getElementById('sellSurplus');
  const sp = document.getElementById('suggestedPrice');
  if (ss) ss.textContent = s.stored_surplus_kwh.toFixed(2);
  if (sp) sp.textContent = providerPrice.toFixed(2);
  const pInput = document.getElementById('sellPrice');
  if(pInput && !pInput.value) pInput.value = (providerPrice*0.98).toFixed(2);
}

async function onSell(){
  if (!currentUser) return;
  const kEl = document.getElementById('sellKwh');
  const pEl = document.getElementById('sellPrice');
  const kwh = parseFloat((kEl && kEl.value) || '0');
  const price = parseFloat((pEl && pEl.value) || '0');
  if(!(kwh>0 && price>0)) return alert('Enter kWh>0 and price>0');
  const res = await fetch(`${API_BASE}/offers`,{
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ seller_id: currentUser.id, kwh, price_eur_per_kwh: price })
  });
  const j = await res.json().catch(()=>({}));
  if(!res.ok) return alert(j.detail || 'Failed to create offer (role must be both/producer).');
  if (kEl) kEl.value = '';
  await Promise.all([refreshMarketplace(), refreshStatus(), refreshSellPane()]);
}

// ======= ON-CHAIN AUDIT HELPERS (unchanged) =======
function canonicalTradeString(t){
  const obj = {
    id: Number(t.id), offer_id: Number(t.offer_id), buyer_id: Number(t.buyer_id),
    kwh: Number(t.kwh), total_eur: Number(t.total_eur), ts: Number(t.ts)
  };
  return JSON.stringify(obj);
}
async function sha256Hex(str){
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(str));
  const bytes = Array.from(new Uint8Array(buf));
  return "0x" + bytes.map(b => b.toString(16).padStart(2,'0')).join('');
}
async function auditOnChain(trade){
  const data = canonicalTradeString(trade);
  const hashHex = await sha256Hex(data);
  if (wallet.contract && wallet.signer) {
    try {
      const tx = await wallet.contract.logTradeHash(trade.id, hashHex);
      const receipt = await tx.wait();
      console.info("Audit event tx (real):", receipt.transactionHash);
      return receipt.transactionHash;
    } catch (err) { console.warn("On-chain audit failed:", err); }
  }
  if (DEMO_MODE) {
    const buf = crypto.getRandomValues(new Uint8Array(32));
    const fake = "0x" + Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
    console.info("Demo-mode fake tx hash:", fake, "for trade", trade.id);
    return fake;
  }
  return null;
}

// ======= CHARTS =======
function setupChartsOnce(){
  chartProvider = initializeChartById('chartProvider', '€/kWh', '#2563eb');
  chartBalance  = initializeChartById('chartBalance',  '€',     '#10b981');
  chartSurplus  = initializeChartById('chartSurplus',  'kWh',   '#f59e0b');
  energyUsageChart      = initializeChartById('energyUsageChart',      'Energy Usage',      '#007bff');
  energyProductionChart = initializeChartById('energyProductionChart', 'Energy Production', '#28a745');
}

function initializeChartById(canvasId, label, color) {
  const ctx = document.getElementById(canvasId).getContext('2d');
  return new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [{
      label, data: [],
      borderColor: color, backgroundColor: hexToRGBA(color, 0.2), fill: true,
      borderWidth: 2, pointRadius: 0, pointHoverRadius: 3, pointHitRadius: 8, tension: 0.35
    }]},
    options: {
      responsive: true, maintainAspectRatio: false, normalized: true, spanGaps: true,
      animation: { duration: 300, easing: "easeOutCubic" },
      elements: { line: { tension: 0.35 } },
      plugins: {
        legend: { display: true, position: 'top', labels: { font: { size: 14, family: 'Poppins' }, color: '#333' } },
        tooltip: {
          mode: 'index', intersect: false,
          callbacks: { label: (c) => {
            const unit = (label.includes('€') || label==='€') ? '€' : 'kWh';
            return `${c.dataset.label}: ${(+c.raw).toFixed(2)} ${unit}`;
          } }
        },
        decimation: { enabled: true, algorithm: 'lttb', samples: 200 }
      },
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } }
      }
    }
  });
}

function updateChartData(chart, series) {
  chart.data.labels = series.map(d => d.time);
  chart.data.datasets[0].data = series.map(d => d.value);
  chart.update();
}

// visual smoothing
function smoothSeries(series, window = 3) {
  if (!series || series.length === 0 || window <= 1) return series;
  const half = Math.floor(window / 2);
  const out = [];
  for (let i = 0; i < series.length; i++) {
    let sum = 0, cnt = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j >= 0 && j < series.length) { sum += series[j].value; cnt++; }
    }
    out.push({ t: series[i].t, time: series[i].time, value: sum / cnt });
  }
  return out;
}

function hexToRGBA(hex, a) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
function pushCapped(series, point){ series.push(point); if (series.length > MAX_POINTS) series.shift(); }
function tsToLabel(ts){ return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

// Seed full 12h history (usage, production, surplus) from API
async function hydrateChartsForUser(userId){
  // Provider 12h
  try {
    const pr = await (await fetch(`${API_BASE}/provider/series?hours=12`)).json();
    if (Array.isArray(pr.points)) {
      providerSeries = pr.points.map(p => ({ time: tsToLabel(p.ts), value: +Number(p.price_eur_per_kwh).toFixed(3) }));
      updateChartData(chartProvider, providerSeries);
      if (pr.points.length) providerPrice = pr.points.at(-1).price_eur_per_kwh;
    }
  } catch (e) { console.warn('provider/series hydrate failed', e); }

  // User meter 12h
  try {
    const mr = await (await fetch(`${API_BASE}/meter/series?user_id=${userId}&hours=12`)).json();
    const samples = Array.isArray(mr.samples) ? mr.samples : [];
    usageSeries      = samples.map(s => ({ time: tsToLabel(s.ts), value: +Number(s.consumption_kwh).toFixed(2) }));
    productionSeries = samples.map(s => ({ time: tsToLabel(s.ts), value: +Number(s.production_kwh).toFixed(2) }));
    surplusSeries    = samples.map(s => ({ time: tsToLabel(s.ts), value: +Number(s.surplus_kwh).toFixed(2) }));

    updateChartData(energyUsageChart,      smoothSeries(usageSeries, 3));
    updateChartData(energyProductionChart, smoothSeries(productionSeries, 3));
    updateChartData(chartSurplus,          smoothSeries(surplusSeries, 3));
  } catch (e) { console.warn('meter/series hydrate failed', e); }

  // Balance seed point
  try {
    const s = await (await fetch(`${API_BASE}/status/${userId}`)).json();
    const label = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    balanceSeries = [{ time: label, value: +Number(s.balance_eur).toFixed(2) }];
    updateChartData(chartBalance, balanceSeries);
  } catch (e) { console.warn('balance seed failed', e); }
}

// Live updates every 15s
async function updateChartsFromMetrics() {
  if (!currentUser) return;
  const label = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});

  // Provider price
  try {
    const market = await (await fetch(`${API_BASE}/offers`)).json();
    const providers = market.filter(m => m.kind === 'provider');
    if (providers.length > 0) providerPrice = providers[0].price_eur_per_kwh;
  } catch {}
  pushCapped(providerSeries, { time: label, value: +providerPrice.toFixed(3) });
  updateChartData(chartProvider, providerSeries);

  // Balance
  try {
    const s = await (await fetch(`${API_BASE}/status/${currentUser.id}`)).json();
    pushCapped(balanceSeries, { time: label, value: +s.balance_eur.toFixed(2) });
    updateChartData(chartBalance, balanceSeries);
  } catch {}

  // Usage, Production, and Surplus from latest meter sample
  const { usage, production } = await fetchLatestProdCons(currentUser.id);
  const surplusNow = Math.max(0, +(production - usage).toFixed(2));
  pushCapped(usageSeries,      { time: label, value: +usage.toFixed(2) });
  pushCapped(productionSeries, { time: label, value: +production.toFixed(2) });
  pushCapped(surplusSeries,    { time: label, value: surplusNow });

  updateChartData(energyUsageChart,      smoothSeries(usageSeries, 3));
  updateChartData(energyProductionChart, smoothSeries(productionSeries, 3));
  updateChartData(chartSurplus,          smoothSeries(surplusSeries, 3));
}

async function fetchLatestProdCons(userId) {
  try {
    const r = await fetch(`${API_BASE}/meter/last?user_id=${userId}`);
    if (r.ok) {
      const m = await r.json();
      return {
        production: Math.max(0, +m.production_kwh || 0),
        usage: Math.max(0, +m.consumption_kwh || 0)
      };
    }
  } catch (_) {}
  const lastU = usageSeries.length ? usageSeries.at(-1).value : 2.5;
  const lastP = productionSeries.length ? productionSeries.at(-1).value : 3.5;
  const clamp = (x,min,max)=>Math.max(min, Math.min(max, x));
  return {
    usage: clamp(lastU + (Math.random()-0.5)*0.6, 0, 6),
    production: clamp(lastP + (Math.random()-0.5)*0.8, 0, 8)
  };
}

