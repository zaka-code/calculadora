/* =============================================================
   CALCULADORA DE PRECIFICAÇÃO — MONITORAMENTO IA RESTAURANTES
   ============================================================= */

// ──────────────────────────────────────────────
// ESTADO GLOBAL
// ──────────────────────────────────────────────
const STATE = {
  qtdRestaurantes: 4,
  taxaCambio: 7.00,
  encargos: 10,
  imposto: 15,
  precoVenda: 550,
};

const GPU_CAP  = 4;   // restaurantes por GPU
const VPS_CAP  = 20;  // restaurantes por VPS
const CAM_POR_REST = 3; // câmeras por restaurante

// ──────────────────────────────────────────────
// ITENS DE INFRAESTRUTURA
// ──────────────────────────────────────────────
let infraItems = [
  {
    id: 'vps',
    name: 'VPS: KVM 8',
    value: 119.99,
    currency: 'BRL',
    billingType: 'month',
    shifts: 1, hoursPerShift: 1, daysPerMonth: 30,
    type: 'vps',
    locked: true,
  },
  {
    id: 'gpu',
    name: 'GPU: NVIDIA A4000',
    value: 0.25,
    currency: 'USD',
    billingType: 'hour',
    shifts: 1, hoursPerShift: 6, daysPerMonth: 30,
    type: 'gpu',
    locked: true,
  },
  {
    id: 'backblaze',
    name: 'Storage: Backblaze',
    value: 10.00,
    currency: 'USD',
    billingType: 'month',
    shifts: 1, hoursPerShift: 1, daysPerMonth: 30,
    type: 'storage',
    locked: true,
    gbPerGroup: 800,
    groupSize: 4,
  },
  {
    id: 'storage-gpu',
    name: 'Storage GPU (10 GB)',
    value: 1.00,
    currency: 'USD',
    billingType: 'month',
    shifts: 1, hoursPerShift: 1, daysPerMonth: 30,
    type: 'gpu',
    locked: true,
  },
  {
    id: 'ip-gpu',
    name: 'IP Público GPU',
    value: 5.00,
    currency: 'USD',
    billingType: 'month',
    shifts: 1, hoursPerShift: 1, daysPerMonth: 30,
    type: 'gpu',
    locked: true,
  },
];

let infraCustom = [];

// ──────────────────────────────────────────────
// ITENS DE EQUIPE
// ──────────────────────────────────────────────
let equipeItems = [
  {
    id: 'devops',
    name: 'DevOps (Apoio)',
    value: 70.00,
    currency: 'BRL',
    billingType: 'hour',
    shifts: 1, hoursPerShift: 5, daysPerMonth: 1, // 5h no mês = 5h/turno * 1 turno * 1 dia
    type: 'fixed',
    locked: true,
  },
];
let equipeCustom = [];

// ──────────────────────────────────────────────
// MODAL STATE
// ──────────────────────────────────────────────
let modalTarget = null; // 'infra' | 'equipe'
let editingItemId = null; // id se estiver editando

// ──────────────────────────────────────────────
// HELPERS DE CÁLCULO
// ──────────────────────────────────────────────
const fmt = (v) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toBRL = (value, currency) => currency === 'USD' ? value * STATE.taxaCambio : value;
const qtdGPUs = () => Math.ceil(STATE.qtdRestaurantes / GPU_CAP);
const qtdVPSs = () => Math.ceil(STATE.qtdRestaurantes / VPS_CAP);

/** Converte o valor base para CUSTO MENSAL baseado no billingType */
function calcMonthlyBase(item) {
  let v = parseFloat(item.value) || 0;
  if (item.billingType === 'year') return v / 12;
  if (item.billingType === 'day') return v * (item.daysPerMonth || 30);
  if (item.billingType === 'hour') return v * (item.shifts || 1) * (item.hoursPerShift || 1) * (item.daysPerMonth || 30);
  return v; // month
}

