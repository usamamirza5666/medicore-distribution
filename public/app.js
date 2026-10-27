const app = document.querySelector("#app");
const state = { user:null, csrf:"", page:"dashboard", search:"", cache:{}, products:[], customers:[], suppliers:[], report:null };
const navItems = [
  {id:"dashboard",label:"Overview",icon:"◫",section:"WORKSPACE"},
  {id:"sales",label:"Sales & invoices",icon:"↗"},
  {id:"purchases",label:"Purchases",icon:"↙"},
  {id:"products",label:"Medicine inventory",icon:"▦",section:"OPERATIONS"},
  {id:"customers",label:"Customers",icon:"♙"},
  {id:"suppliers",label:"Suppliers",icon:"♧"},
  {id:"payments",label:"Payments",icon:"৳"},
  {id:"expenses",label:"Expenses",icon:"−"},
  {id:"reports",label:"Reports",icon:"▤",section:"FINANCE"},
  {id:"users",label:"Users & access",icon:"⚙"},
  {id:"audit",label:"Activity log",icon:"◷"},
];
const roleAreas = {
  Administrator:navItems.map((item)=>item.id),
  Manager:["dashboard","sales","purchases","products","customers","suppliers","payments","expenses","reports","users","audit"],
  Salesperson:["dashboard","sales","products","customers","payments"],
  Storekeeper:["dashboard","purchases","products"],
  Accountant:["dashboard","sales","purchases","customers","suppliers","payments","expenses","reports"],
};
const writableRoles = {
  products:["Administrator","Manager","Storekeeper"],
  customers:["Administrator","Manager","Salesperson"],
  suppliers:["Administrator","Manager","Accountant"],
  sales:["Administrator","Manager","Salesperson"],
  purchases:["Administrator","Manager","Storekeeper","Accountant"],
  payments:["Administrator","Manager","Salesperson","Accountant"],
  expenses:["Administrator","Manager","Accountant"],
  users:["Administrator"],
};
const pageTitles = {
  dashboard:["Overview","A clear picture of today's distribution operations."],
  sales:["Sales & invoices","Manage customer invoices, collections and issued stock."],
  purchases:["Purchases","Receive supplier invoices and add traceable medicine batches."],
  products:["Medicine inventory","Batch-aware stock, product details and expiry tracking."],
  customers:["Customers","Pharmacies, hospitals, clinics and their credit balances."],
  suppliers:["Suppliers","Supplier contacts and outstanding payable balances."],
  payments:["Payments","Customer receipts and supplier payments, applied to oldest invoices first."],
  expenses:["Expenses","Operating costs recorded for accurate net profit reporting."],
  reports:["Reports","Date-filtered sales, stock valuation, gross profit and expenses."],
  users:["Users & access","Create accounts with role-based access to business modules."],
  audit:["Activity log","Review important account and transaction events."],
};
const money = (value) => new Intl.NumberFormat("en-PK",{style:"currency",currency:"PKR",maximumFractionDigits:2}).format(Number(value||0));
const shortDate = (value) => value ? new Date(`${value.slice(0,10)}T00:00:00`).toLocaleDateString("en-PK",{day:"2-digit",month:"short",year:"numeric"}) : "—";
const escapeHtml = (value) => String(value??"").replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const today = () => new Date().toISOString().slice(0,10);
const allowed = (page) => (roleAreas[state.user?.role]||[]).includes(page);
const canWrite = (page) => (writableRoles[page]||[]).includes(state.user?.role);

