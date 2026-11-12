"use strict";

const STORAGE_KEY = "medsupply-workspace-v1";
const DAY = 24 * 60 * 60 * 1000;
const pageNames = {
  dashboard: "Overview",
  inventory: "Inventory",
  batches: "Batch tracking",
  orders: "Orders",
  returns: "Returns",
  suppliers: "Suppliers",
  reports: "Reports"
};

let savedDataError = false;

function dateOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function sampleData() {
  return {
    medicines: [
      { id: "med-1", name: "Paracetamol 500 mg", sku: "MED-001", category: "Analgesic", unit: "Box", reorderLevel: 80 },
      { id: "med-2", name: "Amoxicillin 250 mg", sku: "MED-002", category: "Antibiotic", unit: "Pack", reorderLevel: 50 },
      { id: "med-3", name: "Cetirizine 10 mg", sku: "MED-003", category: "Antihistamine", unit: "Box", reorderLevel: 40 },
      { id: "med-4", name: "Oral rehydration salts", sku: "MED-004", category: "Rehydration", unit: "Sachet", reorderLevel: 100 },
      { id: "med-5", name: "Ibuprofen 200 mg", sku: "MED-005", category: "Analgesic", unit: "Box", reorderLevel: 30 }
    ],
    batches: [
      { id: "bat-1", medicineId: "med-1", number: "PCM-24018", expiry: dateOffset(240), quantity: 240, supplierId: "sup-1" },
      { id: "bat-2", medicineId: "med-2", number: "AMX-24007", expiry: dateOffset(68), quantity: 35, supplierId: "sup-2" },
      { id: "bat-3", medicineId: "med-2", number: "AMX-24011", expiry: dateOffset(330), quantity: 80, supplierId: "sup-2" },
      { id: "bat-4", medicineId: "med-3", number: "CET-24002", expiry: dateOffset(24), quantity: 18, supplierId: "sup-1" },
      { id: "bat-5", medicineId: "med-4", number: "ORS-24022", expiry: dateOffset(470), quantity: 320, supplierId: "sup-3" },
      { id: "bat-6", medicineId: "med-5", number: "IBU-24015", expiry: dateOffset(180), quantity: 95, supplierId: "sup-2" }
    ],
    orders: [
      { id: "ORD-1042", customer: "Green Cross Pharmacy", date: dateOffset(-1), status: "Pending", items: [{ medicineId: "med-1", quantity: 40 }, { medicineId: "med-3", quantity: 12 }] },
      { id: "ORD-1041", customer: "Central Medical Store", date: dateOffset(-2), status: "Fulfilled", items: [{ medicineId: "med-4", quantity: 60 }] },
      { id: "ORD-1040", customer: "Wellness Care Clinic", date: dateOffset(-3), status: "Pending", items: [{ medicineId: "med-2", quantity: 20 }] }
    ],
    returns: [],
    suppliers: [
      { id: "sup-1", name: "Northstar Pharma", contact: "Maya Chen", email: "orders@northstar.example" },
      { id: "sup-2", name: "Cedar Health Supply", contact: "Daniel Ortiz", email: "sales@cedar.example" },
      { id: "sup-3", name: "Everwell Medical", contact: "Amina Patel", email: "supply@everwell.example" }
    ]
  };
}

function loadData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return sampleData();
    const data = JSON.parse(saved);
    if (data && ["medicines", "batches", "orders", "suppliers"].every((key) => Array.isArray(data[key]))) {
      return { ...data, returns: Array.isArray(data.returns) ? data.returns : [] };
    }
    console.error("Saved workspace data has an invalid structure.");
    savedDataError = true;
  } catch (error) {
    console.error("Could not read saved workspace data.", error);
    savedDataError = true;
  }
  return sampleData();
}

let data = loadData();
let activeView = "dashboard";
let searchTerm = "";
let toastTimer;

const content = document.getElementById("app-content");
const modalRoot = document.getElementById("modal-root");
const printRoot = document.getElementById("print-root");
const toast = document.getElementById("toast");
const todayLabel = document.getElementById("today-label");
todayLabel.textContent = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date());
if (savedDataError) showToast("Saved data could not be read. Showing sample data.", true);

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error("Could not save workspace data.", error);
    showToast("Could not save changes in this browser.", true);
    return false;
  }
}

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
}