function calcVPSTotal(unitBRL) {
  const n = STATE.qtdRestaurantes;
  const qtdVPS = qtdVPSs();
  if (n === 0 || qtdVPS === 0) return 0;
  let totalBRL = 0;
  for (let i = 0; i < qtdVPS; i++) {
    const servedCount = Math.min((i + 1) * VPS_CAP, n) - (i * VPS_CAP + 1) + 1;
    totalBRL += (unitBRL / VPS_CAP) * servedCount;
  }
  return totalBRL;
}

function calcStorageTotal(item, monthlyBaseBRL) {
  const n = STATE.qtdRestaurantes;
  const totalGB = Math.ceil(n / (item.groupSize || 4)) * (item.gbPerGroup || 800);
  const totalTB = totalGB / 1024;
  return totalTB * monthlyBaseBRL;
}

function gerarDescricao(item) {
  if (item.desc) return item.desc;
  
  const v = item.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  const moeda = item.currency === 'USD' ? '$' : 'R$';
  let baseStr = `${moeda}${v}`;

  if (item.billingType === 'year') return `${baseStr} por ano`;
  if (item.billingType === 'day') return `${baseStr}/dia × ${item.daysPerMonth} dias/mês`;
  if (item.billingType === 'hour') return `${baseStr}/h × ${item.shifts} turno(s) × ${item.hoursPerShift}h × ${item.daysPerMonth}d`;
  return `${baseStr} por mês`;
}

// ──────────────────────────────────────────────
// CÁLCULO PRINCIPAL
// ──────────────────────────────────────────────
function calcular() {
  const n = STATE.qtdRestaurantes;
  if (n <= 0) return;

  const gpus = qtdGPUs();
  const vpss = qtdVPSs();

  // ── INFRA ──
  let totalInfraBRL = 0;
  const detalheInfra = [];
  const allInfra = [...infraItems, ...infraCustom];

  for (const item of allInfra) {
    const monthlyBaseBRL = toBRL(calcMonthlyBase(item), item.currency);
    let totalItem = 0;
    let nota = '';

    if (item.type === 'vps') {
      totalItem = calcVPSTotal(monthlyBaseBRL);
      nota = `${vpss} VPS × distribuição proporcional`;
    } else if (item.type === 'gpu') {
      totalItem = monthlyBaseBRL * gpus;
      nota = `${gpus} GPU${gpus > 1 ? 's' : ''}`;
    } else if (item.type === 'storage') {
      totalItem = calcStorageTotal(item, monthlyBaseBRL);
      const totalGB = Math.ceil(n / (item.groupSize || 4)) * (item.gbPerGroup || 800);
      nota = `${totalGB} GB ≈ ${(totalGB / 1024).toFixed(3)} TB`;
    } else if (item.type === 'restaurante') {
      totalItem = monthlyBaseBRL * n;
      nota = `${n} restaurante(s)`;
    } else { // fixed
      totalItem = monthlyBaseBRL;
      nota = gerarDescricao(item);
    }

    totalInfraBRL += totalItem;
    detalheInfra.push({ name: item.name, nota, total: totalItem });
  }

  // ── EQUIPE ──
  let totalEquipeBRL = 0;
  for (const item of [...equipeItems, ...equipeCustom]) {
    const monthlyBaseBRL = toBRL(calcMonthlyBase(item), item.currency);
    let totalItem = 0;

    if (item.type === 'restaurante') totalItem = monthlyBaseBRL * n;
    else totalItem = monthlyBaseBRL; // Equipe geralmente é fixo

    totalEquipeBRL += totalItem;
  }

  // ── CÁLCULOS ──
  const subtotal = totalInfraBRL + totalEquipeBRL;
  const encargo  = subtotal * (STATE.encargos / 100);
  
  // Imposto calculado sobre a Receita Bruta (Faturamento)
  const receitaTotal = STATE.precoVenda * n;
  const imposto  = receitaTotal * (STATE.imposto  / 100);
  
  const total    = subtotal + encargo + imposto; // Custo total da operação

  const porRestaurante = n > 0 ? total / n : 0;
  const porCamera      = porRestaurante / CAM_POR_REST;

  const lucroTotal = receitaTotal - total;
  const lucroPorRestaurante = n > 0 ? lucroTotal / n : 0;
  const margem = STATE.precoVenda > 0 ? (lucroPorRestaurante / STATE.precoVenda) * 100 : 0;

  updateResultsDOM({
    totalInfraBRL, totalEquipeBRL,
    subtotal, encargo, imposto, total,
    porRestaurante, porCamera,
    lucroPorRestaurante, lucroTotal, margem,
    detalheInfra, gpus, vpss, n,
  });
}