async function api(url, options={}) {
  const headers = { ...(options.body?{"Content-Type":"application/json"}:{}), ...(options.method&&options.method!=="GET"?{"X-CSRF-Token":state.csrf}:{}), ...options.headers };
  const response = await fetch(url,{...options,headers,credentials:"same-origin"});
  const data = response.status===204?{}:await response.json().catch(()=>({error:"The server returned an invalid response."}));
  if (!response.ok) throw new Error(data.error||`Request failed (${response.status}).`);
  return data;
}
function toast(message,success=false) {
  document.querySelector(".toast")?.remove();
  const node=document.createElement("div");node.className=`toast${success?" success":""}`;node.textContent=message;
  document.body.append(node);setTimeout(()=>node.remove(),3800);
}
function loading(message="Loading…") { return `<div class="empty"><span class="spinner" style="display:inline-block;vertical-align:middle;margin-right:8px;width:17px;height:17px"></span>${escapeHtml(message)}</div>`; }
function field(name,label,type="text",options={}) {
  const required=options.required===false?"":"required";
  const value=options.value??"";
  if(type==="select") return `<div class="field"><label for="${name}">${label}</label><select id="${name}" name="${name}" ${required}>${(options.choices||[]).map(([v,l])=>`<option value="${escapeHtml(v)}">${escapeHtml(l)}</option>`).join("")}</select></div>`;
  const step=type==="number"?(options.integer?"1":"0.01"):"";
  return `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" ${type==="number"?`step="${step}" min="${options.min??0}"`:""} ${options.max?`max="${options.max}"`:""} ${options.placeholder?`placeholder="${escapeHtml(options.placeholder)}"`:""} ${options.value!==undefined?`value="${escapeHtml(value)}"`:""} ${required}></div>`;
}
function pageHeading(page,action="") {
  const [title,description]=pageTitles[page];
  return `<div class="page-heading"><div><h2>${title}</h2><p>${description}</p></div>${action}</div>`;
}
function authScreen(setup=false) {
  app.innerHTML=`<div class="auth-wrap"><aside class="auth-art"><div class="brand"><span class="brand-mark">✚</span>MediCore</div><div class="auth-copy"><h1>Better visibility.<br>Safer distribution.</h1><p>A practical workspace for medicine inventory, batch traceability, sales, purchasing and financial control.</p></div><div class="auth-foot">Designed for pharmaceutical wholesale and distribution in Pakistan.</div></aside><main class="auth-form-side"><form class="auth-card" id="auth-form"><div class="brand" style="color:var(--green);margin-bottom:27px"><span class="brand-mark">✚</span>MediCore</div><h2>${setup?"Set up your business":"Welcome back"}</h2><p class="sub">${setup?"Create the first administrator account to get started.":"Sign in to continue to your workspace."}</p><div id="auth-error"></div>${field("username","Username","text",{placeholder:"e.g. admin",max:60})}${field("password",setup?"Create password":"Password","password",{placeholder:setup?"At least 12 characters":"Enter your password"})}${setup?`<p class="section-caption">Use a unique password with at least 12 characters. Additional accounts can be created by an administrator.</p>`:""}<button class="primary" type="submit">${setup?"Create administrator":"Sign in"}</button></form></main></div>`;
  document.querySelector("#auth-form").addEventListener("submit",async(event)=>{
    event.preventDefault();const button=event.currentTarget.querySelector("button");button.disabled=true;button.textContent=setup?"Creating account…":"Signing in…";
    try {const values=Object.fromEntries(new FormData(event.currentTarget));const result=await api(setup?"/api/setup":"/api/login",{method:"POST",body:JSON.stringify(values)});state.user=result.user;state.csrf=result.csrf;state.page="dashboard";await render();}
    catch(error){document.querySelector("#auth-error").innerHTML=`<div class="auth-error">${escapeHtml(error.message)}</div>`;button.disabled=false;button.textContent=setup?"Create administrator":"Sign in";}
  });
}
function shell() {
  const nav=navItems.filter((item)=>allowed(item.id)).map((item)=>`${item.section?`<div class="nav-caption">${item.section}</div>`:""}<button class="nav-item ${state.page===item.id?"active":""}" data-nav="${item.id}"><span class="nav-icon">${item.icon}</span>${item.label}</button>`).join("");
  const [title]=pageTitles[state.page]||pageTitles.dashboard;
  app.innerHTML=`<aside class="sidebar" id="sidebar"><div class="brand"><span class="brand-mark">✚</span>MediCore</div><nav class="nav-list">${nav}</nav><div class="side-bottom"><div class="user-chip"><div class="avatar">${escapeHtml(state.user.username.slice(0,1).toUpperCase())}</div><div class="user-info"><div class="user-name">${escapeHtml(state.user.username)}</div><div class="user-role">${escapeHtml(state.user.role)}</div></div></div><button class="nav-item" data-action="logout"><span class="nav-icon">↪</span>Sign out</button></div></aside><main class="main"><header class="topbar"><h1><button class="mobile-menu" data-action="menu" aria-label="Open menu">☰</button>${title}</h1><div class="top-meta"><span class="today-label">${new Date().toLocaleDateString("en-PK",{weekday:"short",day:"numeric",month:"short",year:"numeric"})}</span><span class="badge">${escapeHtml(state.user.role)}</span></div></header><section class="content" id="content">${loading()}</section></main>`;
}
function tableMarkup(columns,rows,empty="No records yet.") {
  if(!rows.length)return `<div class="empty">${escapeHtml(empty)}</div>`;
  return `<div class="table-wrap"><table><thead><tr>${columns.map((col)=>`<th>${col.label}</th>`).join("")}</tr></thead><tbody>${rows.map((row)=>`<tr>${columns.map((col)=>`<td>${col.render?col.render(row):escapeHtml(row[col.key])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function metric(title,value,foot,icon) { return `<article class="metric-card"><span class="metric-icon">${icon}</span><div class="metric-title">${title}</div><div class="metric-value">${value}</div><div class="metric-foot">${foot}</div></article>`; }
function alertRows(rows,kind) {
  if(!rows.length)return `<div class="empty">No ${kind==="expired"?"expired":"near-expiry"} batches at this time.</div>`;
  return `<div class="alert-list">${rows.map((row)=>`<div class="alert-row"><div><span class="alert-label">${escapeHtml(row.name)}</span><small>${kind==="low"?`${Number(row.quantity)} units · reorder at ${row.reorder_level}`:`Batch ${escapeHtml(row.batch_no)} · expires ${shortDate(row.expiry_date)}`}</small></div><span class="badge ${kind==="expired"?"danger":kind==="low"?"warning":"neutral"}">${kind==="low"?"Low stock":kind==="expired"?"Expired":`${row.quantity} units`}</span></div>`).join("")}</div>`;
}
async function dashboard() {
  const d=await api("/api/dashboard");state.cache.dashboard=d;
  return `${pageHeading("dashboard")}<div class="metric-grid">
    ${metric("Sales today",money(d.sales.today),"Posted invoices today","↗")}
    ${metric("Sales this month",money(d.sales.month),"Month to date","▤")}
    ${metric("Sales this year",money(d.sales.year),"Year to date","◷")}
    ${metric("Inventory value",money(d.inventoryValue),`${Number(d.inventoryUnits).toLocaleString()} sellable units`,"▦")}
    ${metric("Customer receivables",money(d.receivables),"Outstanding sales invoices","৳")}
    ${metric("Supplier payables",money(d.payables),"Outstanding purchase invoices","↙")}
    ${metric("Net profit this month",money(d.netProfit),"Gross profit less recorded expenses","⌁")}
    ${metric("Purchases recorded",money(d.purchases),"All posted purchases","＋")}
  </div><div class="dashboard-grid"><section class="panel"><div class="panel-head"><h3>Recent sales</h3>${allowed("sales")?'<button class="link-button" data-nav="sales">View sales →</button>':""}</div><div class="panel-body no-pad">${tableMarkup([{label:"Invoice",key:"invoice_no"},{label:"Customer",key:"customer"},{label:"Date",render:r=>shortDate(r.invoice_date)},{label:"Total",render:r=>money(r.total)}],d.recentSales,"No sales invoices posted yet.")}</div></section><section class="panel"><div class="panel-head"><h3>Stock watch</h3>${allowed("products")?'<button class="link-button" data-nav="products">Inventory →</button>':""}</div><div class="panel-body">${alertRows(d.lowStock,"low")}</div></section></div><div class="dashboard-grid"><section class="panel"><div class="panel-head"><h3>Recent purchases</h3>${allowed("purchases")?'<button class="link-button" data-nav="purchases">View purchases →</button>':""}</div><div class="panel-body no-pad">${tableMarkup([{label:"Supplier invoice",key:"invoice_no"},{label:"Supplier",key:"supplier"},{label:"Date",render:r=>shortDate(r.invoice_date)},{label:"Total",render:r=>money(r.total)}],d.recentPurchases,"No purchases posted yet.")}</div></section><section class="panel"><div class="panel-head"><h3>Near expiry · next 90 days</h3><span class="badge warning">${d.expiring.length} batches</span></div><div class="panel-body">${alertRows(d.expiring,"expiring")}</div></section></div><div class="dashboard-grid"><section class="panel"><div class="panel-head"><h3>Expired on-hand stock</h3><span class="badge danger">${d.expired.length} batches</span></div><div class="panel-body">${alertRows(d.expired,"expired")}</div></section><section class="panel"><div class="panel-head"><h3>Operations</h3>${allowed("products")?'<button class="link-button" data-nav="products">Open inventory →</button>':""}</div><div class="panel-body"><p class="section-caption">Batch stock is allocated by earliest expiry. Expired stock remains traceable and is excluded from saleable inventory value.</p><span class="badge">${Number(d.inventoryUnits).toLocaleString()} sellable units</span></div></section></div>`;
}

const productFields=()=>`<div class="form-grid">${field("name","Medicine name")}${field("brand","Brand")}${field("generic_name","Generic name")}${field("manufacturer","Manufacturer")}${field("category","Category")}${field("dosage_form","Dosage form","text",{placeholder:"Tablet, syrup, injection…"})}${field("strength","Strength","text",{placeholder:"e.g. 500 mg"})}${field("pack_size","Pack size","text",{placeholder:"e.g. 10 tablets"})}${field("barcode","Barcode","text",{required:false})}${field("reorder_level","Low-stock threshold","number",{integer:true,value:10})}${field("sale_price","Sale price","number",{value:0})}${field("retail_price","Retail price","number",{value:0})}</div>`;
const customerFields=()=>`<div class="form-grid">${field("name","Pharmacy / customer name")}${field("contact_person","Contact person")}${field("phone","Phone number","tel")}${field("type","Customer type","select",{choices:[["Pharmacy","Pharmacy"],["Medical store","Medical store"],["Hospital","Hospital"],["Clinic","Clinic"],["Other","Other"]]})}${field("credit_limit","Credit limit (PKR)","number",{value:0})}${field("opening_balance","Opening balance (PKR)","number",{value:0})}<div class="field"><label for="address">Address</label><textarea id="address" name="address"></textarea></div></div>`;
const supplierFields=()=>`<div class="form-grid">${field("name","Supplier / company name")}${field("contact_person","Contact person")}${field("phone","Phone number","tel")}${field("payment_terms","Payment terms","text",{placeholder:"e.g. Net 30"})}${field("opening_balance","Opening balance (PKR)","number",{value:0})}<div class="field"><label for="address">Address</label><textarea id="address" name="address"></textarea></div></div>`;
const actionButton=(action,label)=>`<button class="primary" data-action="${action}">＋ ${label}</button>`;
function formCard(title,fields,submitLabel="Save") { return `<form class="form-card" id="entry-form"><h3>${title}</h3>${fields}<div class="form-actions"><button type="button" class="secondary" data-action="cancel-form">Cancel</button><button type="submit" class="primary">${submitLabel}</button></div></form>`; }
function dataTable(title,search=true) { return `<section class="table-card"><div class="table-head"><h3>${title}</h3>${search?`<div class="toolbar"><input id="table-search" type="search" placeholder="Search records…" value="${escapeHtml(state.search)}" aria-label="Search records"></div>`:""}</div><div id="table-content">${loading()}</div></section>`; }
function filterRows(rows) {
  const query=state.search.trim().toLowerCase();
  return query?rows.filter((row)=>Object.values(row).some((value)=>String(value??"").toLowerCase().includes(query))):rows;
}
function setTable(columns,rows,empty) {
  state.table={columns,rows,empty};
  const target=document.querySelector("#table-content");
  if(target)target.innerHTML=tableMarkup(columns,filterRows(rows),empty);
}
async function productsPage() {
  const [products]=await Promise.all([api("/api/products")]);state.products=products;state.cache.products=products;
  const columns=[{label:"Medicine",render:r=>`<strong>${escapeHtml(r.name)}</strong><small style="display:block;color:#80908c;margin-top:3px">${escapeHtml([r.brand,r.strength,r.pack_size].filter(Boolean).join(" · ")||"—")}</small>`},{label:"Generic / company",render:r=>`${escapeHtml(r.generic_name||"—")}<small style="display:block;color:#80908c;margin-top:3px">${escapeHtml(r.manufacturer||"")}</small>`},{label:"On hand",render:r=>`${Number(r.quantity).toLocaleString()} ${r.quantity<=r.reorder_level?'<span class="badge warning">Reorder</span>':""}`},{label:"Next action",render:r=>`<span class="badge ${r.quantity<=r.reorder_level?"warning":"neutral"}">Min. ${r.reorder_level}</span>`},{label:"Sale price",render:r=>money(r.sale_price)},{label:"Value",render:r=>money(r.stock_value)}];
  return `${pageHeading("products",canWrite("products")?actionButton("add-product","New medicine"):"")}${state.showForm==="product"?formCard("Medicine details",productFields()):""}${dataTable("Product catalogue")}${setTableLater(columns,products,"Add a medicine to begin tracking stock.")}`;
}
function setTableLater(columns,rows,empty) { state.table={columns,rows,empty};return ""; }
async function customersPage() {
  const rows=await api("/api/customers");state.cache.customers=rows;
  const columns=[{label:"Customer",render:r=>`<strong>${escapeHtml(r.name)}</strong><small style="display:block;color:#80908c;margin-top:3px">${escapeHtml(r.type)}</small>`},{label:"Contact",render:r=>`${escapeHtml(r.contact_person||"—")}<small style="display:block;color:#80908c;margin-top:3px">${escapeHtml(r.phone||"")}</small>`},{label:"Address",key:"address"},{label:"Credit limit",render:r=>money(r.credit_limit)},{label:"Outstanding",render:r=>`<strong>${money(r.balance)}</strong>`}];
  return `${pageHeading("customers",canWrite("customers")?actionButton("add-customer","New customer"):"")}${state.showForm==="customer"?formCard("Customer profile",customerFields()):""}${dataTable("Customer directory")}${setTableLater(columns,rows,"Add a pharmacy or customer to begin.")}`;
}
async function suppliersPage() {
  const rows=await api("/api/suppliers");state.cache.suppliers=rows;
  const columns=[{label:"Supplier",render:r=>`<strong>${escapeHtml(r.name)}</strong><small style="display:block;color:#80908c;margin-top:3px">${escapeHtml(r.payment_terms||"")}</small>`},{label:"Contact",render:r=>`${escapeHtml(r.contact_person||"—")}<small style="display:block;color:#80908c;margin-top:3px">${escapeHtml(r.phone||"")}</small>`},{label:"Address",key:"address"},{label:"Opening balance",render:r=>money(r.opening_balance)},{label:"Outstanding",render:r=>`<strong>${money(r.balance)}</strong>`}];
  return `${pageHeading("suppliers",canWrite("suppliers")?actionButton("add-supplier","New supplier"):"")}${state.showForm==="supplier"?formCard("Supplier profile",supplierFields()):""}${dataTable("Supplier directory")}${setTableLater(columns,rows,"Add a supplier to begin.")}`;
}
async function salesPage() {
  const [rows,products,customers]=await Promise.all([api("/api/sales"),api("/api/products"),api("/api/customers")]);state.products=products;state.customers=customers;state.cache.sales=rows;
  const cols=[{label:"Invoice",render:r=>`<button class="link-button" data-print-sale="${r.id}">${escapeHtml(r.invoice_no)}</button>`},{label:"Customer",render:r=>escapeHtml(r.customer||"Cash sale")},{label:"Date",render:r=>shortDate(r.invoice_date)},{label:"Total",render:r=>money(r.total)},{label:"Paid",render:r=>money(r.paid)},{label:"Balance",render:r=>money(r.total-r.paid)},{label:"Status",render:r=>`<span class="badge">${escapeHtml(r.status)}</span>`}];
  return `${pageHeading("sales",canWrite("sales")?actionButton("add-sale","New sale"):"")}${state.showForm==="sale"?saleForm(products,customers):""}${dataTable("Sales invoices")}${setTableLater(cols,rows,"No sales recorded yet.")}`;
}
function saleForm(products,customers) {
  const productOptions=products.map(p=>`<option value="${p.id}" data-price="${p.sale_price}">${escapeHtml(p.name)}${p.strength?` · ${escapeHtml(p.strength)}`:""} (${p.quantity} in stock)</option>`).join("");
  const customerOptions=customers.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  return `<form class="form-card" id="entry-form"><h3>New sales invoice</h3><div class="form-grid">${field("customer_id","Customer","select",{required:false,choices:[["","Cash sale"],...customers.map(c=>[c.id,c.name])]})}${field("invoice_date","Invoice date","date",{value:today()})}${field("payment_method","Payment method","select",{choices:[["Cash","Cash"],["Bank transfer","Bank transfer"],["Cheque","Cheque"],["Other","Other"]]})}${field("discount","Invoice discount (PKR)","number",{value:0})}${field("tax","Tax / other charges (PKR)","number",{value:0})}${field("paid","Amount received (PKR)","number",{value:0})}</div><p class="section-caption">For a cash sale, enter the full paid amount. The system deducts batches by earliest expiry (FEFO) and rejects expired or insufficient stock.</p><div class="line-header"><span>Medicine</span><span>Quantity</span><span>Sale price</span><span></span></div><div class="line-items" id="line-items" data-kind="sale">${saleLine(productOptions)}</div><button class="secondary" type="button" data-action="add-line">＋ Add medicine</button><div class="total-strip">Invoice total <span id="invoice-total">${money(0)}</span></div><div class="form-actions"><button type="button" class="secondary" data-action="cancel-form">Cancel</button><button type="submit" class="primary">Post invoice</button></div></form>`;
}
function saleLine(options) { return `<div class="line-row"><select name="product_id" required><option value="">Select medicine</option>${options}</select><input name="quantity" type="number" step="1" min="1" value="1" required placeholder="Qty"><input name="unit_price" type="number" step="0.01" min="0" required placeholder="Price"><button type="button" class="danger-button" data-action="remove-line" aria-label="Remove item">×</button></div>`; }
async function purchasesPage() {
  const [rows,products,suppliers]=await Promise.all([api("/api/purchases"),api("/api/products"),api("/api/suppliers")]);state.products=products;state.suppliers=suppliers;state.cache.purchases=rows;
  const cols=[{label:"Supplier invoice",key:"invoice_no"},{label:"Supplier",key:"supplier"},{label:"Date",render:r=>shortDate(r.invoice_date)},{label:"Total",render:r=>money(r.total)},{label:"Paid",render:r=>money(r.paid)},{label:"Balance",render:r=>money(r.total-r.paid)}];
  return `${pageHeading("purchases",canWrite("purchases")?actionButton("add-purchase","Record purchase"):"")}${state.showForm==="purchase"?purchaseForm(products,suppliers):""}${dataTable("Purchase invoices")}${setTableLater(cols,rows,"No purchases recorded yet.")}`;
}
function purchaseForm(products,suppliers) {
  const productOptions=products.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}${p.strength?` · ${escapeHtml(p.strength)}`:""}</option>`).join("");
  return `<form class="form-card" id="entry-form"><h3>Supplier purchase invoice</h3><div class="form-grid">${field("supplier_id","Supplier","select",{choices:[["","Select supplier"],...suppliers.map(s=>[s.id,s.name])]})}${field("invoice_no","Supplier invoice number")}${field("invoice_date","Invoice date","date",{value:today()})}${field("paid","Amount paid now (PKR)","number",{value:0})}</div><p class="section-caption">Each line creates or updates a traceable batch. Expiry dates in the past cannot be received.</p><div class="purchase-scroll"><div class="line-header purchase"><span>Medicine</span><span>Batch number</span><span>Quantity</span><span>Manufactured</span><span>Expiry</span><span>Unit cost</span><span></span></div><div class="line-items" id="line-items" data-kind="purchase">${purchaseLine(productOptions)}</div></div><button class="secondary" type="button" data-action="add-line">＋ Add batch</button><div class="form-actions"><button type="button" class="secondary" data-action="cancel-form">Cancel</button><button type="submit" class="primary">Post purchase</button></div></form>`;
}
function purchaseLine(options) { return `<div class="line-row purchase"><select name="product_id" required><option value="">Select medicine</option>${options}</select><input name="batch_no" required placeholder="Batch #"><input name="quantity" type="number" step="1" min="1" value="1" required placeholder="Qty"><input name="manufacturing_date" type="date" aria-label="Manufacturing date (optional)"><input name="expiry_date" type="date" required aria-label="Expiry date"><input name="purchase_price" type="number" step="0.01" min="0" required placeholder="Cost"><button type="button" class="danger-button" data-action="remove-line" aria-label="Remove batch">×</button></div>`; }
async function paymentsPage() {
  const [rows,customers,suppliers]=await Promise.all([api("/api/payments"),api("/api/customers"),api("/api/suppliers")]);state.customers=customers;state.suppliers=suppliers;
  const cols=[{label:"Date",render:r=>shortDate(r.payment_date)},{label:"Party",render:r=>`${escapeHtml(r.party_type)} #${r.party_id}`},{label:"Direction",render:r=>`<span class="badge">${r.direction==="receipt"?"Receipt":"Payment"}</span>`},{label:"Amount",render:r=>money(r.amount)},{label:"Method",key:"method"},{label:"Reference",key:"reference"}];
  return `${pageHeading("payments",canWrite("payments")?actionButton("add-payment","Record payment"):"")}${state.showForm==="payment"?paymentForm(customers,suppliers):""}${dataTable("Payment history")}${setTableLater(cols,rows,"No payments recorded yet.")}`;
}
function paymentForm(customers,suppliers) {
  return `<form class="form-card" id="entry-form"><h3>Record customer receipt or supplier payment</h3><div class="form-grid">${field("party_type","Account type","select",{choices:[["customer","Customer receipt"],["supplier","Supplier payment"]]})}<div class="field"><label for="party_id">Customer / supplier</label><select name="party_id" id="party_id" required></select></div>${field("amount","Amount (PKR)","number",{min:.01})}${field("method","Payment method","select",{choices:[["Cash","Cash"],["Bank transfer","Bank transfer"],["Cheque","Cheque"],["Other","Other"]]})}${field("reference","Reference","text",{required:false})}${field("payment_date","Payment date","date",{value:today()})}</div><p class="section-caption">Amounts are applied to the oldest outstanding invoices. Receipts above the outstanding balance are rejected to prevent duplicate credits.</p><div class="form-actions"><button type="button" class="secondary" data-action="cancel-form">Cancel</button><button type="submit" class="primary">Save payment</button></div></form>`;
}
async function expensesPage() {
  const rows=await api("/api/expenses");
  const cols=[{label:"Date",render:r=>shortDate(r.expense_date)},{label:"Category",render:r=>`<strong>${escapeHtml(r.category)}</strong>`},{label:"Description",key:"description"},{label:"Method",key:"payment_method"},{label:"Amount",render:r=>money(r.amount)}];
  const form=`<div class="form-grid">${field("category","Category","select",{choices:[["Transport","Transport"],["Fuel","Fuel"],["Rent","Rent"],["Salaries","Salaries"],["Utilities","Utilities"],["Other","Other"]]})}<div class="field"><label for="description">Description</label><input id="description" name="description" maxlength="250"></div>${field("amount","Amount (PKR)","number",{min:.01})}${field("payment_method","Payment method","select",{choices:[["Cash","Cash"],["Bank transfer","Bank transfer"],["Cheque","Cheque"]]})}${field("expense_date","Expense date","date",{value:today()})}</div>`;
  return `${pageHeading("expenses",canWrite("expenses")?actionButton("add-expense","Record expense"):"")}${state.showForm==="expense"?formCard("Expense details",form):""}${dataTable("Expense register")}${setTableLater(cols,rows,"No expenses recorded yet.")}`;
}
async function usersPage() {
  const [rows,auditRows]=await Promise.all([api("/api/users"),api("/api/audit")]);
  const cols=[{label:"Username",render:r=>`<strong>${escapeHtml(r.username)}</strong>`},{label:"Role",render:r=>`<span class="badge">${escapeHtml(r.role)}</span>`},{label:"Status",render:r=>r.active?'<span class="badge">Active</span>':'<span class="badge neutral">Disabled</span>'},{label:"Created",render:r=>shortDate(r.created_at)}];
  return `${pageHeading("users",canWrite("users")?actionButton("add-user","New user"):"")}${state.showForm==="user"?formCard("Create team account",`<div class="form-grid">${field("username","Username")}${field("password","Temporary password","password",{placeholder:"At least 12 characters"})}${field("role","Role","select",{choices:[["Manager","Manager"],["Salesperson","Salesperson"],["Storekeeper","Storekeeper"],["Accountant","Accountant"],["Administrator","Administrator"]]})}</div>`):""}${dataTable("Team accounts")}${setTableLater(cols,rows,"No team members found.")}<div style="height:16px"></div>${pageHeading("audit")}${`<section class="table-card"><div class="table-head"><h3>Latest activity</h3></div><div>${tableMarkup([{label:"Date",render:r=>new Date(r.created_at+"Z").toLocaleString()},{label:"User",key:"username"},{label:"Action",key:"action"},{label:"Record",render:r=>`${escapeHtml(r.entity)} ${r.entity_id??""}`},{label:"Details",key:"details"}],auditRows)}</div></section>`}`;
}
async function auditPage() {
  const rows=await api("/api/audit");
  const cols=[{label:"Date",render:r=>new Date(r.created_at+"Z").toLocaleString()},{label:"User",key:"username"},{label:"Action",key:"action"},{label:"Record",render:r=>`${escapeHtml(r.entity)} ${r.entity_id??""}`},{label:"Details",key:"details"}];
  return `${pageHeading("audit")}${dataTable("Audit trail")}${setTableLater(cols,rows,"No activity has been logged yet.")}`;
}
async function reportsPage() {
  const from=document.querySelector("#report-from")?.value||`${today().slice(0,8)}01`;
  const to=document.querySelector("#report-to")?.value||today();
  const report=await api(`/api/reports?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  state.report=report;

  const sales=report.sales.map(row=>({
    date:row.invoice_date,
    invoices:row.invoices,
    revenue:row.revenue,
    cogs:row.cogs,
    profit:row.revenue-row.cogs
  }));

  const summaryHtml=`<div class="report-summary">
    <div class="summary-item"><span>Sales revenue</span><strong>${money(sales.reduce((s,r)=>s+r.revenue,0))}</strong></div>
    <div class="summary-item"><span>Cost of goods sold</span><strong>${money(sales.reduce((s,r)=>s+r.cogs,0))}</strong></div>
    <div class="summary-item"><span>Gross profit</span><strong>${money(report.grossProfit)}</strong></div>
    <div class="summary-item"><span>Operating expenses</span><strong>${money(report.expenses)}</strong></div>
    <div class="summary-item"><span>Net profit</span><strong>${money(report.netProfit)}</strong></div>
    <div class="summary-item"><span>Purchases</span><strong>${money(report.purchases)}</strong></div>
  </div>`;

  const salesTable = tableMarkup([
    {label:"Date",render:r=>shortDate(r.date)},
    {label:"Invoices",key:"invoices"},
    {label:"Sales revenue",render:r=>money(r.revenue)},
    {label:"COGS",render:r=>money(r.cogs)},
    {label:"Gross profit",render:r=>money(r.profit)}
  ], sales, "No sales in this date range.");

  const invTable = tableMarkup([
    {label:"Medicine",render:r=>`${escapeHtml(r.name)} ${escapeHtml(r.brand||"")}`},
    {label:"Batch",key:"batch_no"},
    {label:"Manufactured",render:r=>shortDate(r.manufacturing_date)},
    {label:"Expiry",render:r=>shortDate(r.expiry_date)},
    {label:"Quantity",key:"quantity"},
    {label:"Unit cost",render:r=>money(r.purchase_price)},
    {label:"Value",render:r=>money(r.quantity * r.purchase_price)}
  ], report.inventory||[], "No inventory batches found.");

  const filterBar = `<div class="toolbar" style="margin-bottom:16px"><div class="field" style="margin-bottom:0"><label for="report-from">From</label><input id="report-from" type="date" value="${from}"></div><div class="field" style="margin-bottom:0"><label for="report-to">To</label><input id="report-to" type="date" value="${to}"></div><button class="primary" data-action="filter-report" style="align-self:flex-end">Apply filter</button></div>`;

  return `${pageHeading("reports")}${filterBar}${summaryHtml}<div class="panel" style="margin-top:16px"><div class="panel-head"><h3>Daily sales & profitability</h3></div><div class="panel-body no-pad">${salesTable}</div></div><div class="panel" style="margin-top:16px"><div class="panel-head"><h3>Batch-wise inventory valuation</h3><span class="badge">Total ${money(report.inventoryValue)}</span></div><div class="panel-body no-pad">${invTable}</div></div>`;
}

async function render() {
  if (!state.user) {
    try {
      const res = await api("/api/session");
      state.user = res.user;
      state.csrf = res.csrf;
    } catch {
      try {
        const setupRes = await api("/api/setup-status");
        if (setupRes.needsSetup) { authScreen(true); return; }
      } catch {}
      authScreen(false);
      return;
    }
  }
  shell();
  const content = document.querySelector("#content");
  state.showForm = state.showForm || null;
  let html = "";
  if (state.page === "dashboard") html = await dashboard();
  else if (state.page === "products") html = await productsPage();
  else if (state.page === "customers") html = await customersPage();
  else if (state.page === "suppliers") html = await suppliersPage();
  else if (state.page === "sales") html = await salesPage();
  else if (state.page === "purchases") html = await purchasesPage();
  else if (state.page === "payments") html = await paymentsPage();
  else if (state.page === "expenses") html = await expensesPage();
  else if (state.page === "users") html = await usersPage();
  else if (state.page === "audit") html = await auditPage();
  else if (state.page === "reports") html = await reportsPage();
  else html = `<div class="empty">Page not found.</div>`;
  content.innerHTML = html;
  if (state.table) {
    setTable(state.table.columns, state.table.rows, state.table.empty);
    state.table = null;
  }
}

app.addEventListener("click", async (e) => {
  const navBtn = e.target.closest("[data-nav]");
  if (navBtn) {
    const page = navBtn.dataset.nav;
    if (allowed(page)) {
      state.page = page;
      state.showForm = null;
      state.search = "";
      await render();
    } else {
      toast("Access restricted for your role.");
    }
    return;
  }
  const actionBtn = e.target.closest("[data-action]");
  if (actionBtn) {
    const action = actionBtn.dataset.action;
    if (action === "logout") {
      try { await api("/api/logout", { method: "POST" }); } catch {}
      state.user = null;
      state.csrf = "";
      authScreen(false);
      toast("Signed out successfully.");
    } else if (action === "menu") {
      document.querySelector("#sidebar")?.classList.toggle("open");
    } else if (action === "add-product") { state.showForm = "product"; await render(); }
    else if (action === "add-customer") { state.showForm = "customer"; await render(); }
    else if (action === "add-supplier") { state.showForm = "supplier"; await render(); }
    else if (action === "add-sale") { state.showForm = "sale"; await render(); }
    else if (action === "add-purchase") { state.showForm = "purchase"; await render(); }
    else if (action === "add-payment") { state.showForm = "payment"; await render(); populatePartySelect(); }
    else if (action === "add-expense") { state.showForm = "expense"; await render(); }
    else if (action === "add-user") { state.showForm = "user"; await render(); }
    else if (action === "cancel-form") { state.showForm = null; await render(); }
    else if (action === "add-line") {
      const lineItems = document.querySelector("#line-items");
      if (lineItems) {
        const kind = lineItems.dataset.kind;
        if (kind === "sale") {
          const productOptions = state.products.map(p => `<option value="${p.id}" data-price="${p.sale_price}">${escapeHtml(p.name)}${p.strength ? ` · ${escapeHtml(p.strength)}` : ""} (${p.quantity} in stock)</option>`).join("");
          lineItems.insertAdjacentHTML("beforeend", saleLine(productOptions));
        } else if (kind === "purchase") {
          const productOptions = state.products.map(p => `<option value="${p.id}">${escapeHtml(p.name)}${p.strength ? ` · ${escapeHtml(p.strength)}` : ""}</option>`).join("");
          lineItems.insertAdjacentHTML("beforeend", purchaseLine(productOptions));
        }
      }
    } else if (action === "remove-line") {
      const row = e.target.closest(".line-row");
      if (row && row.parentElement.children.length > 1) {
        row.remove();
        updateInvoiceTotal();
      } else {
        toast("At least one line item is required.");
      }
    } else if (action === "filter-report") {
      await render();
    }
    return;
  }
  const printSale = e.target.closest("[data-print-sale]");
  if (printSale) {
    const saleId = printSale.dataset.printSale;
    try {
      const detail = await api(`/api/sales/${saleId}`);
      showSaleReceiptModal(detail);
    } catch (err) {
      toast(err.message);
    }
  }
});

app.addEventListener("input", (e) => {
  if (e.target.id === "table-search") {
    state.search = e.target.value;
    if (state.table) {
      const target = document.querySelector("#table-content");
      if (target) target.innerHTML = tableMarkup(state.table.columns, filterRows(state.table.rows), state.table.empty);
    }
  } else if (e.target.name === "quantity" || e.target.name === "unit_price" || e.target.name === "discount" || e.target.name === "tax") {
    updateInvoiceTotal();
  }
});

app.addEventListener("change", (e) => {
  if (e.target.name === "product_id" && e.target.closest("#line-items")) {
    const row = e.target.closest(".line-row");
    const selectedOption = e.target.selectedOptions[0];
    const price = selectedOption?.dataset?.price || "0";
    const priceInput = row.querySelector("input[name='unit_price']");
    if (priceInput) priceInput.value = price;
    updateInvoiceTotal();
  } else if (e.target.name === "party_type") {
    populatePartySelect();
  }
});

function populatePartySelect() {
  const partyTypeSelect = document.querySelector("select[name='party_type']");
  const partyIdSelect = document.querySelector("#party_id");
  if (!partyTypeSelect || !partyIdSelect) return;
  const type = partyTypeSelect.value;
  const list = type === "customer" ? state.customers : state.suppliers;
  partyIdSelect.innerHTML = (list || []).map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
}

function updateInvoiceTotal() {
  const lineItems = document.querySelector("#line-items");
  if (!lineItems || lineItems.dataset.kind !== "sale") return;
  let subtotal = 0;
  lineItems.querySelectorAll(".line-row").forEach(row => {
    const qty = parseFloat(row.querySelector("input[name='quantity']")?.value || 0);
    const price = parseFloat(row.querySelector("input[name='unit_price']")?.value || 0);
    subtotal += qty * price;
  });
  const discount = parseFloat(document.querySelector("input[name='discount']")?.value || 0);
  const tax = parseFloat(document.querySelector("input[name='tax']")?.value || 0);
  const total = Math.max(0, subtotal - discount + tax);
  const totalEl = document.querySelector("#invoice-total");
  if (totalEl) totalEl.textContent = money(total);
}

app.addEventListener("submit", async (e) => {
  if (e.target.id !== "entry-form") return;
  e.preventDefault();
  const form = e.target;
  const submitBtn = form.querySelector("button[type='submit']");
  submitBtn.disabled = true;
  submitBtn.textContent = "Saving…";

  try {
    const formData = new FormData(form);
    if (state.showForm === "sale" || state.showForm === "purchase") {
      const items = [];
      form.querySelectorAll(".line-row").forEach(row => {
        const item = {};
        row.querySelectorAll("select, input").forEach(input => {
          if (input.name) item[input.name] = input.value;
        });
        items.push(item);
      });
      const payload = Object.fromEntries(formData);
      payload.items = items;
      const endpoint = state.showForm === "sale" ? "/api/sales" : "/api/purchases";
      await api(endpoint, { method: "POST", body: JSON.stringify(payload) });
    } else {
      const payload = Object.fromEntries(formData);
      let endpoint = "";
      if (state.showForm === "product") endpoint = "/api/products";
      else if (state.showForm === "customer") endpoint = "/api/customers";
      else if (state.showForm === "supplier") endpoint = "/api/suppliers";
      else if (state.showForm === "payment") endpoint = "/api/payments";
      else if (state.showForm === "expense") endpoint = "/api/expenses";
      else if (state.showForm === "user") endpoint = "/api/users";
      await api(endpoint, { method: "POST", body: JSON.stringify(payload) });
    }
    toast("Saved successfully.", true);
    state.showForm = null;
    await render();
  } catch (err) {
    toast(err.message);
    submitBtn.disabled = false;
    submitBtn.textContent = "Save";
  }
});

function showSaleReceiptModal(sale) {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `<div class="modal"><div class="panel-head"><h3>Invoice #${escapeHtml(sale.invoice_no)}</h3><button class="link-button" data-action="close-modal">✕</button></div><div class="panel-body"><p><strong>Customer:</strong> ${escapeHtml(sale.customer || "Cash sale")}</p><p><strong>Date:</strong> ${shortDate(sale.invoice_date)}</p><p><strong>Payment Method:</strong> ${escapeHtml(sale.payment_method)}</p><div style="margin-top:12px">${tableMarkup([{label:"Medicine",render:r=>escapeHtml(r.product_name)},{label:"Batch",key:"batch_no"},{label:"Qty",key:"quantity"},{label:"Price",render:r=>money(r.unit_price)},{label:"Total",render:r=>money(r.total)}],sale.items,"No items.")}</div><div style="margin-top:12px;text-align:right"><p>Total: <strong>${money(sale.total)}</strong></p><p>Paid: <strong>${money(sale.paid)}</strong></p><p>Balance: <strong>${money(sale.total - sale.paid)}</strong></p></div></div></div>`;
  document.body.appendChild(modal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal || e.target.dataset.action === "close-modal") modal.remove();
  });
}

render();