function id(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function medicineById(medicineId) {
  return data.medicines.find((medicine) => medicine.id === medicineId);
}

function supplierById(supplierId) {
  return data.suppliers.find((supplier) => supplier.id === supplierId);
}

function batchById(batchId) {
  return data.batches.find((batch) => batch.id === batchId);
}

function stockFor(medicineId) {
  return data.batches.filter((batch) => batch.medicineId === medicineId && batch.expiry >= dateOffset(0))
    .reduce((total, batch) => total + Number(batch.quantity), 0);
}

function expiryState(expiry) {
  const days = Math.ceil((new Date(`${expiry}T00:00:00`) - new Date(`${dateOffset(0)}T00:00:00`)) / DAY);
  if (days < 0) return { label: "Expired", className: "danger", days };
  if (days <= 30) return { label: "Expiring soon", className: "danger", days };
  if (days <= 90) return { label: "Expiring", className: "warning", days };
  return { label: "In date", className: "", days };
}

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function pageHeading(eyebrow, title, subtitle, action = "") {
  return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="page-subtitle">${subtitle}</p></div>${action}</div>`;
}

function button(label, action, secondary = false, small = false) {
  return `<button class="button${secondary ? " secondary" : ""}${small ? " small" : ""}" data-action="${action}">${label}</button>`;
}

function tableEmpty(message, colspan) {
  return `<tr><td colspan="${colspan}"><div class="empty-state"><strong>Nothing to show yet</strong>${message}</div></td></tr>`;
}

function statCard(label, value, caption, symbol, tone = "") {
  return `<div class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon ${tone}">${symbol}</span></div><div class="stat-value">${value}</div><div class="stat-caption">${caption}</div></div>`;
}

function renderDashboard() {
  const lowStock = data.medicines.filter((medicine) => stockFor(medicine.id) <= Number(medicine.reorderLevel));
  const expiring = data.batches.filter((batch) => {
    const status = expiryState(batch.expiry);
    return status.days >= 0 && status.days <= 90 && Number(batch.quantity) > 0;
  }).sort((a, b) => a.expiry.localeCompare(b.expiry));
  const pending = data.orders.filter((order) => order.status === "Pending").length;
  const units = data.medicines.reduce((total, medicine) => total + stockFor(medicine.id), 0);
  const alerts = [
    ...lowStock.map((medicine) => ({ icon: "!", tone: "red", title: medicine.name, detail: "Below reorder level", count: `${stockFor(medicine.id)} ${medicine.unit} left` })),
    ...expiring.map((batch) => ({ icon: "◷", tone: "", title: medicineById(batch.medicineId)?.name || "Unknown medicine", detail: `Batch ${batch.number} · expires ${formatDate(batch.expiry)}`, count: `${batch.quantity} units` }))
  ].slice(0, 5);
  const recentOrders = [...data.orders].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  return `${pageHeading("DISTRIBUTION OVERVIEW", "Good morning", "Here's what's happening across your medicine distribution workspace.", button("+ New order", "new-order"))}
    <div class="stats-grid">
      ${statCard("Active medicines", data.medicines.length, "Products in your catalog", "▤")}
      ${statCard("Units in stock", units.toLocaleString(), "Across all in-date batches", "▦")}
      ${statCard("Pending orders", pending, "Awaiting fulfillment", "↗", pending ? "amber" : "")}
      ${statCard("Stock alerts", lowStock.length + expiring.length, "Low stock or expiring soon", "!", lowStock.length + expiring.length ? "red" : "")}
    </div>
    <div class="dashboard-grid">
      <section class="panel"><div class="panel-header"><div><h2>Recent orders</h2><p>Latest activity from your customers</p></div><button class="button ghost small" data-view="orders">View all →</button></div>
        <div class="table-wrap"><table><thead><tr><th>ORDER</th><th>CUSTOMER</th><th>DATE</th><th>STATUS</th></tr></thead><tbody>
          ${recentOrders.length ? recentOrders.map((order) => `<tr><td class="medicine-name">${escapeHtml(order.id)}</td><td>${escapeHtml(order.customer)}</td><td>${formatDate(order.date)}</td><td><span class="badge ${order.status === "Pending" ? "warning" : ""}">${escapeHtml(order.status)}</span></td></tr>`).join("") : tableEmpty("Orders will appear here when created.", 4)}
        </tbody></table></div>
      </section>
      <section class="panel"><div class="panel-header"><div><h2>Attention needed</h2><p>Stock and expiry alerts</p></div><button class="button ghost small" data-view="reports">Reports →</button></div>
        <div class="panel-body"><div class="alert-list">${alerts.length ? alerts.map((alert) => `<div class="alert-row"><span class="alert-symbol ${alert.tone}">${alert.icon}</span><span class="alert-copy"><strong>${escapeHtml(alert.title)}</strong><small>${escapeHtml(alert.detail)}</small></span><span class="alert-count ${alert.tone}">${escapeHtml(alert.count)}</span></div>`).join("") : `<div class="empty-state"><strong>All clear</strong>No low-stock or upcoming expiry alerts.</div>`}</div></div>
      </section>
    </div>`;
}

function renderInventory() {
  const medicines = data.medicines.filter((medicine) => `${medicine.name} ${medicine.sku} ${medicine.category}`.toLowerCase().includes(searchTerm));
  return `${pageHeading("PRODUCT CATALOG", "Inventory", "Manage products, on-hand quantities, and reorder thresholds.", button("+ Add medicine", "new-medicine"))}
    <div class="toolbar"><div class="search-box"><input data-search placeholder="Search medicines, SKU, or category" value="${escapeHtml(searchTerm)}" aria-label="Search medicines"></div><span class="badge neutral">${medicines.length} products</span></div>
    <section class="table-panel"><div class="table-wrap"><table><thead><tr><th>MEDICINE</th><th>SKU</th><th>CATEGORY</th><th>IN STOCK</th><th>REORDER AT</th><th>STATUS</th></tr></thead><tbody>
      ${medicines.length ? medicines.map((medicine) => {
        const quantity = stockFor(medicine.id);
        const low = quantity <= Number(medicine.reorderLevel);
        const batchCount = data.batches.filter((batch) => batch.medicineId === medicine.id && Number(batch.quantity) > 0).length;
        return `<tr><td class="medicine-name">${escapeHtml(medicine.name)}<span class="cell-secondary">${batchCount} active batch${batchCount === 1 ? "" : "es"}</span></td><td>${escapeHtml(medicine.sku)}</td><td>${escapeHtml(medicine.category)}</td><td><strong>${quantity}</strong> ${escapeHtml(medicine.unit)}</td><td>${medicine.reorderLevel} ${escapeHtml(medicine.unit)}</td><td><span class="badge ${low ? "danger" : ""}">${low ? "Low stock" : "In stock"}</span></td></tr>`;
      }).join("") : tableEmpty("Try another search or add a medicine.", 6)}
    </tbody></table></div></section>`;
}

function renderBatches() {
  const batches = data.batches.filter((batch) => {
    const medicine = medicineById(batch.medicineId);
    return `${medicine?.name || ""} ${batch.number} ${supplierById(batch.supplierId)?.name || ""}`.toLowerCase().includes(searchTerm);
  }).sort((a, b) => a.expiry.localeCompare(b.expiry));
  return `${pageHeading("LOT & EXPIRY CONTROL", "Batch tracking", "Trace lots and monitor expiry dates. Expired stock is excluded from available inventory.", button("+ Receive stock", "new-batch"))}
    <div class="toolbar"><div class="search-box"><input data-search placeholder="Search medicine, batch, or supplier" value="${escapeHtml(searchTerm)}" aria-label="Search batches"></div><span class="badge neutral">${batches.length} batches</span></div>
    <section class="table-panel"><div class="table-wrap"><table><thead><tr><th>MEDICINE</th><th>BATCH / LOT</th><th>SUPPLIER</th><th>EXPIRY DATE</th><th>QUANTITY</th><th>STATUS</th></tr></thead><tbody>
      ${batches.length ? batches.map((batch) => {
        const medicine = medicineById(batch.medicineId);
        const supplier = supplierById(batch.supplierId);
        const state = expiryState(batch.expiry);
        return `<tr><td class="medicine-name">${escapeHtml(medicine?.name || "Unknown medicine")}</td><td>${escapeHtml(batch.number)}</td><td>${escapeHtml(supplier?.name || "—")}</td><td>${formatDate(batch.expiry)}</td><td>${Number(batch.quantity).toLocaleString()}</td><td><span class="badge ${state.className}">${state.label}</span></td></tr>`;
      }).join("") : tableEmpty("Receive stock to create your first batch record.", 6)}
    </tbody></table></div></section>`;
}

function renderOrders() {
  const orders = [...data.orders].filter((order) => `${order.id} ${order.customer} ${order.status}`.toLowerCase().includes(searchTerm)).sort((a, b) => b.date.localeCompare(a.date));
  return `${pageHeading("CUSTOMER FULFILLMENT", "Orders", "Create customer orders and fulfill them against available batches.", button("+ New order", "new-order"))}
    <div class="toolbar"><div class="search-box"><input data-search placeholder="Search order or customer" value="${escapeHtml(searchTerm)}" aria-label="Search orders"></div><span class="badge neutral">${orders.length} orders</span></div>
    <section class="table-panel"><div class="table-wrap"><table><thead><tr><th>ORDER</th><th>CUSTOMER</th><th>ITEMS</th><th>ORDER DATE</th><th>STATUS</th><th>FULFILLMENT</th><th>PRINT</th></tr></thead><tbody>
      ${orders.length ? orders.map((order) => `<tr><td class="medicine-name">${escapeHtml(order.id)}</td><td>${escapeHtml(order.customer)}</td><td>${order.items.map((item) => `${escapeHtml(medicineById(item.medicineId)?.name || "Removed product")} × ${Number(item.quantity)}`).join("<br>")}</td><td>${formatDate(order.date)}</td><td><span class="badge ${order.status === "Pending" ? "warning" : ""}">${escapeHtml(order.status)}</span></td><td>${order.status === "Pending" ? `<button class="button secondary small" data-action="fulfill-order" data-id="${escapeHtml(order.id)}">Fulfill</button>` : "—"}</td><td><button class="button ghost small" data-action="print-slip" data-id="${escapeHtml(order.id)}">Order slip</button>${order.status === "Fulfilled" ? ` <button class="button ghost small" data-action="invoice" data-id="${escapeHtml(order.id)}">Invoice</button>` : ""}</td></tr>`).join("") : tableEmpty("Create an order to begin customer fulfillment.", 7)}
    </tbody></table></div></section>`;
}

function renderReturns() {
  const returns = [...data.returns].filter((item) => {
    const batch = batchById(item.batchId);
    const medicine = batch && medicineById(batch.medicineId);
    return `${item.id} ${item.customer} ${item.reference || ""} ${item.reason} ${item.status} ${batch?.number || ""} ${medicine?.name || ""}`.toLowerCase().includes(searchTerm);
  }).sort((a, b) => b.date.localeCompare(a.date));
  const pendingCount = data.returns.filter((item) => item.status === "Quarantined").length;
  const action = button("+ Record return", "new-return");
  return `${pageHeading("RETURN & QUARANTINE CONTROL", "Returns", "Log customer returns, keep them quarantined during inspection, and track their final disposition.", action)}
    <div class="stats-grid">
      ${statCard("Awaiting inspection", pendingCount, "Quarantined; excluded from stock", "◷", pendingCount ? "amber" : "")}
      ${statCard("Restocked", data.returns.filter((item) => item.status === "Restocked").length, "Approved and returned to batch", "↺")}
      ${statCard("Not restocked", data.returns.filter((item) => item.status === "Not restocked").length, "Kept out of available stock", "!", "red")}
      ${statCard("Total return records", data.returns.length, "Return history in this browser", "▤")}
    </div>
    <div class="returns-notice"><strong>Safety check:</strong> returned medicines remain unavailable until inspected. Only approve restocking when packaging integrity, storage conditions, traceability, and local policy permit it.</div>
    <div class="toolbar"><div class="search-box"><input data-search placeholder="Search customer, medicine, batch, or reason" value="${escapeHtml(searchTerm)}" aria-label="Search returns"></div><span class="badge neutral">${returns.length} records</span></div>
    <section class="table-panel"><div class="table-wrap"><table><thead><tr><th>RETURN DATE</th><th>CUSTOMER / REF.</th><th>MEDICINE / BATCH</th><th>QTY</th><th>REASON</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>
      ${returns.length ? returns.map((item) => {
        const batch = batchById(item.batchId);
        const medicine = batch && medicineById(batch.medicineId);
        const pending = item.status === "Quarantined";
        const canRestock = batch && batch.expiry >= dateOffset(0);
        const statusClass = pending ? "warning" : item.status === "Restocked" ? "" : "danger";
        const actionButtons = pending
          ? `<button class="button secondary small" data-action="review-return" data-decision="Restocked" data-id="${escapeHtml(item.id)}" ${canRestock ? "" : "disabled"}>Approve restock</button> <button class="button ghost small" data-action="review-return" data-decision="Not restocked" data-id="${escapeHtml(item.id)}">Do not restock</button>`
          : `<span class="cell-secondary">Reviewed ${formatDate(item.processedAt)}</span>`;
        const batchSummary = batch ? `${batch.number} · expires ${formatDate(batch.expiry)}` : "Batch unavailable";
        return `<tr><td>${formatDate(item.date)}</td><td class="medicine-name">${escapeHtml(item.customer)}${item.reference ? `<span class="cell-secondary">Ref. ${escapeHtml(item.reference)}</span>` : ""}</td><td class="medicine-name">${escapeHtml(medicine?.name || "Unknown medicine")}<span class="cell-secondary">${escapeHtml(batchSummary)}</span></td><td><strong>${Number(item.quantity).toLocaleString()}</strong>${medicine ? ` ${escapeHtml(medicine.unit)}` : ""}</td><td>${escapeHtml(item.reason)}${item.inspectionNotes ? `<span class="cell-secondary">Review: ${escapeHtml(item.inspectionNotes)}</span>` : ""}</td><td><span class="badge ${statusClass}">${escapeHtml(item.status)}</span>${pending && !canRestock ? `<span class="cell-secondary">Expired or batch unavailable</span>` : ""}</td><td>${actionButtons}</td></tr>`;
      }).join("") : tableEmpty("Record a return to start a traceable inspection history.", 7)}
    </tbody></table></div></section>`;
}

function renderSuppliers() {
  const suppliers = data.suppliers.filter((supplier) => `${supplier.name} ${supplier.contact} ${supplier.email}`.toLowerCase().includes(searchTerm));
  return `${pageHeading("SUPPLIER DIRECTORY", "Suppliers", "Keep supplier contacts connected to incoming stock and batch records.", button("+ Add supplier", "new-supplier"))}
    <div class="toolbar"><div class="search-box"><input data-search placeholder="Search suppliers or contacts" value="${escapeHtml(searchTerm)}" aria-label="Search suppliers"></div><span class="badge neutral">${suppliers.length} suppliers</span></div>
    <section class="table-panel"><div class="table-wrap"><table><thead><tr><th>SUPPLIER</th><th>CONTACT</th><th>EMAIL</th><th>ACTIVE BATCHES</th></tr></thead><tbody>
      ${suppliers.length ? suppliers.map((supplier) => {
        const count = data.batches.filter((batch) => batch.supplierId === supplier.id && Number(batch.quantity) > 0).length;
        return `<tr><td class="medicine-name">${escapeHtml(supplier.name)}</td><td>${escapeHtml(supplier.contact || "—")}</td><td>${escapeHtml(supplier.email || "—")}</td><td>${count}</td></tr>`;
      }).join("") : tableEmpty("Add a supplier to keep your directory up to date.", 4)}
    </tbody></table></div></section>`;
}

function renderReports() {
  const lowStock = data.medicines.filter((medicine) => stockFor(medicine.id) <= Number(medicine.reorderLevel));
  const expiring = data.batches.filter((batch) => {
    const days = expiryState(batch.expiry).days;
    return days >= 0 && days <= 90 && Number(batch.quantity) > 0;
  }).sort((a, b) => a.expiry.localeCompare(b.expiry));
  const expired = data.batches.filter((batch) => expiryState(batch.expiry).days < 0 && Number(batch.quantity) > 0);
  return `${pageHeading("INVENTORY HEALTH", "Reports", "Review products that need replenishment and upcoming expiry dates.", `<button class="button secondary" data-action="export-report">↓ Export CSV</button>`)}
    <div class="report-grid">
      <section class="report-card"><h2>Low stock</h2><p>Products at or below their reorder threshold</p>
        ${lowStock.length ? lowStock.map((medicine) => `<div class="report-row"><span><strong>${escapeHtml(medicine.name)}</strong><span class="cell-secondary">Reorder at ${medicine.reorderLevel} ${escapeHtml(medicine.unit)}</span></span><span class="badge danger">${stockFor(medicine.id)} left</span></div>`).join("") : `<div class="empty-state"><strong>No low-stock products</strong>All products are above their reorder level.</div>`}
      </section>
      <section class="report-card"><h2>Expiring in 90 days</h2><p>In-date batches with stock on hand</p>
        ${expiring.length ? expiring.map((batch) => `<div class="report-row"><span><strong>${escapeHtml(medicineById(batch.medicineId)?.name || "Unknown medicine")}</strong><span class="cell-secondary">Batch ${escapeHtml(batch.number)} · ${formatDate(batch.expiry)}</span></span><span class="badge warning">${batch.quantity} units</span></div>`).join("") : `<div class="empty-state"><strong>No upcoming expiries</strong>No in-date batches expire in the next 90 days.</div>`}
      </section>
      <section class="report-card"><h2>Expired stock</h2><p>Expired batches are excluded from available stock</p>
        ${expired.length ? expired.map((batch) => `<div class="report-row"><span><strong>${escapeHtml(medicineById(batch.medicineId)?.name || "Unknown medicine")}</strong><span class="cell-secondary">Batch ${escapeHtml(batch.number)} · expired ${formatDate(batch.expiry)}</span></span><span class="badge danger">${batch.quantity} units</span></div>`).join("") : `<div class="empty-state"><strong>No expired stock</strong>No expired batches with quantity on hand.</div>`}
      </section>
      <section class="report-card"><h2>Order activity</h2><p>Current fulfillment status</p>
        <div class="report-row"><span><strong>Pending orders</strong></span><span class="badge warning">${data.orders.filter((order) => order.status === "Pending").length}</span></div>
        <div class="report-row"><span><strong>Fulfilled orders</strong></span><span class="badge">${data.orders.filter((order) => order.status === "Fulfilled").length}</span></div>
        <div class="report-row"><span><strong>Total orders</strong></span><span class="badge neutral">${data.orders.length}</span></div>
      </section>
    </div>`;
}

function render() {
  const renderers = { dashboard: renderDashboard, inventory: renderInventory, batches: renderBatches, orders: renderOrders, returns: renderReturns, suppliers: renderSuppliers, reports: renderReports };
  document.getElementById("current-section").textContent = pageNames[activeView];
  document.querySelectorAll(".nav-item[data-view]").forEach((item) => item.classList.toggle("active", item.dataset.view === activeView));
  content.innerHTML = renderers[activeView]();
}

function selectOptions(items, getLabel, selectedValue = "") {
  return items.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === selectedValue ? "selected" : ""}>${escapeHtml(getLabel(item))}</option>`).join("");
}

function openModal(title, subtitle, fields, onSubmit, submitLabel = "Save") {
  modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><div><h2 id="modal-title">${title}</h2><p>${subtitle}</p></div><button class="icon-button" type="button" data-action="close-modal" aria-label="Close dialog">×</button></header><form class="modal-form"><div class="form-grid">${fields}</div><p class="form-error" id="form-error" role="alert"></p><div class="form-actions"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button" type="submit">${submitLabel}</button></div></form></section></div>`;
  const backdrop = modalRoot.querySelector(".modal-backdrop");
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closeModal();
  });
  modalRoot.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const result = onSubmit(formData);
    if (result !== false) closeModal();
  });
  modalRoot.querySelector("input, select")?.focus();
}