function updateResultsDOM(r) {
  document.getElementById('val-por-restaurante').textContent = fmt(r.porRestaurante);
  document.getElementById('val-por-camera').textContent      = fmt(r.porCamera) + ' / câmera';

  document.getElementById('val-infra').textContent    = fmt(r.totalInfraBRL);
  document.getElementById('val-equipe').textContent   = fmt(r.totalEquipeBRL);
  document.getElementById('val-subtotal').textContent = fmt(r.subtotal);
  document.getElementById('val-encargo').textContent  = fmt(r.encargo);
  document.getElementById('val-imposto').textContent  = fmt(r.imposto);
  document.getElementById('val-total').textContent    = fmt(r.total);

  document.getElementById('label-encargos-pct').textContent = STATE.encargos;
  document.getElementById('label-imposto-pct').textContent  = STATE.imposto;

  document.getElementById('metric-restaurante').textContent  = fmt(r.porRestaurante);
  document.getElementById('metric-camera').textContent       = fmt(r.porCamera);
  document.getElementById('metric-encargo').textContent      = fmt(r.encargo);
  document.getElementById('metric-imposto').textContent      = fmt(r.imposto);
  document.getElementById('metric-qtd-rest').textContent     = `${r.n} restaurante${r.n !== 1 ? 's' : ''}`;
  document.getElementById('metric-encargo-pct').textContent  = `${STATE.encargos}% do subtotal`;
  document.getElementById('metric-imposto-pct').textContent  = `${STATE.imposto}% da Receita Bruta`;

  document.getElementById('metric-lucro-rest').textContent   = fmt(r.lucroPorRestaurante);
  document.getElementById('metric-lucro-total').textContent  = fmt(r.lucroTotal);
  document.getElementById('metric-margem').textContent       = `Margem: ${r.margem.toFixed(1)}%`;

  document.getElementById('resource-summary').innerHTML = `
    <div class="res-badge"><div class="res-badge-icon">⚡</div><div class="res-badge-val">${r.gpus}</div><div class="res-badge-label">GPU${r.gpus !== 1 ? 's' : ''}</div></div>
    <div class="res-badge"><div class="res-badge-icon">🖥️</div><div class="res-badge-val">${r.vpss}</div><div class="res-badge-label">VPS</div></div>
    <div class="res-badge"><div class="res-badge-icon">📷</div><div class="res-badge-val">${r.n * CAM_POR_REST}</div><div class="res-badge-label">Câmeras</div></div>
  `;

  document.getElementById('infra-detail-list').innerHTML = r.detalheInfra.map(d => `
    <div class="detail-row">
      <div class="detail-row-info">
        <div class="detail-row-name">${d.name}</div>
        <div class="detail-row-note">${d.nota}</div>
      </div>
      <div class="detail-row-right">
        <div class="detail-row-value">${fmt(d.total)}</div>
        <div class="detail-row-units">custo total</div>
      </div>
    </div>
  `).join('');
}

