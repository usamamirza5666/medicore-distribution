const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const COOKIE_NAME = "medicore_session";
const MAX_BODY_BYTES = 1_000_000;

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, "medicore.sqlite"));
db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Administrator','Manager','Salesperson','Storekeeper','Accountant')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  contact_person TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  type TEXT NOT NULL DEFAULT 'Pharmacy',
  credit_limit REAL NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  opening_balance REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  contact_person TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  payment_terms TEXT DEFAULT '',
  opening_balance REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT DEFAULT '',
  generic_name TEXT DEFAULT '',
  manufacturer TEXT DEFAULT '',
  category TEXT DEFAULT '',
  dosage_form TEXT DEFAULT '',
  strength TEXT DEFAULT '',
  pack_size TEXT DEFAULT '',
  barcode TEXT UNIQUE,
  reorder_level INTEGER NOT NULL DEFAULT 10 CHECK (reorder_level >= 0),
  sale_price REAL NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
  retail_price REAL NOT NULL DEFAULT 0 CHECK (retail_price >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  batch_no TEXT NOT NULL,
  manufacturing_date TEXT,
  expiry_date TEXT NOT NULL,
  purchase_price REAL NOT NULL CHECK (purchase_price >= 0),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  UNIQUE(product_id, batch_no)
);
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY,
  invoice_no TEXT NOT NULL,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  invoice_date TEXT NOT NULL,
  total REAL NOT NULL CHECK (total >= 0),
  paid REAL NOT NULL DEFAULT 0 CHECK (paid >= 0 AND paid <= total),
  status TEXT NOT NULL DEFAULT 'Posted',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(supplier_id, invoice_no)
);
CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost REAL NOT NULL CHECK (unit_cost >= 0),
  line_total REAL NOT NULL CHECK (line_total >= 0)
);
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY,
  invoice_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id),
  invoice_date TEXT NOT NULL,
  subtotal REAL NOT NULL,
  discount REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  paid REAL NOT NULL DEFAULT 0 CHECK (paid >= 0 AND paid <= total),
  cost_of_goods REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'Posted',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price REAL NOT NULL CHECK (unit_price >= 0),
  unit_cost REAL NOT NULL CHECK (unit_cost >= 0),
  line_total REAL NOT NULL CHECK (line_total >= 0)
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  party_type TEXT NOT NULL CHECK (party_type IN ('customer','supplier')),
  party_id INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('receipt','payment')),
  amount REAL NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL DEFAULT 'Cash',
  reference TEXT DEFAULT '',
  payment_date TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL,
  description TEXT DEFAULT '',
  amount REAL NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'Cash',
  expense_date TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  movement_type TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  reference TEXT DEFAULT '',
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  details TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_batches_expiry ON batches(expiry_date);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(invoice_date);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(invoice_date);
CREATE INDEX IF NOT EXISTS idx_movements_product ON stock_movements(product_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_reference ON payments(party_type,party_id,direction,reference) WHERE reference <> '';
`);

const sessions = new Map();
const loginAttempts = new Map();
const ROLE_PERMISSIONS = {
  Administrator: ["*"],
  Manager: ["dashboard","products","customers","suppliers","sales","purchases","payments","expenses","reports","users"],
  Salesperson: ["dashboard","products","customers","sales","payments"],
  Storekeeper: ["dashboard","products","purchases"],
  Accountant: ["dashboard","customers","suppliers","payments","expenses","reports","sales","purchases"],
};
const WRITE_PERMISSION = {
  products: ["Administrator","Manager","Storekeeper"],
  customers: ["Administrator","Manager","Salesperson"],
  suppliers: ["Administrator","Manager","Accountant"],
  sales: ["Administrator","Manager","Salesperson"],
  purchases: ["Administrator","Manager","Storekeeper","Accountant"],
  payments: ["Administrator","Manager","Salesperson","Accountant"],
  expenses: ["Administrator","Manager","Accountant"],
  users: ["Administrator"],
};
const MIME_TYPES = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".svg":"image/svg+xml" };

function today() { return new Date().toISOString().slice(0, 10); }
function money(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }
function statement(sql) { return db.prepare(sql); }
function all(sql, ...params) { return statement(sql).all(...params); }
function one(sql, ...params) { return statement(sql).get(...params); }
function run(sql, ...params) { return statement(sql).run(...params); }
function audit(userId, action, entity, entityId, details = "") {
  run("INSERT INTO audit_log(user_id, action, entity, entity_id, details) VALUES(?,?,?,?,?)",
    userId, action, entity, entityId ?? null, String(details).slice(0, 1000));
}
function transaction(work) {
  db.exec("BEGIN IMMEDIATE");
  try { const result = work(); db.exec("COMMIT"); return result; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}
function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => part.trim().split("="))
    .filter(([key, value]) => key && value).map(([key, ...value]) => [key, decodeURIComponent(value.join("="))]));
}
function sendJson(res, status, data, extraHeaders = {}) {
  res.writeHead(status, { "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store", ...extraHeaders });
  res.end(JSON.stringify(data));
}
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) fail(413, "Request body is too large.");
  }
  try { return raw ? JSON.parse(raw) : {}; } catch { fail(400, "Request body must be valid JSON."); }
}
function requireString(value, label, max = 180) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) fail(400, `${label} is required (maximum ${max} characters).`);
  return value.trim();
}
function requireNumber(value, label, { min = 0, max = 1_000_000_000, integer = false } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) fail(400, `${label} must be a valid ${integer ? "whole number" : "amount"}.`);
  return parsed;
}
function requireDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(400, `${label} must be a valid date.`);
  const [year,month,day]=value.split("-").map(Number);
  const date=new Date(Date.UTC(year,month-1,day));
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)fail(400,`${label} must be a valid date.`);
  return value;
}
function safeUser(user) { return { id:user.id, username:user.username, role:user.role }; }
function sessionFrom(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  const session = token && sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) { sessions.delete(token); return null; }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return { ...session, token };
}
function requireAuth(req) { const session = sessionFrom(req); if (!session) fail(401, "Please sign in."); return session; }
function requirePermission(session, area, write = false) {
  if (!ROLE_PERMISSIONS[session.role]?.includes("*") && !ROLE_PERMISSIONS[session.role]?.includes(area)) fail(403, "Your role does not have access to this area.");
  if (write && !WRITE_PERMISSION[area]?.includes(session.role)) fail(403, "Your role cannot make changes in this area.");
}
function requireCsrf(req, session) {
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) fail(403, "Cross-origin request rejected.");
  if (req.headers["x-csrf-token"] !== session.csrf) fail(403, "Security token is missing or expired. Refresh and try again.");
}
function passwordHash(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}
function sessionCookie(token, maxAge) {
  const secure=process.env.NODE_ENV==="production"||process.env.SECURE_COOKIE==="true"?"; Secure":"";
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}
function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
function getDashboard() {
  const month = today().slice(0, 7);
  const year = today().slice(0, 4);
  const sales = one(`SELECT
    COALESCE(SUM(CASE WHEN invoice_date = ? THEN total ELSE 0 END),0) today,
    COALESCE(SUM(CASE WHEN substr(invoice_date,1,7) = ? THEN total ELSE 0 END),0) month,
    COALESCE(SUM(CASE WHEN substr(invoice_date,1,4) = ? THEN total ELSE 0 END),0) year,
    COALESCE(SUM(CASE WHEN substr(invoice_date,1,7) = ? THEN cost_of_goods ELSE 0 END),0) month_cogs
    FROM sales WHERE status = 'Posted'`, today(), month, year, month);
  const purchases = one("SELECT COALESCE(SUM(total),0) total FROM purchases WHERE status='Posted'");
  const expenses = one("SELECT COALESCE(SUM(amount),0) total FROM expenses WHERE substr(expense_date,1,7)=?", month);
  const stock = one(`SELECT COALESCE(SUM(b.quantity*b.purchase_price),0) value,
    COALESCE(SUM(b.quantity),0) units FROM batches b WHERE b.expiry_date >= ?`, today());
  const lowStock = all(`SELECT p.id,p.name,p.brand,p.reorder_level,COALESCE(SUM(CASE WHEN b.expiry_date >= ? THEN b.quantity ELSE 0 END),0) quantity
    FROM products p LEFT JOIN batches b ON b.product_id=p.id GROUP BY p.id HAVING quantity <= p.reorder_level ORDER BY quantity LIMIT 8`, today());
  const expiring = all(`SELECT p.name,p.brand,b.batch_no,b.expiry_date,b.quantity
    FROM batches b JOIN products p ON p.id=b.product_id WHERE b.quantity>0 AND b.expiry_date BETWEEN ? AND date(?, '+90 days')
    ORDER BY b.expiry_date LIMIT 10`, today(), today());
  const expired = all(`SELECT p.name,b.batch_no,b.expiry_date,b.quantity FROM batches b JOIN products p ON p.id=b.product_id
    WHERE b.quantity>0 AND b.expiry_date < ? ORDER BY b.expiry_date LIMIT 10`, today());
  const ar = one(`SELECT COALESCE(SUM(total-paid),0) total FROM sales WHERE status='Posted'`);
  const ap = one(`SELECT COALESCE(SUM(total-paid),0) total FROM purchases WHERE status='Posted'`);
  const profit = one(`SELECT COALESCE(SUM(total-cost_of_goods),0) value FROM sales WHERE substr(invoice_date,1,7)=? AND status='Posted'`, month);
  const recentSales = all(`SELECT s.id,s.invoice_no,s.invoice_date,s.total,s.paid,c.name customer
    FROM sales s LEFT JOIN customers c ON c.id=s.customer_id WHERE s.status='Posted' ORDER BY s.id DESC LIMIT 5`);
  const recentPurchases = all(`SELECT p.id,p.invoice_no,p.invoice_date,p.total,s.name supplier
    FROM purchases p JOIN suppliers s ON s.id=p.supplier_id WHERE p.status='Posted' ORDER BY p.id DESC LIMIT 5`);
  return { sales, purchases:purchases.total, inventoryValue:stock.value, inventoryUnits:stock.units, lowStock, expiring, expired,
    receivables:ar.total, payables:ap.total, netProfit:money(profit.value-expenses.total), expenses:expenses.total, recentSales, recentPurchases };
}

async function handleApi(req, res, url) {
  const method = req.method;
  const route = url.pathname;
  if (route === "/api/status" && method === "GET") return sendJson(res, 200, { setupRequired:one("SELECT COUNT(*) count FROM users").count === 0 });
  if (route === "/api/setup" && method === "POST") {
    if (one("SELECT COUNT(*) count FROM users").count !== 0) fail(409, "Initial setup has already been completed.");
    const body = await readJson(req);
    const username = requireString(body.username, "Username", 60);
    if (typeof body.password !== "string" || body.password.length < 12 || body.password.length > 200) fail(400, "Use a password of at least 12 characters.");
    const result = transaction(() => {
      const created = run("INSERT INTO users(username,password_hash,role) VALUES(?,?,'Administrator')", username, passwordHash(body.password));
      audit(Number(created.lastInsertRowid), "CREATE", "user", Number(created.lastInsertRowid), "Initial administrator created");
      return Number(created.lastInsertRowid);
    });
    const token = crypto.randomBytes(32).toString("base64url");
    const csrf = crypto.randomBytes(24).toString("base64url");
    sessions.set(token, { userId:result, username, role:"Administrator", csrf, expiresAt:Date.now()+SESSION_TTL_MS });
    return sendJson(res, 201, { user:{ id:result, username, role:"Administrator" }, csrf }, { "Set-Cookie":sessionCookie(token,28800) });
  }
  if (route === "/api/login" && method === "POST") {
    const ip = req.socket.remoteAddress || "unknown";
    const recent = loginAttempts.get(ip) || [];
    const activeAttempts = recent.filter((time) => Date.now()-time < 15*60*1000);
    if (activeAttempts.length >= 10) fail(429, "Too many sign-in attempts. Try again in 15 minutes.");
    const body = await readJson(req);
    const user = one("SELECT * FROM users WHERE username=? AND active=1", String(body.username || "").trim());
    if (!user || typeof body.password !== "string" || !verifyPassword(body.password, user.password_hash)) {
      activeAttempts.push(Date.now()); loginAttempts.set(ip, activeAttempts);
      fail(401, "Username or password is incorrect.");
    }
    loginAttempts.delete(ip);
    const token = crypto.randomBytes(32).toString("base64url");
    const csrf = crypto.randomBytes(24).toString("base64url");
    sessions.set(token, { userId:user.id, username:user.username, role:user.role, csrf, expiresAt:Date.now()+SESSION_TTL_MS });
    audit(user.id, "LOGIN", "session", null);
    return sendJson(res, 200, { user:safeUser(user), csrf }, { "Set-Cookie":sessionCookie(token,28800) });
  }
  if (route === "/api/logout" && method === "POST") {
    const session = requireAuth(req); requireCsrf(req, session);
    sessions.delete(session.token);
    return sendJson(res, 200, { ok:true }, { "Set-Cookie":sessionCookie("",0) });
  }
  const session = requireAuth(req);
  if (route === "/api/session" && method === "GET") return sendJson(res, 200, { user:{ id:session.userId, username:session.username, role:session.role }, csrf:session.csrf });
  if (method !== "GET") requireCsrf(req, session);

  if (route === "/api/dashboard" && method === "GET") {
    requirePermission(session, "dashboard"); return sendJson(res, 200, getDashboard());
  }
  if (route === "/api/products" && method === "GET") {
    requirePermission(session, "products");
    return sendJson(res, 200, all(`SELECT p.*,COALESCE(SUM(CASE WHEN b.expiry_date >= ? THEN b.quantity ELSE 0 END),0) quantity,
      COALESCE(SUM(CASE WHEN b.expiry_date >= ? THEN b.quantity*b.purchase_price ELSE 0 END),0) stock_value
      FROM products p LEFT JOIN batches b ON b.product_id=p.id GROUP BY p.id ORDER BY p.name`, today(), today()));
  }
  if (route === "/api/products" && method === "POST") {
    requirePermission(session, "products", true); const b=await readJson(req);
    const name=requireString(b.name,"Medicine name");
    const sale=requireNumber(b.sale_price ?? 0,"Sale price");
    const result=run(`INSERT INTO products(name,brand,generic_name,manufacturer,category,dosage_form,strength,pack_size,barcode,reorder_level,sale_price,retail_price)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, name, String(b.brand||"").trim(), String(b.generic_name||"").trim(), String(b.manufacturer||"").trim(),
      String(b.category||"").trim(), String(b.dosage_form||"").trim(), String(b.strength||"").trim(), String(b.pack_size||"").trim(),
      b.barcode ? requireString(b.barcode,"Barcode",100) : null, requireNumber(b.reorder_level ?? 10,"Reorder level",{integer:true}),
      sale, requireNumber(b.retail_price ?? sale,"Retail price"));
    audit(session.userId,"CREATE","product",Number(result.lastInsertRowid),name);
    return sendJson(res,201,{id:Number(result.lastInsertRowid)});
  }
  if (route === "/api/customers" && method === "GET") {
    requirePermission(session,"customers");
    return sendJson(res,200,all(`SELECT c.*, c.opening_balance + COALESCE((SELECT SUM(s.total-s.paid) FROM sales s WHERE s.customer_id=c.id AND s.status='Posted'),0) balance FROM customers c ORDER BY c.name`));
  }
  if (route === "/api/customers" && method === "POST") {
    requirePermission(session,"customers",true); const b=await readJson(req);
    const result=run("INSERT INTO customers(name,contact_person,phone,address,type,credit_limit,opening_balance) VALUES(?,?,?,?,?,?,?)",
      requireString(b.name,"Customer name"),String(b.contact_person||""),String(b.phone||""),String(b.address||""),String(b.type||"Pharmacy"),
      requireNumber(b.credit_limit??0,"Credit limit"),requireNumber(b.opening_balance??0,"Opening balance",{min:-1_000_000_000}));
    audit(session.userId,"CREATE","customer",Number(result.lastInsertRowid),b.name);
    return sendJson(res,201,{id:Number(result.lastInsertRowid)});
  }
  if (route === "/api/suppliers" && method === "GET") {
    requirePermission(session,"suppliers");
    return sendJson(res,200,all(`SELECT s.*, s.opening_balance + COALESCE((SELECT SUM(p.total-p.paid) FROM purchases p WHERE p.supplier_id=s.id AND p.status='Posted'),0) balance FROM suppliers s ORDER BY s.name`));
  }
  if (route === "/api/suppliers" && method === "POST") {
    requirePermission(session,"suppliers",true); const b=await readJson(req);
    const result=run("INSERT INTO suppliers(name,contact_person,phone,address,payment_terms,opening_balance) VALUES(?,?,?,?,?,?)",
      requireString(b.name,"Supplier name"),String(b.contact_person||""),String(b.phone||""),String(b.address||""),String(b.payment_terms||""),
      requireNumber(b.opening_balance??0,"Opening balance",{min:-1_000_000_000}));
    audit(session.userId,"CREATE","supplier",Number(result.lastInsertRowid),b.name);
    return sendJson(res,201,{id:Number(result.lastInsertRowid)});
  }
  if (route === "/api/purchases" && method === "GET") {
    requirePermission(session,"purchases");
    return sendJson(res,200,all(`SELECT p.*,s.name supplier FROM purchases p JOIN suppliers s ON s.id=p.supplier_id ORDER BY p.id DESC LIMIT 200`));
  }
  if (route === "/api/purchases" && method === "POST") {
    requirePermission(session,"purchases",true); const b=await readJson(req);
    const supplierId=requireNumber(b.supplier_id,"Supplier",{min:1,integer:true});
    if (!one("SELECT id FROM suppliers WHERE id=?",supplierId)) fail(400,"Supplier does not exist.");
    if (!Array.isArray(b.items)||!b.items.length||b.items.length>100) fail(400,"Add between 1 and 100 purchase lines.");
    const invoice=requireString(b.invoice_no,"Supplier invoice number");
    const date=requireDate(b.invoice_date||today(),"Invoice date");
    if(one("SELECT id FROM purchases WHERE supplier_id=? AND invoice_no=?",supplierId,invoice))fail(409,"This supplier invoice number has already been recorded.");
    const lines=b.items.map((item)=>{
      const productId=requireNumber(item.product_id,"Product",{min:1,integer:true});
      if (!one("SELECT id FROM products WHERE id=?",productId)) fail(400,`Product ${productId} does not exist.`);
      const batchNo=requireString(item.batch_no,"Batch number",100);
      const expiry=requireDate(item.expiry_date,"Expiry date");
      if (expiry < today()) fail(400,`Batch ${batchNo} is already expired.`);
      const qty=requireNumber(item.quantity,"Quantity",{min:1,integer:true});
      const cost=requireNumber(item.purchase_price,"Purchase price");
      const manufacturingDate=item.manufacturing_date?requireDate(item.manufacturing_date,"Manufacturing date"):null;
      if(manufacturingDate&&manufacturingDate>expiry)fail(400,`Manufacturing date must be before expiry for batch ${batchNo}.`);
      return {productId,batchNo,expiry,manufacturingDate,qty,cost};
    });
    const total=money(lines.reduce((sum,line)=>sum+line.qty*line.cost,0));
    const paid=requireNumber(b.paid??0,"Amount paid",{max:total});
    const purchaseId=transaction(()=>{
      const created=run("INSERT INTO purchases(invoice_no,supplier_id,invoice_date,total,paid,created_by) VALUES(?,?,?,?,?,?)",invoice,supplierId,date,total,paid,session.userId);
      const id=Number(created.lastInsertRowid);
      for (const line of lines) {
        let batch=one("SELECT * FROM batches WHERE product_id=? AND batch_no=?",line.productId,line.batchNo);
        if (batch) {
          if (batch.expiry_date!==line.expiry) fail(400,`Expiry date does not match the existing batch ${line.batchNo}.`);
          const weightedCost=money((batch.quantity*batch.purchase_price+line.qty*line.cost)/(batch.quantity+line.qty));
          run("UPDATE batches SET quantity=quantity+?,purchase_price=?,supplier_id=? WHERE id=?",line.qty,weightedCost,supplierId,batch.id);
        } else {
          const createdBatch=run("INSERT INTO batches(product_id,supplier_id,batch_no,manufacturing_date,expiry_date,purchase_price,quantity) VALUES(?,?,?,?,?,?,?)",
            line.productId,supplierId,line.batchNo,line.manufacturingDate,line.expiry,line.cost,line.qty);
          batch={id:Number(createdBatch.lastInsertRowid)};
        }
        run("INSERT INTO purchase_items(purchase_id,batch_id,quantity,unit_cost,line_total) VALUES(?,?,?,?,?)",id,batch.id,line.qty,line.cost,money(line.qty*line.cost));
        run("INSERT INTO stock_movements(product_id,batch_id,movement_type,quantity,reference,user_id) VALUES(?,?,?,?,?,?)",line.productId,batch.id,"PURCHASE",line.qty,invoice,session.userId);
      }
      if (paid>0) run("INSERT INTO payments(party_type,party_id,direction,amount,method,reference,payment_date,created_by) VALUES('supplier',?,'payment',?,'Cash',?,?,?)",supplierId,paid,invoice,date,session.userId);
      audit(session.userId,"POST","purchase",id,invoice);
      return id;
    });
    return sendJson(res,201,{id:purchaseId,total});
  }
  const saleDetailMatch=route.match(/^\/api\/sales\/(\d+)$/);
  if (saleDetailMatch && method==="GET") {
    requirePermission(session,"sales");
    const sale=one("SELECT s.*,c.name customer,c.address customer_address,c.phone customer_phone FROM sales s LEFT JOIN customers c ON c.id=s.customer_id WHERE s.id=?",Number(saleDetailMatch[1]));
    if(!sale)fail(404,"Invoice not found.");
    sale.items=all(`SELECT p.name,p.brand,p.strength,p.pack_size,b.batch_no,b.expiry_date,si.quantity,si.unit_price,si.line_total
      FROM sale_items si JOIN products p ON p.id=si.product_id JOIN batches b ON b.id=si.batch_id WHERE si.sale_id=? ORDER BY si.id`,sale.id);
    return sendJson(res,200,sale);
  }
  if (route === "/api/sales" && method === "GET") {
    requirePermission(session,"sales");
    return sendJson(res,200,all(`SELECT s.*,c.name customer FROM sales s LEFT JOIN customers c ON c.id=s.customer_id ORDER BY s.id DESC LIMIT 200`));
  }
  if (route === "/api/sales" && method === "POST") {
    requirePermission(session,"sales",true); const b=await readJson(req);
    const customerId=b.customer_id?requireNumber(b.customer_id,"Customer",{min:1,integer:true}):null;
    const customer=customerId?one("SELECT * FROM customers WHERE id=?",customerId):null;
    if (customerId&&!customer) fail(400,"Customer does not exist.");
    if (!Array.isArray(b.items)||!b.items.length||b.items.length>100) fail(400,"Add between 1 and 100 sales lines.");
    const invoiceDate=requireDate(b.invoice_date||today(),"Invoice date");
    const requested=b.items.map((item)=>({productId:requireNumber(item.product_id,"Product",{min:1,integer:true}),qty:requireNumber(item.quantity,"Quantity",{min:1,integer:true}),price:requireNumber(item.unit_price,"Unit price")}));
    const discount=requireNumber(b.discount??0,"Discount");
    const tax=requireNumber(b.tax??0,"Tax");
    const subtotal=money(requested.reduce((sum,item)=>sum+item.qty*item.price,0));
    if (discount>subtotal) fail(400,"Discount cannot be greater than the subtotal.");
    const total=money(subtotal-discount+tax);
    const paid=requireNumber(b.paid??total,"Amount paid",{max:total});
    if (customer && customer.credit_limit>0) {
      const current=Number(one(`SELECT ? + COALESCE(SUM(total-paid),0) balance FROM sales WHERE customer_id=? AND status='Posted'`,customer.opening_balance,customerId).balance);
      if (current+total-paid>customer.credit_limit) fail(400,"This sale would exceed the customer's credit limit.");
    }
    const saleId=transaction(()=>{
      const invoiceNo=`S-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
      const created=run("INSERT INTO sales(invoice_no,customer_id,invoice_date,subtotal,discount,tax,total,paid,cost_of_goods,created_by) VALUES(?,?,?,?,?,?,?,?,0,?)",
        invoiceNo,customerId,invoiceDate,subtotal,discount,tax,total,paid,session.userId);
      const id=Number(created.lastInsertRowid);
      let cogs=0;
      for (const item of requested) {
        if (!one("SELECT id FROM products WHERE id=?",item.productId)) fail(400,`Product ${item.productId} does not exist.`);
        const batches=all("SELECT * FROM batches WHERE product_id=? AND quantity>0 AND expiry_date>=? ORDER BY expiry_date,id",item.productId,today());
        const available=batches.reduce((sum,batch)=>sum+batch.quantity,0);
        if (available<item.qty) fail(400,`Insufficient unexpired stock for product ${item.productId}. Available: ${available}.`);
        let remaining=item.qty;
        for (const batch of batches) {
          if (!remaining) break;
          const quantity=Math.min(batch.quantity,remaining);
          run("UPDATE batches SET quantity=quantity-? WHERE id=? AND quantity>=?",quantity,batch.id,quantity);
          run("INSERT INTO sale_items(sale_id,product_id,batch_id,quantity,unit_price,unit_cost,line_total) VALUES(?,?,?,?,?,?,?)",
            id,item.productId,batch.id,quantity,item.price,batch.purchase_price,money(quantity*item.price));
          run("INSERT INTO stock_movements(product_id,batch_id,movement_type,quantity,reference,user_id) VALUES(?,?,?,?,?,?)",
            item.productId,batch.id,"SALE",-quantity,invoiceNo,session.userId);
          cogs+=quantity*batch.purchase_price;
          remaining-=quantity;
        }
      }
      run("UPDATE sales SET cost_of_goods=? WHERE id=?",money(cogs),id);
      if (paid>0&&customerId) run("INSERT INTO payments(party_type,party_id,direction,amount,method,reference,payment_date,created_by) VALUES('customer',?,'receipt',?,?,?, ?,?)",
        customerId,paid,String(b.payment_method||"Cash"),invoiceNo,invoiceDate,session.userId);
      audit(session.userId,"POST","sale",id,invoiceNo);
      return {id,invoice_no:invoiceNo,total,cost_of_goods:money(cogs)};
    });
    return sendJson(res,201,saleId);
  }
  if (route === "/api/payments" && method === "GET") {
    requirePermission(session,"payments");
    return sendJson(res,200,all("SELECT * FROM payments ORDER BY id DESC LIMIT 200"));
  }
  if (route === "/api/payments" && method === "POST") {
    requirePermission(session,"payments",true); const b=await readJson(req);
    const partyType=b.party_type;
    const direction=b.direction;
    if (!["customer","supplier"].includes(partyType)||!["receipt","payment"].includes(direction)) fail(400,"Select a valid party and payment direction.");
    if ((partyType==="customer"&&direction!=="receipt")||(partyType==="supplier"&&direction!=="payment")) fail(400,"Payment direction does not match the selected party.");
    const partyId=requireNumber(b.party_id,"Party",{min:1,integer:true});
    const party=one(`SELECT id,opening_balance FROM ${partyType==="customer"?"customers":"suppliers"} WHERE id=?`,partyId);
    if (!party) fail(400,"Selected party does not exist.");
    const amount=requireNumber(b.amount,"Amount",{min:0.01});
    const date=requireDate(b.payment_date||today(),"Payment date");
    const reference=String(b.reference||"").trim();
    if(reference.length>120)fail(400,"Reference must be 120 characters or fewer.");
    const result=transaction(()=>{
      const invoices=partyType==="customer"
        ? all("SELECT id,total,paid FROM sales WHERE customer_id=? AND status='Posted' AND total>paid ORDER BY invoice_date,id",partyId)
        : all("SELECT id,total,paid FROM purchases WHERE supplier_id=? AND status='Posted' AND total>paid ORDER BY invoice_date,id",partyId);
      const opening=Number(party.opening_balance);
      const outstanding=Math.max(0,opening+invoices.reduce((sum,invoice)=>sum+invoice.total-invoice.paid,0));
      if(amount>outstanding+0.001) fail(400,`Amount exceeds outstanding balance (${money(outstanding).toFixed(2)}).`);
      if(reference&&one("SELECT id FROM payments WHERE party_type=? AND party_id=? AND direction=? AND reference=?",partyType,partyId,direction,reference))fail(409,"This payment reference has already been recorded.");
      let remaining=amount;
      for(const invoice of invoices) {
        if(remaining<=0) break;
        const applied=Math.min(remaining,invoice.total-invoice.paid);
        run(`UPDATE ${partyType==="customer"?"sales":"purchases"} SET paid=paid+? WHERE id=?`,money(applied),invoice.id);
        remaining=money(remaining-applied);
      }
      if(remaining>0)run(`UPDATE ${partyType==="customer"?"customers":"suppliers"} SET opening_balance=opening_balance-? WHERE id=?`,money(remaining),partyId);
      const created=run("INSERT INTO payments(party_type,party_id,direction,amount,method,reference,payment_date,created_by) VALUES(?,?,?,?,?,?,?,?)",
        partyType,partyId,direction,amount,String(b.method||"Cash"),reference,date,session.userId);
      audit(session.userId,"CREATE","payment",Number(created.lastInsertRowid),`${partyType} ${amount}`);
      return Number(created.lastInsertRowid);
    });
    return sendJson(res,201,{id:result});
  }
  if (route === "/api/expenses" && method === "GET") {
    requirePermission(session,"expenses");
    return sendJson(res,200,all("SELECT * FROM expenses ORDER BY expense_date DESC,id DESC LIMIT 200"));
  }
  if (route === "/api/expenses" && method === "POST") {
    requirePermission(session,"expenses",true);const b=await readJson(req);
    const result=run("INSERT INTO expenses(category,description,amount,payment_method,expense_date,created_by) VALUES(?,?,?,?,?,?)",
      requireString(b.category,"Expense category"),String(b.description||""),requireNumber(b.amount,"Amount",{min:0.01}),String(b.payment_method||"Cash"),
      requireDate(b.expense_date||today(),"Expense date"),session.userId);
    audit(session.userId,"CREATE","expense",Number(result.lastInsertRowid),b.category);
    return sendJson(res,201,{id:Number(result.lastInsertRowid)});
  }
  if (route === "/api/reports" && method === "GET") {
    requirePermission(session,"reports");
    const from=requireDate(url.searchParams.get("from")||today().slice(0,8)+"01","Start date");
    const to=requireDate(url.searchParams.get("to")||today(),"End date");
    if(from>to) fail(400,"Start date must not be after end date.");
    const sales=all("SELECT invoice_date,COUNT(*) invoices,COALESCE(SUM(total),0) revenue,COALESCE(SUM(cost_of_goods),0) cogs FROM sales WHERE status='Posted' AND invoice_date BETWEEN ? AND ? GROUP BY invoice_date ORDER BY invoice_date",from,to);
    const purchaseTotal=one("SELECT COALESCE(SUM(total),0) total FROM purchases WHERE status='Posted' AND invoice_date BETWEEN ? AND ?",from,to).total;
    const expenseTotal=one("SELECT COALESCE(SUM(amount),0) total FROM expenses WHERE expense_date BETWEEN ? AND ?",from,to).total;
    const stock=all("SELECT p.name,p.brand,b.batch_no,b.manufacturing_date,b.expiry_date,b.quantity,b.purchase_price, b.quantity*b.purchase_price stock_value FROM batches b JOIN products p ON p.id=b.product_id WHERE b.quantity>0 ORDER BY p.name,b.expiry_date");
    const auditRows=one("SELECT COUNT(*) count FROM audit_log WHERE date(created_at) BETWEEN ? AND ?",from,to).count;
    return sendJson(res,200,{from,to,sales,purchases:purchaseTotal,expenses:expenseTotal,inventory:stock,inventoryValue:money(stock.reduce((sum,row)=>sum+row.stock_value,0)),grossProfit:money(sales.reduce((sum,row)=>sum+row.revenue-row.cogs,0)),netProfit:money(sales.reduce((sum,row)=>sum+row.revenue-row.cogs,0)-expenseTotal),auditEvents:auditRows});
  }
  if (route === "/api/users" && method === "GET") {
    requirePermission(session,"users"); return sendJson(res,200,all("SELECT id,username,role,active,created_at FROM users ORDER BY username"));
  }
  if (route === "/api/users" && method === "POST") {
    requirePermission(session,"users",true);const b=await readJson(req);
    const username=requireString(b.username,"Username",60);
    if(typeof b.password!=="string"||b.password.length<12||b.password.length>200)fail(400,"Use a password of at least 12 characters.");
    if(!["Administrator","Manager","Salesperson","Storekeeper","Accountant"].includes(b.role))fail(400,"Select a valid role.");
    const result=run("INSERT INTO users(username,password_hash,role) VALUES(?,?,?)",username,passwordHash(b.password),b.role);
    audit(session.userId,"CREATE","user",Number(result.lastInsertRowid),`${username} (${b.role})`);
    return sendJson(res,201,{id:Number(result.lastInsertRowid)});
  }
  if (route === "/api/audit" && method === "GET") {
    requirePermission(session,"users");
    return sendJson(res,200,all("SELECT a.*,u.username FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 200"));
  }
  fail(404,"API endpoint not found.");
}

const server = http.createServer(async (req,res)=>{
  try {
    const url=new URL(req.url,"http://localhost");
    if(url.pathname.startsWith("/api/")) return await handleApi(req,res,url);
    if(!["GET","HEAD"].includes(req.method)) return sendJson(res,405,{error:"Method not allowed."});
    let relative=decodeURIComponent(url.pathname==="/"?"/index.html":url.pathname);
    const file=path.resolve(ROOT,"public",`.${relative}`);
    if(!file.startsWith(path.resolve(ROOT,"public")+path.sep)) return sendJson(res,403,{error:"Forbidden."});
    const data=await fs.promises.readFile(file);
    res.writeHead(200,{"Content-Type":MIME_TYPES[path.extname(file)]||"application/octet-stream","X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"same-origin","Content-Security-Policy":"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"});
    res.end(req.method==="HEAD"?undefined:data);
  } catch(error) {
    const duplicate=error.code==="ERR_SQLITE_ERROR"&&error.message.includes("UNIQUE constraint failed");
    const status=error.status||(duplicate?409:500);
    const message=error.status?error.message:duplicate?"A record with the same unique value already exists.":"Unexpected server error.";
    if(!res.headersSent) sendJson(res,status,{error:message});
    if(!error.status&&!duplicate) console.error(error);
  }
});

server.listen(PORT,HOST,()=>console.log(`MediCore listening on http://${HOST}:${PORT}`));
for(const [token,session] of sessions) if(session.expiresAt<Date.now()) sessions.delete(token);
process.on("SIGINT",()=>{db.close();server.close(()=>process.exit(0));});
process.on("SIGTERM",()=>{db.close();server.close(()=>process.exit(0));});
