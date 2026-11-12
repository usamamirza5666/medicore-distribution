'use strict';

const appRoot = document.getElementById('app');
const toast = document.getElementById('toast');
const state = { user: null, csrfToken: '', page: 'dashboard', data: null };
const rolePages = {
  Administrator: ['dashboard', 'sales', 'purchases', 'inventory', 'payments', 'expenses', 'reports', 'audit', 'users'],
  Manager: ['dashboard', 'sales', 'purchases', 'inventory', 'payments', 'expenses', 'reports', 'audit', 'users'],
  Salesperson: ['dashboard', 'sales', 'payments'],
  Storekeeper: ['dashboard', 'inventory', 'purchases'],
  Accountant: ['dashboard', 'payments', 'expenses', 'reports']
};
const pageNames = {
  dashboard: 'Dashboard', sales: 'Sales & Invoicing', purchases: 'Purchases',
  inventory: 'Inventory', payments: 'Payments', expenses: 'Expenses',
  reports: 'Reports', audit: 'Audit log', users: 'Team members'
};
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const money = (value) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(value || 0));
const dateText = (value) => value ? new Date(value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z')).toLocaleString() : '—';

async function api(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.csrfToken && !['GET', 'HEAD'].includes(options.method || 'GET')) headers['X-CSRF-Token'] = state.csrfToken;
  const response = await fetch(`/api${url}`, { credentials: 'same-origin', ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && state.user) {
      state.user = null;
      state.csrfToken = '';
      renderLogin();
    }
    throw new Error(body.error || `Request failed (${response.status}).`);
  }
  return body;
}
function notify(message, failed = false) {
  toast.textContent = message;
  toast.className = `toast visible${failed ? ' error' : ''}`;
  window.setTimeout(() => { toast.className = 'toast'; }, 3400);
}
function renderLogin(error = '') {
  appRoot.innerHTML = `<main class="auth-shell"><section class="auth-card">
    <div class="brand-mark">M</div><p class="eyebrow">MEDICINE DISTRIBUTION</p><h1>Welcome back</h1>
    <p class="muted">Sign in to your MediCore workspace.</p>${error ? `<div class="notice error">${escapeHtml(error)}</div>` : ''}
    <form id="login-form" class="stack"><label>Username<input name="username" required autocomplete="username"></label>
    <label>Password<input name="password" type="password" required autocomplete="current-password"></label>
    <button class="button primary wide">Sign in</button></form>
  </section></main>`;
  document.getElementById('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    try {
      const result = await api('/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(fields)) });
      state.user = result.user;
      state.csrfToken = result.csrfToken;
      state.page = 'dashboard';
      renderShell();
      await renderPage();
    } catch (failure) { renderLogin(failure.message); }
  });
}
function renderSetup(error = '', setupTokenRequired = false) {
  appRoot.innerHTML = `<main class="auth-shell"><section class="auth-card">
    <div class="brand-mark">M</div><p class="eyebrow">FIRST-TIME SETUP</p><h1>Create your administrator</h1>
    <p class="muted">This account controls access to the MediCore workspace. Choose a strong, unique password.</p>
    ${error ? `<div class="notice error">${escapeHtml(error)}</div>` : ''}
    ${setupTokenRequired ? '<div class="notice">Enter the one-time setup code configured by the site owner.</div>' : ''}
    <form id="setup-form" class="stack">${setupTokenRequired ? '<label>First-time setup code<input name="setupToken" type="password" required autocomplete="off"></label>' : ''}<label>Username<input name="username" required minlength="3" maxlength="50" autocomplete="username"></label>
    <label>Password<input name="password" type="password" required minlength="12" maxlength="200" autocomplete="new-password"><small>Use at least 12 characters.</small></label>
    <button class="button primary wide">Create administrator</button></form>
  </section></main>`;
  document.getElementById('setup-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const result = await api('/setup', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
      state.user = result.user;
      state.csrfToken = result.csrfToken;
      renderShell();
      await renderPage();
    } catch (failure) { renderSetup(failure.message, setupTokenRequired); }
  });
}
function renderShell() {
  const pages = rolePages[state.user.role] || [];
  appRoot.innerHTML = `<div class="layout"><aside class="sidebar">
    <a class="brand" href="#" data-page="dashboard"><span class="brand-mark small">M</span><span>MediCore<small>Distribution suite</small></span></a>
    <p class="nav-caption">WORKSPACE</p><nav>${pages.map((page) => `<button class="nav-link${state.page === page ? ' active' : ''}" data-page="${page}"><span class="nav-icon">${iconFor(page)}</span>${pageNames[page]}</button>`).join('')}</nav>
    <div class="side-footer"><div class="avatar">${escapeHtml(state.user.username.slice(0, 1).toUpperCase())}</div><div class="identity"><strong>${escapeHtml(state.user.username)}</strong><small>${escapeHtml(state.user.role)}</small></div><button id="logout" class="icon-button" title="Sign out" aria-label="Sign out">↗</button></div>
  </aside><main class="main"><header class="topbar"><div><span class="eyebrow">MEDICORE WORKSPACE</span><h1 id="page-title">${pageNames[state.page] || 'Dashboard'}</h1></div><span class="date-pill">${new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span></header><section id="view" class="content"></section></main></div>`;
  appRoot.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', async (event) => {
    state.page = event.currentTarget.dataset.page;
    renderShell();
    await renderPage();
  }));
  document.getElementById('logout').addEventListener('click', async () => {
    try { await api('/logout', { method: 'POST', body: '{}' }); } catch (failure) { notify(failure.message, true); }
    state.user = null; state.csrfToken = ''; renderLogin();
  });
}
function iconFor(page) {
  return ({ dashboard: '▦', sales: '▤', purchases: '⇣', inventory: '▣', payments: '$', expenses: '↗', reports: '▥', audit: '◷', users: '◎' })[page] || '•';
}
function table(headers, rows, empty = 'No records yet.') {
  if (!rows.length) return `<div class="empty">${escapeHtml(empty)}</div>`;
  return `<div class="table-wrap"><table><thead><tr>${headers.map((header) => `<th>${header}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}