// ──────────────────────────────────────────────
// RENDERIZAR LISTAS
// ──────────────────────────────────────────────
function renderList(containerId, itemsCustom, itemsFixed, source) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  
  const allItems = [...itemsFixed, ...itemsCustom];
  allItems.forEach(item => {
    const isLocked = item.locked === true;
    const isUSD = item.currency === 'USD';
    const row = document.createElement('div');
    row.className = 'item-row';
    
    // Calcula mensal base para mostrar o equivalente
    const mBase = calcMonthlyBase(item);
    const mBRL = toBRL(mBase, item.currency);
    
    row.innerHTML = `
      <div class="item-info">
        <div class="item-name">${item.name}</div>
        <div class="item-desc">${gerarDescricao(item)}</div>
      </div>
      <div class="item-right">
        <div class="item-value-inputs" style="align-items: flex-end;">
          <div class="item-value-row">
            <span class="item-currency-badge ${isUSD ? 'badge-usd' : 'badge-brl'}">${item.currency}</span>
            <span style="font-weight:700; font-size:14px; margin-left:4px;">${item.value.toFixed(2)}</span>
          </div>
          <div class="item-brl-converted visible" style="font-size:10px; color:var(--text-3);">
            (Base mens: ${fmt(mBRL)})
          </div>
        </div>
        <div style="display:flex; gap:4px;">
          <button class="item-edit" onclick="openModal('${source}', '${item.id}')" title="Editar item">✏️</button>
          <button class="item-delete ${isLocked ? 'locked' : ''}" 
                  onclick="${isLocked ? '' : `removeItem('${source}', '${item.id}')`}" 
                  title="${isLocked ? 'Item fixo não pode ser removido' : 'Remover item'}">✕</button>
        </div>
      </div>
    `;
    container.appendChild(row);
  });
}

function renderAll() {
  renderList('infra-list', infraCustom, infraItems, 'infra');
  renderList('equipe-list', equipeCustom, equipeItems, 'equipe');
}

// ──────────────────────────────────────────────
// EVENTOS DE CONFIG
// ──────────────────────────────────────────────
function bindConfigInputs() {
  const bind = (id, prop, isInt = false) => {
    document.getElementById(id).addEventListener('input', function() {
      STATE[prop] = isInt ? Math.max(1, parseInt(this.value)||1) : (parseFloat(this.value)||0);
      renderAll(); // Atualiza textos de BRL base
      calcular();
    });
  };
  bind('qtd-restaurantes', 'qtdRestaurantes', true);
  bind('taxa-cambio', 'taxaCambio');
  bind('encargos', 'encargos');
  bind('imposto', 'imposto');
  bind('preco-venda', 'precoVenda');
}

function removeItem(source, id) {
  if (source === 'infra') infraCustom = infraCustom.filter(i => i.id !== id);
  else equipeCustom = equipeCustom.filter(i => i.id !== id);
  renderAll();
  calcular();
}

// ──────────────────────────────────────────────
// MODAL & SCALING EXPLANATION
// ──────────────────────────────────────────────
const scalingExplanations = {
  fixed: "O valor será cobrado uma única vez e somado ao total.",
  gpu: "O valor base mensal será multiplicado pela quantidade de GPUs necessárias (1 GPU a cada 4 restaurantes).",
  vps: "A VPS atende 20 restaurantes. O custo da VPS é dividido e cobrado proporcionalmente de acordo com a lotação.",
  storage: "Armazenamento escala a cada 4 restaurantes. Calcula a quantidade de TB usada e multiplica pelo valor.",
  restaurante: "O valor base mensal será multiplicado pela quantidade total de restaurantes."
};

function updateScalingExplanation() {
  const val = document.getElementById('modal-scaling').value;
  document.getElementById('scaling-explanation').textContent = scalingExplanations[val] || '';
}

function toggleTimeFields() {
  const val = document.getElementById('modal-billing').value;
  const timeFields = document.getElementById('time-fields');
  
  if (val === 'hour' || val === 'day') {
    timeFields.classList.remove('hidden');
    // Esconde turnos/horas se for só por dia
    document.getElementById('modal-shifts').parentElement.style.display = (val === 'day') ? 'none' : 'flex';
    document.getElementById('modal-hours').parentElement.style.display = (val === 'day') ? 'none' : 'flex';
  } else {
    timeFields.classList.add('hidden');
  }
}