function field(label, name, type = "text", required = true, extra = "") {
  return `<div class="field"><label for="field-${name}">${label}</label><input id="field-${name}" name="${name}" type="${type}" ${required ? "required" : ""} ${extra}></div>`;
}

function textareaField(label, name, required = true, extra = "") {
  return `<div class="field full"><label for="field-${name}">${label}</label><textarea id="field-${name}" name="${name}" ${required ? "required" : ""} ${extra}></textarea></div>`;
}

function selectField(label, name, options, required = true) {
  return `<div class="field"><label for="field-${name}">${label}</label><select id="field-${name}" name="${name}" ${required ? "required" : ""}>${options}</select></div>`;
}

function formError(message) {
  const error = document.getElementById("form-error");
  error.textContent = message;
  error.style.display = "block";
}

function openMedicineModal() {
  const fields = `${field("Medicine name", "name")}${field("SKU", "sku")}${field("Category", "category")}${selectField("Unit of measure", "unit", ["Box", "Pack", "Bottle", "Sachet", "Vial", "Piece"].map((unit) => `<option>${unit}</option>`).join(""))}${field("Reorder level", "reorderLevel", "number", true, 'min="0" step="1" value="10"')}`;
  openModal("Add medicine", "Add a product to your inventory catalog.", fields, (form) => {
    const sku = String(form.get("sku")).trim();
    if (data.medicines.some((medicine) => medicine.sku.toLowerCase() === sku.toLowerCase())) {
      formError("That SKU is already in use.");
      return false;
    }
    data.medicines.push({
      id: id("med"), name: String(form.get("name")).trim(), sku,
      category: String(form.get("category")).trim(), unit: String(form.get("unit")),
      reorderLevel: Number(form.get("reorderLevel"))
    });
    const saved = saveData();
    render();
    if (saved) showToast("Medicine added to inventory.");
  });
}

