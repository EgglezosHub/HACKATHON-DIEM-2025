// ======= CONFIG =======
const API_BASE = "http://localhost:8000";

// ======= STATE =======
let users = [];
let currentUser = null;
let providerPrice = 0.20;   // from backend providers (for suggestions)
let suggestedSell = 0.19;

// ======= CHARTS =======
let chartProvider, chartBalance, chartSurplus;
let energyUsageChart, energyProductionChart;

let providerSeries = [];    // [{time, value}]
let balanceSeries = [];
let surplusSeries = [];
let usageSeries = [];
let productionSeries = [];

const MAX_POINTS = 24;      // cap so charts don’t grow indefinitely

// ======= BOOT =======
document.addEventListener('DOMContentLoaded', async () => {
  setupNavWithAnimations();
  await loadUsers();
  buildUserSelect();
  selectUser(document.getElementById('userSelect').value);

  document.getElementById('btnFund').addEventListener('click', onFund);
  document.getElementById('btnSell').addEventListener('click', onSell);

  setupChartsOnce();                 // init all 5 charts

  await refreshAll();                // first data pass
  await updateChartsFromMetrics();   // first chart points

  // poll to keep everything fresh
  setInterval(async () => {
    await refreshAll();
    await updateChartsFromMetrics();
  }, 15000);
});

// ======= NAV (with animations) =======
function setupNavWithAnimations(){
  const buttons = document.querySelectorAll('.nav-btn');
  buttons.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      buttons.forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');

      const next = btn.dataset.page;
      document.querySelectorAll('.page').forEach(p=>{
        if (p.id === `page-${next}`) {
          p.classList.add('show');
          // restart CSS animation
          // eslint-disable-next-line no-unused-expressions
          p.offsetHeight;
          p.classList.add('enter');
        } else {
          p.classList.remove('enter');
          p.classList.remove('show');
        }
      });

      if(next==='marketplace') refreshMarketplace();
    });
  });
}

// ======= USERS =======
async function loadUsers(){
  const res = await fetch(`${API_BASE}/users`);
  users = await res.json();
}