function panel(title, content, subtitle = '') {
  return `<section class="panel"><div class="panel-heading"><div><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div></div>${content}</section>`;
}
function metric(title, value, caption, glyph) {
  return `<article class="metric-card"><div class="metric-top"><span>${title}</span><b>${glyph}</b></div><strong>${value}</strong><small>${caption}</small></article>`;
}
async function renderPage() {
  const view = document.getElementById('view');
  if (!view) return;
  view.innerHTML = '<div class="loading">Loading…</div>';
  try {
    if (state.page === 'dashboard') return await renderDashboard(view);
    if (state.page === 'inventory') return await renderInventory(view);
    if (state.page === 'purchases') return await renderPurchases(view);
    if (state.page === 'sales') return await renderSales(view);
    if (state.page === 'payments') return await renderPayments(view);
    if (state.page === 'expenses') return await renderExpenses(view);
    if (state.page === 'reports') return await renderReports(view);
    if (state.page === 'audit') return await renderAudit(view);
    if (state.page === 'users') return await renderUsers(view);
  } catch (failure) {
    view.innerHTML = `<div class="notice error">${escapeHtml(failure.message)}</div>`;
  }
}
async function renderDashboard(view) {
  const data = await api('/dashboard');
  view.innerHTML = `<div class="welcome-row"><div><h2>Good ${new Date().getHours() < 12 ? 'morning' : 'day'}, ${escapeHtml(state.user.username)}</h2><p>Here’s the latest overview of your distribution business.</p></div><span class="status-chip">● System operational</span></div>
    <div class="metrics">${metric("Today's sales", money(data.sales), 'Invoices recorded today', '↗')}${metric("Today's gross profit", money(data.profit), 'Sales less batch cost', '◈')}${metric('Stock alerts', data.lowStock.length, 'Medicines at or below reorder level', '!')}${metric('Expiring soon', data.expiring.length, 'Batches expiring in 90 days', '◷')}</div>
    <div class="grid-two">${panel('Low stock', table(['Medicine', 'SKU', 'Available', 'Reorder at'], data.lowStock.map((item) => `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.sku)}</td><td><span class="tag warn">${item.quantity}</span></td><td>${item.reorder_level}</td></tr>`), 'Stock levels look good.'))}
    ${panel('Expiring batches', table(['Medicine', 'Batch', 'Expiry date', 'Qty'], data.expiring.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.batch_number)}</td><td>${escapeHtml(item.expiry_date)}</td><td>${item.quantity}</td></tr>`), 'No batches expiring in the next 90 days.'))}</div>`;
}
async function loadMedicines() { return api('/medicines'); }
async function renderInventory(view) {
  const medicines = await loadMedicines();
  view.innerHTML = `<div class="page-actions"><div><p class="muted">Medicine catalog and on-hand stock, excluding expired batches.</p></div><button class="button primary" id="add-medicine">＋ Add medicine</button></div>
    ${panel('Medicine catalog', table(['Medicine', 'SKU', 'Unit', 'Available', 'Reorder level', 'Stock value'], medicines.map((item) => `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.sku)}</td><td>${escapeHtml(item.unit)}</td><td>${item.quantity}</td><td>${item.reorder_level}</td><td>${money(item.stock_value)}</td></tr>`), 'Add a medicine to begin tracking inventory.'))}
    <div id="modal-root"></div>`;
  document.getElementById('add-medicine').addEventListener('click', () => showForm('Add medicine', [
    ['name', 'Medicine name', 'text'], ['sku', 'SKU / code', 'text'], ['unit', 'Unit (e.g. box)', 'text'], ['reorderLevel', 'Reorder level', 'number']
  ], async (data) => { data.reorderLevel = Number(data.reorderLevel || 0); await api('/medicines', { method: 'POST', body: JSON.stringify(data) }); }));
}
async function renderPurchases(view) {
  const [items, medicines] = await Promise.all([api('/purchases'), loadMedicines()]);
  view.innerHTML = `<div class="page-actions"><p class="muted">Receive stock by supplier, batch, expiry and purchase cost.</p><button class="button primary" id="add-purchase">＋ Record purchase</button></div>
    ${panel('Recent purchases', table(['Reference', 'Supplier', 'Total cost', 'Recorded', 'By'], items.map((item) => `<tr><td><strong>${escapeHtml(item.reference)}</strong></td><td>${escapeHtml(item.supplier)}</td><td>${money(item.total)}</td><td>${dateText(item.created_at)}</td><td>${escapeHtml(item.username || '—')}</td></tr>`), 'No purchases recorded yet.'))}<div id="modal-root"></div>`;
  document.getElementById('add-purchase').addEventListener('click', () => showForm('Record purchase', [
    ['supplier', 'Supplier', 'text'], ['reference', 'Purchase reference', 'text'], ['medicineId', 'Medicine', 'select', medicines.map((m) => [m.id, `${m.name} (${m.sku})`])],
    ['batchNumber', 'Batch number', 'text'], ['expiryDate', 'Expiry date', 'date'], ['quantity', 'Quantity', 'number'], ['unitCost', 'Unit purchase cost', 'number']
  ], async (data) => { data.medicineId = Number(data.medicineId); data.quantity = Number(data.quantity); data.unitCost = Number(data.unitCost); await api('/purchases', { method: 'POST', body: JSON.stringify(data) }); }));
}
async function renderSales(view) {
  const [invoices, medicines] = await Promise.all([api('/invoices'), loadMedicines()]);
  view.innerHTML = `<div class="page-actions"><p class="muted">Invoices automatically draw from the earliest-expiring unexpired batches (FEFO).</p><button class="button primary" id="new-invoice">＋ New invoice</button></div>
    ${panel('Recent invoices', table(['Invoice', 'Customer', 'Total', 'Date', 'By'], invoices.map((item) => `<tr><td><strong>${escapeHtml(item.reference)}</strong></td><td>${escapeHtml(item.customer)}</td><td>${money(item.total)}</td><td>${dateText(item.created_at)}</td><td>${escapeHtml(item.username || '—')}</td></tr>`), 'No invoices recorded yet.'))}<div id="modal-root"></div>`;
  document.getElementById('new-invoice').addEventListener('click', () => showInvoiceForm(medicines));
}
function showInvoiceForm(medicines) {
  const options = medicines.map((m) => `<option value="${m.id}">${escapeHtml(m.name)} — ${escapeHtml(m.sku)} (${m.quantity} available)</option>`).join('');
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-backdrop"><section class="modal"><button class="modal-close" aria-label="Close">×</button><h2>New invoice</h2><p class="muted">Stock is allocated FEFO across eligible batches.</p>
    <form id="invoice-form" class="stack"><label>Customer<input name="customer" required></label><div id="invoice-lines"><div class="line-item"><label>Medicine<select class="line-medicine" required>${options}</select></label><label>Qty<input class="line-quantity" type="number" min="1" value="1" required></label><label>Unit price<input class="line-price" type="number" min="0" step="0.01" required></label></div></div>
    <button type="button" class="button secondary" id="add-line">＋ Add line</button><div class="modal-actions"><button type="button" class="button secondary modal-cancel">Cancel</button><button class="button primary">Create invoice</button></div></form></section></div>`;
  const close = () => { root.innerHTML = ''; };
  root.querySelector('.modal-close').addEventListener('click', close);
  root.querySelector('.modal-cancel').addEventListener('click', close);
  root.querySelector('#add-line').addEventListener('click', () => {
    const line = document.createElement('div');
    line.className = 'line-item';
    line.innerHTML = `<label>Medicine<select class="line-medicine" required>${options}</select></label><label>Qty<input class="line-quantity" type="number" min="1" value="1" required></label><label>Unit price<input class="line-price" type="number" min="0" step="0.01" required></label><button type="button" class="remove-line" aria-label="Remove item">×</button>`;
    line.querySelector('.remove-line').addEventListener('click', () => line.remove());
    root.querySelector('#invoice-lines').append(line);
  });
  root.querySelector('#invoice-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const lines = [...root.querySelectorAll('.line-item')].map((line) => ({
      medicineId: Number(line.querySelector('.line-medicine').value),
      quantity: Number(line.querySelector('.line-quantity').value),
      unitPrice: Number(line.querySelector('.line-price').value)
    }));
    try {
      const result = await api('/invoices', { method: 'POST', body: JSON.stringify({ customer: new FormData(event.currentTarget).get('customer'), items: lines }) });
      notify(`Invoice ${result.reference} created.`);
      await renderSales(document.getElementById('view'));
    } catch (failure) { notify(failure.message, true); }
  });
}
async function renderPayments(view) {
  const payments = await api('/payments');
  view.innerHTML = `<div class="page-actions"><p class="muted">Record money received from customers and paid to suppliers.</p><button class="button primary" id="add-payment">＋ Record payment</button></div>
    ${panel('Transactions', table(['Type', 'Party', 'Direction', 'Amount', 'Method', 'Date'], payments.map((item) => `<tr><td>${escapeHtml(item.party_type)}</td><td><strong>${escapeHtml(item.party)}</strong></td><td>${escapeHtml(item.direction)}</td><td>${money(item.amount)}</td><td>${escapeHtml(item.method)}</td><td>${dateText(item.created_at)}</td></tr>`), 'No transactions recorded yet.'))}<div id="modal-root"></div>`;
  document.getElementById('add-payment').addEventListener('click', () => showForm('Record payment', [
    ['partyType', 'Party type', 'select', [['Customer', 'Customer'], ['Supplier', 'Supplier']]],
    ['direction', 'Direction', 'select', [['Received', 'Received'], ['Paid', 'Paid']]],
    ['party', 'Customer or supplier', 'text'], ['amount', 'Amount', 'number'], ['method', 'Method', 'select', [['Cash', 'Cash'], ['Bank transfer', 'Bank transfer'], ['Card', 'Card'], ['Other', 'Other']]],
    ['note', 'Note (optional)', 'text']
  ], async (data) => { data.amount = Number(data.amount); await api('/payments', { method: 'POST', body: JSON.stringify(data) }); }));
}
async function renderExpenses(view) {
  const expenses = await api('/expenses');
  view.innerHTML = `<div class="page-actions"><p class="muted">Track operational costs for reporting and profitability.</p><button class="button primary" id="add-expense">＋ Add expense</button></div>
    ${panel('Recent expenses', table(['Category', 'Description', 'Amount', 'Date', 'By'], expenses.map((item) => `<tr><td><span class="tag">${escapeHtml(item.category)}</span></td><td>${escapeHtml(item.description)}</td><td>${money(item.amount)}</td><td>${dateText(item.created_at)}</td><td>${escapeHtml(item.username || '—')}</td></tr>`), 'No expenses recorded yet.'))}<div id="modal-root"></div>`;
  document.getElementById('add-expense').addEventListener('click', () => showForm('Add expense', [
    ['category', 'Category', 'text'], ['description', 'Description', 'text'], ['amount', 'Amount', 'number']
  ], async (data) => { data.amount = Number(data.amount); await api('/expenses', { method: 'POST', body: JSON.stringify(data) }); }));
}
async function renderReports(view) {
  const today = new Date().toISOString().slice(0, 10);
  view.innerHTML = `<form id="report-filter" class="filter-row"><label>From<input type="date" name="start" value="${today.slice(0, 8)}01"></label><label>To<input type="date" name="end" value="${today}"></label><button class="button primary">Run report</button></form><div id="report-data"></div>`;
  const load = async (start, end) => {
    const report = await api(`/reports?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
    document.getElementById('report-data').innerHTML = `<div class="metrics report-metrics">${metric('Invoice count', report.invoice_count, 'In selected period', '▤')}${metric('Total sales', money(report.total_sales), 'Invoice value', '↗')}${metric('Gross profit', money(report.gross_profit), 'Before operating expenses', '◈')}${metric('Operating expenses', money(report.total_expenses), 'Recorded costs', '$')}${metric('Stock valuation', money(report.stock_value), 'Current unexpired stock at cost', '▣')}</div>`;
  };
  await load(`${today.slice(0, 8)}01`, today);
  document.getElementById('report-filter').addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    try { await load(fields.get('start'), fields.get('end')); } catch (failure) { notify(failure.message, true); }
  });
}
async function renderAudit(view) {
  const entries = await api('/audit');
  view.innerHTML = panel('Recent activity', table(['User', 'Action', 'Details', 'Time'], entries.map((item) => `<tr><td><strong>${escapeHtml(item.username)}</strong></td><td>${escapeHtml(item.action)}</td><td>${escapeHtml(item.details)}</td><td>${dateText(item.created_at)}</td></tr>`), 'No activity recorded yet.'));
}
async function renderUsers(view) {
  const users = await api('/users');
  view.innerHTML = `<div class="page-actions"><p class="muted">Create accounts and assign least-privilege roles.</p><button class="button primary" id="add-user">＋ Add user</button></div>
    ${panel('Team members', table(['Username', 'Role', 'Created'], users.map((user) => `<tr><td><strong>${escapeHtml(user.username)}</strong></td><td><span class="tag">${escapeHtml(user.role)}</span></td><td>${dateText(user.created_at)}</td></tr>`)))}<div id="modal-root"></div>`;
  document.getElementById('add-user').addEventListener('click', () => showForm('Add team member', [
    ['username', 'Username', 'text'], ['password', 'Temporary password (12+ characters)', 'password'],
    ['role', 'Role', 'select', ['Administrator', 'Manager', 'Salesperson', 'Storekeeper', 'Accountant'].map((role) => [role, role])]
  ], async (data) => { await api('/users', { method: 'POST', body: JSON.stringify(data) }); }));
}
function showForm(title, fields, onSubmit) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-backdrop"><section class="modal"><button class="modal-close" aria-label="Close">×</button><h2>${escapeHtml(title)}</h2><form id="generic-form" class="stack">
    ${fields.map(([name, label, type, choices]) => `<label>${escapeHtml(label)}${type === 'select'
      ? `<select name="${escapeHtml(name)}" required>${choices.map(([value, text]) => `<option value="${escapeHtml(value)}">${escapeHtml(text)}</option>`).join('')}</select>`
      : `<input name="${escapeHtml(name)}" type="${type}" ${type === 'number' ? 'min="0" step="0.01"' : ''} ${name === 'password' ? 'minlength="12"' : ''} required>`}</label>`).join('')}
    <div class="modal-actions"><button type="button" class="button secondary modal-cancel">Cancel</button><button class="button primary">Save</button></div></form></section></div>`;
  const close = () => { root.innerHTML = ''; };
  root.querySelector('.modal-close').addEventListener('click', close);
  root.querySelector('.modal-cancel').addEventListener('click', close);
  root.querySelector('#generic-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await onSubmit(values);
      notify('Saved successfully.');
      await renderPage();
    } catch (failure) { notify(failure.message, true); }
  });
}
async function boot() {
  try {
    const status = await api('/status');
    if (status.setupRequired) return renderSetup('', status.setupTokenRequired);
    try {
      const current = await api('/me');
      state.user = current.user;
      state.csrfToken = current.csrfToken;
      renderShell();
      await renderPage();
    } catch (failure) {
      if (failure.message) renderLogin();
      else renderLogin();
    }
  } catch (failure) {
    appRoot.innerHTML = `<main class="auth-shell"><section class="auth-card"><div class="brand-mark">M</div><h1>MediCore unavailable</h1><p class="muted">${escapeHtml(failure.message)}</p><button class="button primary" id="retry">Try again</button></section></main>`;
    document.getElementById('retry').addEventListener('click', () => location.reload());
  }
}

boot();