function openBatchModal() {
  if (!data.medicines.length) {
    showToast("Add a medicine before receiving stock.", true);
    return;
  }
  const medicineOptions = selectOptions(data.medicines, (medicine) => `${medicine.name} (${medicine.sku})`);
  const supplierOptions = `<option value="">No supplier selected</option>${selectOptions(data.suppliers, (supplier) => supplier.name)}`;
  const fields = `${selectField("Medicine", "medicineId", medicineOptions)}${field("Batch / lot number", "number")}${field("Expiry date", "expiry", "date", true, `min="${dateOffset(0)}"`) }${field("Quantity received", "quantity", "number", true, 'min="1" step="1" value="1"')}${selectField("Supplier", "supplierId", supplierOptions, false)}`;
  openModal("Receive stock", "Record incoming stock against a traceable batch.", fields, (form) => {
    const batchNumber = String(form.get("number")).trim();
    if (data.batches.some((batch) => batch.number.toLowerCase() === batchNumber.toLowerCase())) {
      formError("That batch number already exists.");
      return false;
    }
    data.batches.push({
      id: id("bat"), medicineId: String(form.get("medicineId")), number: batchNumber,
      expiry: String(form.get("expiry")), quantity: Number(form.get("quantity")),
      supplierId: String(form.get("supplierId"))
    });
    const saved = saveData();
    render();
    if (saved) showToast("Stock received and batch recorded.");
  });
}