function buildUserSelect(){
  const sel = document.getElementById('userSelect');
  sel.innerHTML = '';
  users.filter(u => u.role !== 'provider').forEach(u=>{
    const opt = document.createElement('option');
    opt.value = String(u.id);
    opt.textContent = `${u.email} (${u.role})`;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', ()=>selectUser(sel.value));
}

async function selectUser(userId){
  const id = Number(userId);
  currentUser = users.find(u=>u.id===id);
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
  const r = await fetch(`${API_BASE}/status/${currentUser.id}`);
  const s = await r.json();
  document.getElementById('balance').textContent = s.balance_eur.toFixed(2);
  document.getElementById('surplus').textContent = s.stored_surplus_kwh.toFixed(2);
}

async function onFund(){
  const amt = parseFloat(document.getElementById('fundAmount').value || '0');
  if(!(amt>0)) return alert('Enter a positive amount.');
  const res = await fetch(`${API_BASE}/users/${currentUser.id}/fund/${amt}`, { method:'POST' });
  if(!res.ok){
    const j = await res.json().catch(()=>({}));
    return alert(j.detail || 'Fund failed');
  }
  document.getElementById('fundAmount').value = '';
  await refreshStatus();
}

// ======= TRADES (as buyer) =======
async function refreshTrades(){
  const r = await fetch(`${API_BASE}/trades?user_id=${currentUser.id}`);
  const trades = await r.json();
  const ul = document.getElementById('tradesList');
  ul.innerHTML = '';
  trades.slice(0,6).forEach(t=>{
    const li = document.createElement('li');
    li.innerHTML = `
      <span>#${t.id} • ${t.kwh.toFixed(2)} kWh</span>
      <span>€${t.total_eur.toFixed(2)} • ${new Date(t.ts*1000).toLocaleTimeString()}</span>
    `;
    ul.appendChild(li);
  });
}

// ======= MARKETPLACE =======
async function refreshMarketplace(){
  const r = await fetch(`${API_BASE}/offers`);
  const items = await r.json();

  const providers = items.filter(it=>it.kind==='provider');
  const offers = items.filter(it=>it.kind==='household');

  if (providers.length>0){
    providerPrice = providers[0].price_eur_per_kwh;
    suggestedSell = Math.max(0.01, providerPrice * 0.98);
    document.getElementById('suggestedPrice').textContent = providerPrice.toFixed(2);
  }

  const grid = document.getElementById('marketGrid');
  grid.innerHTML = '';

  // top pinned providers (2)
  providers.slice(0,2).forEach(p=>{
    const card = document.createElement('div');
    card.className = 'card mkt-card provider';
    card.innerHTML = `
      <div class="mkt-top">
        <span class="badge">PROVIDER</span>
        <strong>${p.provider_name}</strong>
      </div>
      <div class="price">€${p.price_eur_per_kwh.toFixed(3)} / kWh</div>
      <small class="hint">Always available • Hourly dynamic price</small>
      <div class="buy-row">
        <input type="number" step="0.1" min="0.1" placeholder="kWh" disabled>
        <button disabled title="Provider buying requires backend endpoint">Buy</button>
      </div>
    `;
    grid.appendChild(card);
  });

  // household offers
  offers.forEach(o=>{
    const isMine = o.seller_id === currentUser.id;
    const card = document.createElement('div');
    card.className = 'card mkt-card';
    card.innerHTML = `
      <div class="mkt-top">
        <span class="badge">HOUSEHOLD</span>
        <span>Seller #${o.seller_id}</span>
      </div>
      <div class="price">€${o.price_eur_per_kwh.toFixed(3)} / kWh</div>
      <div>Remaining: ${o.kwh_remaining.toFixed(3)} kWh</div>
      <div class="buy-row">
        <input type="number" step="0.1" min="0.1" placeholder="kWh" ${isMine?'disabled':''}>
        <button ${isMine?'disabled':''}>Buy</button>
      </div>
    `;
    const input = card.querySelector('input');
    const btn = card.querySelector('button');
    btn.addEventListener('click', async ()=>{
      const k = parseFloat(input.value || '0');
      if(!(k>0)) return alert('Enter kWh > 0');
      await buyHousehold(o.offer_id, Math.min(k, o.kwh_remaining), o.price_eur_per_kwh);
    });
    grid.appendChild(card);
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
  alert(`Purchased ${kwh.toFixed(2)} kWh`);
  await Promise.all([refreshStatus(), refreshMarketplace(), refreshTrades()]);
}

// ======= SELL PAGE =======
async function refreshSellPane(){
  const r = await fetch(`${API_BASE}/status/${currentUser.id}`);
  const s = await r.json();
  document.getElementById('sellSurplus').textContent = s.stored_surplus_kwh.toFixed(2);
  document.getElementById('suggestedPrice').textContent = providerPrice.toFixed(2);
  const pInput = document.getElementById('sellPrice');
  if(!pInput.value) pInput.value = (providerPrice*0.98).toFixed(2);
}

async function onSell(){
  const kwh = parseFloat(document.getElementById('sellKwh').value || '0');
  const price = parseFloat(document.getElementById('sellPrice').value || '0');
  if(!(kwh>0 && price>0)) return alert('Enter kWh>0 and price>0');
  const res = await fetch(`${API_BASE}/offers`,{
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ seller_id: currentUser.id, kwh, price_eur_per_kwh: price })
  });
  const j = await res.json().catch(()=>({}));
  if(!res.ok) return alert(j.detail || 'Failed to create offer (role must be both/producer).');
  document.getElementById('sellKwh').value = '';
  await refreshMarketplace();
}

// ======= CHARTS: “first file” styling for all =======
function setupChartsOnce(){
  // Provider / Balance / Surplus
  chartProvider = initializeChartById('chartProvider', '€/kWh', '#2563eb');
  chartBalance  = initializeChartById('chartBalance',  '€',     '#10b981');
  chartSurplus  = initializeChartById('chartSurplus',  'kWh',   '#f59e0b');

  // Usage / Production (exact look & colors you used before)
  energyUsageChart      = initializeChartById('energyUsageChart',      'Energy Usage',      '#007bff');
  energyProductionChart = initializeChartById('energyProductionChart', 'Energy Production', '#28a745');

  // Seed usage/production with tidy history like before
  usageSeries = generateRandomEnergyData(12, 5);
  productionSeries = generateRandomEnergyData(12, 8);
  updateChartData(energyUsageChart, usageSeries);
  updateChartData(energyProductionChart, productionSeries);
}

function initializeChartById(canvasId, label, color) {
  const ctx = document.getElementById(canvasId).getContext('2d');
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label,
        data: [],
        borderColor: color,
        backgroundColor: hexToRGBA(color, 0.2),
        tension: 0.4,
        fill: true,
        pointRadius: 3,
        pointBackgroundColor: color
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true, position: 'top',
          labels: { font: { size: 14, family: 'Poppins' }, color: '#333' }
        },
        tooltip: {
          mode: 'index', intersect: false,
          callbacks: { label: (c) => {
            const unit = (label.includes('€') || label==='€') ? '€' : 'kWh';
            return `${c.dataset.label}: ${(+c.raw).toFixed(2)} ${unit}`;
          } }
        }
      },
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

function hexToRGBA(hex, a) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function generateRandomEnergyData(count, max_value) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const date = new Date(Date.now() - (i * 60 * 60 * 1000));
    out.push({
      time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      value: +(Math.random() * max_value).toFixed(2)
    });
  }
  return out.reverse();
}

function pushCapped(series, point) {
  series.push(point);
  if (series.length > MAX_POINTS) series.shift();
}

// Pulls provider price, balance/surplus, and usage/production; updates all charts
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

  // Balance & Surplus
  try {
    const s = await (await fetch(`${API_BASE}/status/${currentUser.id}`)).json();
    pushCapped(balanceSeries, { time: label, value: +s.balance_eur.toFixed(2) });
    pushCapped(surplusSeries, { time: label, value: +s.stored_surplus_kwh.toFixed(2) });
    updateChartData(chartBalance, balanceSeries);
    updateChartData(chartSurplus, surplusSeries);
  } catch {}

  // Usage & Production (real if /meter/last exists; else a gentle drift)
  const { usage, production } = await fetchLatestProdCons(currentUser.id);
  pushCapped(usageSeries,      { time: label, value: +usage.toFixed(2) });
  pushCapped(productionSeries, { time: label, value: +production.toFixed(2) });
  updateChartData(energyUsageChart, usageSeries);
  updateChartData(energyProductionChart, productionSeries);
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
  // fallback drift around last values (bounded)
  const lastU = usageSeries.length ? usageSeries.at(-1).value : 2.5;
  const lastP = productionSeries.length ? productionSeries.at(-1).value : 3.5;
  const clamp = (x,min,max)=>Math.max(min, Math.min(max, x));
  return {
    usage: clamp(lastU + (Math.random()-0.5)*0.6, 0, 6),
    production: clamp(lastP + (Math.random()-0.5)*0.8, 0, 8)
  };
}