function openModal(target, editId = null) {
  modalTarget = target;
  editingItemId = editId;
  
  const isEquipe = target === 'equipe';
  
  // Limpa/Reseta
  document.getElementById('modal-title').textContent = editId ? 'Editar Item' : (isEquipe ? 'Adicionar Equipe' : 'Adicionar Infra');
  document.getElementById('modal-name').value = '';
  document.getElementById('modal-value').value = '';
  document.getElementById('modal-desc').value = '';
  document.getElementById('modal-currency').value = 'BRL';
  document.getElementById('modal-billing').value = 'month';
  document.getElementById('modal-shifts').value = 1;
  document.getElementById('modal-hours').value = 6;
  document.getElementById('modal-days').value = 30;
  
  // Se for equipe, o padrão de escalonamento costuma ser fixo.
  // Se for criar novo, default 'fixed'
  document.getElementById('modal-scaling').value = 'fixed';
  
  // Habilita select de scaling por padrão
  document.getElementById('modal-scaling').disabled = false;
  
  // Esconde scaling para Equipe para simplificar, ou permite? O usuário pediu na equipe.
  document.getElementById('modal-scaling-group').style.display = 'flex';

  if (editId) {
    let item = [...infraItems, ...infraCustom, ...equipeItems, ...equipeCustom].find(i => i.id === editId);
    if (item) {
      document.getElementById('modal-name').value = item.name;
      document.getElementById('modal-value').value = item.value;
      document.getElementById('modal-currency').value = item.currency;
      document.getElementById('modal-billing').value = item.billingType || 'month';
      document.getElementById('modal-shifts').value = item.shifts || 1;
      document.getElementById('modal-hours').value = item.hoursPerShift || 1;
      document.getElementById('modal-days').value = item.daysPerMonth || 30;
      document.getElementById('modal-scaling').value = item.type || 'fixed';
      
      // Se for item preset, podemos desativar a mudança da regra de escalonamento
      // pois a lógica deles pode exigir propriedades específicas (ex: storage)
      if (item.locked) {
        document.getElementById('modal-scaling').disabled = true;
      }
    }
  }

  toggleTimeFields();
  updateScalingExplanation();
  document.getElementById('modal-overlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  modalTarget = null;
  editingItemId = null;
}

function confirmModal() {
  const name = document.getElementById('modal-name').value.trim();
  const value = parseFloat(document.getElementById('modal-value').value) || 0;
  const currency = document.getElementById('modal-currency').value;
  const billingType = document.getElementById('modal-billing').value;
  const shifts = parseInt(document.getElementById('modal-shifts').value) || 1;
  const hoursPerShift = parseFloat(document.getElementById('modal-hours').value) || 1;
  const daysPerMonth = parseFloat(document.getElementById('modal-days').value) || 30;
  const type = document.getElementById('modal-scaling').value;
  const desc = document.getElementById('modal-desc').value.trim();

  if (!name) return document.getElementById('modal-name').focus();

  const itemData = {
    name, value, currency, billingType, shifts, hoursPerShift, daysPerMonth, desc, type
  };

  if (editingItemId) {
    // Acha e edita
    let item = [...infraItems, ...infraCustom, ...equipeItems, ...equipeCustom].find(i => i.id === editingItemId);
    if (item) {
      Object.assign(item, itemData);
      // Se era locked, forçar o type a não mudar para não quebrar regras hardcoded
      if (item.locked) item.type = item.type; // already handled by disabled select, but just in case
    }
  } else {
    // Novo
    itemData.id = 'custom-' + Date.now();
    itemData.locked = false;
    if (modalTarget === 'infra') infraCustom.push(itemData);
    else equipeCustom.push(itemData);
  }

  closeModal();
  renderAll();
  calcular();
}

// ──────────────────────────────────────────────
// INIT
// ──────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.getElementById('modal-overlay').classList.contains('open')) confirmModal();
  if (e.key === 'Escape') closeModal();
});

document.addEventListener('DOMContentLoaded', () => {
  renderAll();
  bindConfigInputs();
  calcular();
});