function openSupplierModal() {
  const fields = `${field("Supplier name", "name")}${field("Contact person", "contact", "text", false)}${field("Email", "email", "email", false)}<div class="field full"><label for="field-phone">Phone (optional)</label><input id="field-phone" name="phone" type="tel"></div>`;
  openModal("Add supplier", "Save a supplier contact for your incoming stock.", fields, (form) => {
    data.suppliers.push({
      id: id("sup"), name: String(form.get("name")).trim(),
      contact: String(form.get("contact")).trim(), email: String(form.get("email")).trim(),
      phone: String(form.get("phone")).trim()
    });
    const saved = saveData();
    render();
    if (saved) showToast("Supplier added.");
  });
}

function openOrderModal() {
  if (!data.medicines.length) {
    showToast("Add a medicine before creating an order.", true);
    return;
  }
  const medicineOptions = selectOptions(data.medicines, (medicine) => `${medicine.name} · ${stockFor(medicine.id)} ${medicine.unit} available`);
  const fields = `<div class="field full"><label for="field-customer">Customer name</label><input id="field-customer" name="customer" required></div>${selectField("Medicine", "medicineId", medicineOptions)}${field("Quantity", "quantity", "number", true, 'min="1" step="1" value="1"')}`;
  openModal("Create order", "Add one product line. You can create additional orders for other products.", fields, (form) => {
    const medicineId = String(form.get("medicineId"));
    const quantity = Number(form.get("quantity"));
    if (!Number.isInteger(quantity) || quantity <= 0) {
      formError("Enter a whole number greater than zero.");
      return false;
    }
    const orderNumber = `ORD-${Math.max(1000, ...data.orders.map((order) => Number(order.id.replace(/\D/g, "")) || 0) + 1)}`;
    data.orders.push({
      id: orderNumber, customer: String(form.get("customer")).trim(), date: dateOffset(0),
      status: "Pending", items: [{ medicineId, quantity }]
    });
    const saved = saveData();
    render();
    if (saved) showToast("Order created. Fulfill it when stock is ready.");
  });
}

function printDocument(title, markup) {
  printRoot.innerHTML = `<article class="print-document">${markup}</article>`;
  document.title = `${title} | Mirza Brothers`;
  window.addEventListener("afterprint", () => { printRoot.innerHTML = ""; }, { once: true });
  window.print();
  document.title = "Mirza Brothers | MedSupply distribution workspace";
}

function printOrderSlip(orderId) {
  const order = data.orders.find((item) => item.id === orderId);
  if (!order) return;
  const rows = order.items.map((item) => `<tr><td>${escapeHtml(medicineById(item.medicineId)?.name || "Removed product")}</td><td>${Number(item.quantity).toLocaleString()}</td></tr>`).join("");
  printDocument(`Order slip ${order.id}`, `
    <header class="print-header">
      <div><h1>Mirza Brothers</h1><p>Main GT Road, Dina</p><p>Phone: 03455675307</p></div>
      <div class="print-meta"><h2>Order slip</h2><p>Order: ${escapeHtml(order.id)}</p><p>Date: ${formatDate(order.date)}</p><p>Status: ${escapeHtml(order.status)}</p></div>
    </header>
    <p class="print-customer"><strong>Customer:</strong> ${escapeHtml(order.customer)}</p>
    <table class="print-table"><thead><tr><th>Item</th><th>Quantity</th></tr></thead><tbody>${rows}</tbody></table>`);
}

function openInvoiceModal(orderId) {
  const order = data.orders.find((item) => item.id === orderId);
  if (!order || order.status !== "Fulfilled") {
    showToast("Fulfill the order before preparing an invoice.", true);
    return;
  }
  const priceFields = order.items.map((item, index) => {
    const name = medicineById(item.medicineId)?.name || "Removed product";
    const price = item.unitPrice !== undefined && item.unitPrice !== null && Number.isFinite(Number(item.unitPrice))
      ? ` value="${Number(item.unitPrice)}"`
      : "";
    return field(`${name} — unit price (PKR)`, `price-${index}`, "number", true, `min="0" step="0.01"${price}`);
  }).join("");
  const taxAmount = Number.isFinite(Number(order.taxAmount)) ? Number(order.taxAmount) : 0;
  const fields = `${priceFields}<div class="field full"><label for="field-taxAmount">Tax amount (PKR, optional)</label><input id="field-taxAmount" name="taxAmount" type="number" min="0" step="0.01" value="${taxAmount}"><small class="form-help">Tax is entered manually when applicable; the app does not calculate tax rules.</small></div>`;
  openModal("Prepare invoice", "Enter each unit price in PKR. You can update these values before printing again.", fields, (form) => {
    const prices = order.items.map((item, index) => {
      const rawPrice = String(form.get(`price-${index}`)).trim();
      return rawPrice === "" ? NaN : Number(rawPrice);
    });
    const rawTaxAmount = String(form.get("taxAmount")).trim();
    const nextTaxAmount = rawTaxAmount === "" ? 0 : Number(rawTaxAmount);
    if (prices.some((price) => !Number.isFinite(price) || price < 0)) {
      formError("Enter a valid non-negative unit price for every item.");
      return false;
    }
    if (!Number.isFinite(nextTaxAmount) || nextTaxAmount < 0) {
      formError("Enter a valid non-negative tax amount or leave it blank.");
      return false;
    }
    const previousPrices = order.items.map((item) => item.unitPrice);
    const previousTaxAmount = order.taxAmount;
    const previousInvoiceDate = order.invoiceDate;
    order.items.forEach((item, index) => { item.unitPrice = prices[index]; });
    order.taxAmount = nextTaxAmount;
    order.invoiceDate = order.invoiceDate || dateOffset(0);
    if (!saveData()) {
      order.items.forEach((item, index) => { item.unitPrice = previousPrices[index]; });
      order.taxAmount = previousTaxAmount;
      order.invoiceDate = previousInvoiceDate;
      return false;
    }
    const subtotal = order.items.reduce((total, item) => total + Number(item.quantity) * Number(item.unitPrice), 0);
    const total = subtotal + nextTaxAmount;
    const rows = order.items.map((item) => {
      const medicine = medicineById(item.medicineId);
      const lineTotal = Number(item.quantity) * Number(item.unitPrice);
      return `<tr><td>${escapeHtml(medicine?.name || "Removed product")}</td><td>${Number(item.quantity).toLocaleString()}</td><td>PKR ${Number(item.unitPrice).toFixed(2)}</td><td>PKR ${lineTotal.toFixed(2)}</td></tr>`;
    }).join("");
    const invoiceNumber = `INV-${order.id}`;
    printDocument(`Invoice ${invoiceNumber}`, `
      <header class="print-header">
        <div><h1>Mirza Brothers</h1><p>Main GT Road, Dina</p><p>Phone: 03455675307</p></div>
        <div class="print-meta"><h2>Invoice</h2><p>Invoice: ${escapeHtml(invoiceNumber)}</p><p>Order: ${escapeHtml(order.id)}</p><p>Date: ${formatDate(order.invoiceDate)}</p></div>
      </header>
      <p class="print-customer"><strong>Bill to:</strong> ${escapeHtml(order.customer)}</p>
      <table class="print-table"><thead><tr><th>Item</th><th>Quantity</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>
      <section class="print-totals"><p>Subtotal <strong>PKR ${subtotal.toFixed(2)}</strong></p>${nextTaxAmount > 0 ? `<p>Tax <strong>PKR ${nextTaxAmount.toFixed(2)}</strong></p>` : ""}<p class="print-grand-total">Total <strong>PKR ${total.toFixed(2)}</strong></p></section>`);
  }, "Save & print");
}

function openReturnModal() {
  if (!data.batches.length) {
    showToast("Receive stock and record a batch before logging a return.", true);
    return;
  }
  const batches = [...data.batches].sort((a, b) => a.expiry.localeCompare(b.expiry));
  const batchOptions = selectOptions(batches, (batch) => {
    const medicine = medicineById(batch.medicineId);
    return `${medicine?.name || "Unknown medicine"} · ${batch.number} · expires ${formatDate(batch.expiry)}`;
  });
  const fields = `${field("Customer / source", "customer")}${field("Original order or reference (optional)", "reference", "text", false)}${selectField("Returned batch / lot", "batchId", batchOptions)}${field("Quantity returned", "quantity", "number", true, 'min="1" step="1" value="1"')}${field("Date received", "date", "date", true, `max="${dateOffset(0)}" value="${dateOffset(0)}"`)}${textareaField("Return reason", "reason", true, 'rows="2" maxlength="500"')}`;
  openModal("Record returned stock", "Log the original batch and keep the units quarantined until the inspection is documented.", fields, (form) => {
    const batch = batchById(String(form.get("batchId")));
    const quantity = Number(form.get("quantity"));
    const returnDate = String(form.get("date"));
    if (!String(form.get("customer")).trim() || !String(form.get("reason")).trim()) {
      formError("Enter the customer or source and a return reason.");
      return false;
    }
    if (!batch) {
      formError("Select a valid batch.");
      return false;
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      formError("Enter a whole number greater than zero.");
      return false;
    }
    if (!returnDate || returnDate > dateOffset(0)) {
      formError("The return date cannot be in the future.");
      return false;
    }
    data.returns.push({
      id: id("ret"),
      customer: String(form.get("customer")).trim(),
      reference: String(form.get("reference")).trim(),
      batchId: batch.id,
      quantity,
      date: returnDate,
      reason: String(form.get("reason")).trim(),
      status: "Quarantined",
      inspectionNotes: "",
      processedAt: ""
    });
    const saved = saveData();
    render();
    if (saved) showToast("Return recorded in quarantine; available stock is unchanged.");
  });
}

function openReturnReviewModal(returnId, decision) {
  const returnRecord = data.returns.find((item) => item.id === returnId && item.status === "Quarantined");
  if (!returnRecord) return;
  const batch = batchById(returnRecord.batchId);
  if (decision === "Restocked" && (!batch || batch.expiry < dateOffset(0))) {
    showToast("This return cannot be restocked because its original batch is expired or unavailable.", true);
    render();
    return;
  }
  const isRestock = decision === "Restocked";
  const instruction = isRestock
    ? "Confirm the returned units meet your inspection and local policy requirements before adding them to the original batch."
    : "Record why these units will not return to available stock.";
  const fields = textareaField("Inspection / disposition notes", "inspectionNotes", true, 'rows="3" maxlength="1000"');
  openModal(isRestock ? "Approve return for restocking" : "Mark return not restockable", instruction, fields, (form) => {
    const notes = String(form.get("inspectionNotes")).trim();
    if (!notes) {
      formError("Enter inspection or disposition notes.");
      return false;
    }
    const oldState = {
      status: returnRecord.status,
      inspectionNotes: returnRecord.inspectionNotes,
      processedAt: returnRecord.processedAt,
      batchQuantity: batch ? batch.quantity : null
    };
    if (isRestock) batch.quantity = Number(batch.quantity) + Number(returnRecord.quantity);
    returnRecord.status = decision;
    returnRecord.inspectionNotes = notes;
    returnRecord.processedAt = dateOffset(0);
    if (!saveData()) {
      returnRecord.status = oldState.status;
      returnRecord.inspectionNotes = oldState.inspectionNotes;
      returnRecord.processedAt = oldState.processedAt;
      if (batch) batch.quantity = oldState.batchQuantity;
      render();
      return;
    }
    render();
    showToast(isRestock ? "Return approved and added to its original batch." : "Return marked not restockable; inventory was not changed.");
  });
}

function fulfillOrder(orderId) {
  const order = data.orders.find((item) => item.id === orderId);
  if (!order || order.status !== "Pending") return;
  for (const item of order.items) {
    const available = stockFor(item.medicineId);
    if (available < Number(item.quantity)) {
      showToast(`Insufficient in-date stock: ${medicineById(item.medicineId)?.name || "product"} has ${available} available.`, true);
      return;
    }
  }
  for (const item of order.items) {
    let remaining = Number(item.quantity);
    const batches = data.batches.filter((batch) => batch.medicineId === item.medicineId && batch.expiry >= dateOffset(0) && Number(batch.quantity) > 0)
      .sort((a, b) => a.expiry.localeCompare(b.expiry));
    for (const batch of batches) {
      const allocated = Math.min(remaining, Number(batch.quantity));
      batch.quantity = Number(batch.quantity) - allocated;
      remaining -= allocated;
      if (remaining === 0) break;
    }
  }
  order.status = "Fulfilled";
  order.fulfilledAt = dateOffset(0);
  const saved = saveData();
  render();
  if (saved) showToast(`${order.id} fulfilled using earliest-expiry batches.`);
}

function exportReport() {
  const rows = [["Record type", "Reference", "Customer", "Medicine", "SKU", "Batch / lot", "Expiry date", "Quantity", "Date", "Reason / notes", "Reorder level", "Status"]];
  data.medicines.forEach((medicine) => {
    const quantity = stockFor(medicine.id);
    rows.push(["Inventory", "", "", medicine.name, medicine.sku, "", "", quantity, "", "", medicine.reorderLevel, quantity <= Number(medicine.reorderLevel) ? "Low stock" : "In stock"]);
  });
  data.batches.forEach((batch) => {
    const medicine = medicineById(batch.medicineId);
    if (!medicine) return;
    rows.push(["Batch", "", "", medicine.name, medicine.sku, batch.number, batch.expiry, batch.quantity, "", "", "", expiryState(batch.expiry).label]);
  });
  data.returns.forEach((item) => {
    const batch = batchById(item.batchId);
    const medicine = batch && medicineById(batch.medicineId);
    rows.push(["Return", item.reference, item.customer, medicine?.name || "Unknown medicine", medicine?.sku || "", batch?.number || "Unknown batch", batch?.expiry || "", item.quantity, item.date, [item.reason, item.inspectionNotes].filter(Boolean).join(" | "), "", item.status]);
  });
  const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "medsupply-inventory-and-returns-report.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  showToast("Inventory report exported.");
}

function closeModal() {
  modalRoot.innerHTML = "";
}

document.getElementById("navigation").addEventListener("click", (event) => {
  const target = event.target.closest("[data-view]");
  if (!target) return;
  activeView = target.dataset.view;
  searchTerm = "";
  render();
  content.focus();
});

document.addEventListener("click", (event) => {
  const viewTarget = event.target.closest("[data-view]");
  if (viewTarget && !document.getElementById("navigation").contains(viewTarget)) {
    activeView = viewTarget.dataset.view;
    searchTerm = "";
    render();
    return;
  }
  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) return;
  switch (actionTarget.dataset.action) {
    case "new-medicine": openMedicineModal(); break;
    case "new-batch": openBatchModal(); break;
    case "new-supplier": openSupplierModal(); break;
    case "new-order": openOrderModal(); break;
    case "new-return": openReturnModal(); break;
    case "review-return": openReturnReviewModal(actionTarget.dataset.id, actionTarget.dataset.decision); break;
    case "fulfill-order": fulfillOrder(actionTarget.dataset.id); break;
    case "print-slip": printOrderSlip(actionTarget.dataset.id); break;
    case "invoice": openInvoiceModal(actionTarget.dataset.id); break;
    case "export-report": exportReport(); break;
    case "close-modal": closeModal(); break;
    case "reset":
      if (window.confirm("Reset this browser workspace to the original sample data? Your saved changes will be lost.")) {
        data = sampleData();
        const saved = saveData();
        activeView = "dashboard";
        searchTerm = "";
        render();
        if (saved) showToast("Sample data restored.");
      }
      break;
  }
});

document.addEventListener("input", (event) => {
  if (!event.target.matches("[data-search]")) return;
  searchTerm = event.target.value.trim().toLowerCase();
  const position = event.target.selectionStart;
  render();
  const input = content.querySelector("[data-search]");
  input?.focus();
  input?.setSelectionRange(position, position);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && modalRoot.firstChild) closeModal();
});

render();
