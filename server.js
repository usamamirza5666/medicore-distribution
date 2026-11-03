'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.MEDICORE_DATA_DIR || path.join(__dirname, 'data');
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set when NODE_ENV=production.');
}
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'medicore.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('Administrator','Manager','Salesperson','Storekeeper','Accountant')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expired_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expired_at);
  CREATE TABLE IF NOT EXISTS medicines (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    sku TEXT NOT NULL UNIQUE,
    unit TEXT NOT NULL DEFAULT 'unit',
    reorder_level INTEGER NOT NULL DEFAULT 10 CHECK(reorder_level >= 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS batches (
    id INTEGER PRIMARY KEY,
    medicine_id INTEGER NOT NULL REFERENCES medicines(id),
    batch_number TEXT NOT NULL,
    expiry_date TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity >= 0),
    unit_cost REAL NOT NULL CHECK(unit_cost >= 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(medicine_id, batch_number)
  );
  CREATE INDEX IF NOT EXISTS batches_fefo ON batches(medicine_id, expiry_date, id);
  CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY,
    supplier TEXT NOT NULL,
    reference TEXT NOT NULL,
    total REAL NOT NULL,
    user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS purchase_items (
    id INTEGER PRIMARY KEY,
    purchase_id INTEGER NOT NULL REFERENCES purchases(id),
    medicine_id INTEGER NOT NULL REFERENCES medicines(id),
    batch_id INTEGER NOT NULL REFERENCES batches(id),
    quantity INTEGER NOT NULL,
    unit_cost REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY,
    customer TEXT NOT NULL,
    reference TEXT NOT NULL UNIQUE,
    total REAL NOT NULL,
    user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS invoice_items (
    id INTEGER PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id),
    medicine_id INTEGER NOT NULL REFERENCES medicines(id),
    batch_id INTEGER NOT NULL REFERENCES batches(id),
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    unit_cost REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY,
    party_type TEXT NOT NULL CHECK(party_type IN ('Customer','Supplier')),
    party TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('Received','Paid')),
    amount REAL NOT NULL CHECK(amount > 0),
    method TEXT NOT NULL DEFAULT 'Cash',
    note TEXT NOT NULL DEFAULT '',
    user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL CHECK(amount > 0),
    user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    username TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

class SQLiteSessionStore extends session.Store {
  get(sid, callback) {
    try {
      const row = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expired_at > ?').get(sid, Date.now());
      callback(null, row ? JSON.parse(row.sess) : null);
    } catch (error) {
      callback(error);
    }
  }
  set(sid, sess, callback = () => {}) {
    try {
      const expiresAt = sess.cookie && sess.cookie.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 8 * 60 * 60 * 1000;
      db.prepare('INSERT INTO sessions(sid,sess,expired_at) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess, expired_at=excluded.expired_at')
        .run(sid, JSON.stringify(sess), expiresAt);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }
  destroy(sid, callback = () => {}) {
    try {
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }
  touch(sid, sess, callback = () => {}) {
    this.set(sid, sess, callback);
  }
}

const app = express();
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '100kb' }));
app.use(session({
  name: 'medicore.sid',
  secret: process.env.SESSION_SECRET || 'medicore-local-development-secret-change-for-production',
  store: new SQLiteSessionStore(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000
  }
}));

const ROLES = ['Administrator', 'Manager', 'Salesperson', 'Storekeeper', 'Accountant'];
const ROLE_PERMISSIONS = {
  Administrator: ['*'],
  Manager: ['dashboard', 'sales', 'purchases', 'inventory', 'payments', 'expenses', 'reports'],
  Salesperson: ['dashboard', 'sales', 'payments'],
  Storekeeper: ['dashboard', 'inventory', 'purchases'],
  Accountant: ['dashboard', 'payments', 'expenses', 'reports']
};
const hasAdmin = () => Boolean(db.prepare("SELECT 1 FROM users WHERE role = 'Administrator' LIMIT 1").get());
if (process.env.NODE_ENV === 'production' && !hasAdmin() && !process.env.SETUP_TOKEN) {
  throw new Error('SETUP_TOKEN must be set until the first administrator account is created.');
}
const audit = (req, action, details) => {
  db.prepare('INSERT INTO audit_log(user_id,username,action,details) VALUES(?,?,?,?)')
    .run(req.session.user.id, req.session.user.username, action, String(details).slice(0, 1000));
};
const requireAuth = (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Please sign in to continue.' });
  next();
};
const requirePermission = (permission) => (req, res, next) => {
  const permissions = ROLE_PERMISSIONS[req.session.user.role] || [];
  if (!permissions.includes('*') && !permissions.includes(permission)) {
    return res.status(403).json({ error: 'Your role is not permitted to perform this action.' });
  }
  next();
};
const csrfGuard = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const token = req.get('x-csrf-token');
  const supplied = Buffer.from(token || '');
  const expected = Buffer.from(req.session.csrfToken || '');
  if (!supplied.length || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    return res.status(403).json({ error: 'Request verification failed. Refresh the page and try again.' });
  }
  next();
};
const text = (value, label, max = 160) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new Error(`${label} is required and must be at most ${max} characters.`);
  }
  return value.trim();
};
const positiveInt = (value, label) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${label} must be a positive whole number.`);
  return number;
};
const nonNegative = (value, label) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1000000000) throw new Error(`${label} must be a valid non-negative amount.`);
  return number;
};
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

app.use('/api', (req, res, next) => {
  if (req.path === '/status' || req.path === '/setup' || req.path === '/login' || req.path === '/logout') return next();
  requireAuth(req, res, () => csrfGuard(req, res, next));
});

app.get('/api/status', (req, res) => res.json({
  setupRequired: !hasAdmin(),
  setupTokenRequired: process.env.NODE_ENV === 'production'
}));
app.post('/api/setup', asyncRoute(async (req, res) => {
  if (hasAdmin()) return res.status(409).json({ error: 'Initial administrator setup has already been completed.' });
  if (process.env.NODE_ENV === 'production') {
    const supplied = Buffer.from(typeof req.body.setupToken === 'string' ? req.body.setupToken : '');
    const expected = Buffer.from(process.env.SETUP_TOKEN || '');
    if (!supplied.length || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      return res.status(403).json({ error: 'The first-time setup code is invalid.' });
    }
  }
  const username = text(req.body.username, 'Username', 50);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (username.length < 3 || !/^[a-zA-Z0-9._-]+$/.test(username)) throw new Error('Username must be 3-50 characters and use letters, numbers, dots, underscores or hyphens.');
  if (password.length < 12 || password.length > 200) throw new Error('Password must be between 12 and 200 characters.');
  const hash = await bcrypt.hash(password, 12);
  const result = db.transaction(() => {
    if (hasAdmin()) return null;
    return db.prepare('INSERT INTO users(username,password_hash,role) VALUES(?,?,?)').run(username, hash, 'Administrator');
  })();
  if (!result) return res.status(409).json({ error: 'Initial administrator setup has already been completed.' });
  req.session.user = { id: Number(result.lastInsertRowid), username, role: 'Administrator' };
  req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  audit(req, 'admin.setup', 'Created initial administrator account');
  res.status(201).json({ user: req.session.user, csrfToken: req.session.csrfToken });
}));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false });
app.post('/api/login', loginLimiter, asyncRoute(async (req, res) => {
  if (!hasAdmin()) return res.status(428).json({ error: 'Complete first-time administrator setup before signing in.' });
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const user = db.prepare('SELECT id,username,password_hash,role FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }
  req.session.regenerate((error) => {
    if (error) return res.status(500).json({ error: 'Could not create a secure session.' });
    req.session.user = { id: user.id, username: user.username, role: user.role };
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    audit(req, 'auth.login', 'Signed in');
    res.json({ user: req.session.user, csrfToken: req.session.csrfToken });
  });
}));
app.post('/api/logout', requireAuth, csrfGuard, (req, res, next) => {
  audit(req, 'auth.logout', 'Signed out');
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('medicore.sid');
    res.json({ ok: true });
  });
});
app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.session.user, csrfToken: req.session.csrfToken }));

app.use('/api', requireAuth, csrfGuard);

app.get('/api/dashboard', requirePermission('dashboard'), (req, res) => {
  const sales = db.prepare("SELECT COALESCE(SUM(total),0) AS total FROM invoices WHERE date(created_at)=date('now','localtime')").get().total;
  const profit = db.prepare("SELECT COALESCE(SUM((unit_price-unit_cost)*quantity),0) AS total FROM invoice_items WHERE date((SELECT created_at FROM invoices WHERE id=invoice_id))=date('now','localtime')").get().total;
  const lowStock = db.prepare(`SELECT m.id,m.name,m.sku,m.reorder_level,COALESCE(SUM(CASE WHEN b.expiry_date >= date('now') THEN b.quantity ELSE 0 END),0) AS quantity
    FROM medicines m LEFT JOIN batches b ON b.medicine_id=m.id GROUP BY m.id HAVING quantity <= m.reorder_level ORDER BY quantity ASC LIMIT 8`).all();
  const expiring = db.prepare("SELECT b.batch_number,b.expiry_date,b.quantity,m.name FROM batches b JOIN medicines m ON m.id=b.medicine_id WHERE b.quantity>0 AND b.expiry_date BETWEEN date('now') AND date('now','+90 days') ORDER BY b.expiry_date LIMIT 8").all();
  res.json({ sales, profit, lowStock, expiring });
});

app.get('/api/medicines', requirePermission('inventory'), (req, res) => {
  res.json(db.prepare(`SELECT m.id,m.name,m.sku,m.unit,m.reorder_level,
    COALESCE(SUM(CASE WHEN b.expiry_date >= date('now') THEN b.quantity ELSE 0 END),0) AS quantity,
    COALESCE(SUM(CASE WHEN b.expiry_date >= date('now') THEN b.quantity*b.unit_cost ELSE 0 END),0) AS stock_value
    FROM medicines m LEFT JOIN batches b ON b.medicine_id=m.id GROUP BY m.id ORDER BY m.name`).all());
});
app.post('/api/medicines', requirePermission('inventory'), (req, res) => {
  const name = text(req.body.name, 'Medicine name');
  const sku = text(req.body.sku, 'SKU', 50);
  const unit = text(req.body.unit || 'unit', 'Unit', 30);
  const reorder = req.body.reorderLevel === undefined ? 10 : Number(req.body.reorderLevel);
  if (!Number.isSafeInteger(reorder) || reorder < 0) throw new Error('Reorder level must be a non-negative whole number.');
  const result = db.prepare('INSERT INTO medicines(name,sku,unit,reorder_level) VALUES(?,?,?,?)').run(name, sku, unit, reorder);
  audit(req, 'inventory.medicine.create', `Created medicine ${sku}`);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

app.get('/api/purchases', requirePermission('purchases'), (req, res) => {
  res.json(db.prepare('SELECT p.*,u.username FROM purchases p LEFT JOIN users u ON u.id=p.user_id ORDER BY p.id DESC LIMIT 200').all());
});
app.post('/api/purchases', requirePermission('purchases'), (req, res) => {
  const supplier = text(req.body.supplier, 'Supplier');
  const reference = text(req.body.reference, 'Purchase reference', 80);
  const medicineId = positiveInt(req.body.medicineId, 'Medicine');
  const batchNumber = text(req.body.batchNumber, 'Batch number', 80);
  const expiryDate = text(req.body.expiryDate, 'Expiry date', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryDate) || Number.isNaN(Date.parse(`${expiryDate}T00:00:00Z`))) throw new Error('Expiry date must be a valid date.');
  const quantity = positiveInt(req.body.quantity, 'Quantity');
  const unitCost = nonNegative(req.body.unitCost, 'Unit cost');
  const medicine = db.prepare('SELECT id FROM medicines WHERE id=?').get(medicineId);
  if (!medicine) throw new Error('Selected medicine does not exist.');
  const addPurchase = db.transaction(() => {
    const total = quantity * unitCost;
    const purchase = db.prepare('INSERT INTO purchases(supplier,reference,total,user_id) VALUES(?,?,?,?)')
      .run(supplier, reference, total, req.session.user.id);
    const prior = db.prepare('SELECT id FROM batches WHERE medicine_id=? AND batch_number=?').get(medicineId, batchNumber);
    let batchId;
    if (prior) {
      const batch = db.prepare('SELECT expiry_date,unit_cost FROM batches WHERE id=?').get(prior.id);
      if (batch.expiry_date !== expiryDate || batch.unit_cost !== unitCost) throw new Error('An existing batch must keep the same expiry date and unit cost.');
      db.prepare('UPDATE batches SET quantity=quantity+? WHERE id=?').run(quantity, prior.id);
      batchId = prior.id;
    } else {
      batchId = Number(db.prepare('INSERT INTO batches(medicine_id,batch_number,expiry_date,quantity,unit_cost) VALUES(?,?,?,?,?)')
        .run(medicineId, batchNumber, expiryDate, quantity, unitCost).lastInsertRowid);
    }
    db.prepare('INSERT INTO purchase_items(purchase_id,medicine_id,batch_id,quantity,unit_cost) VALUES(?,?,?,?,?)')
      .run(purchase.lastInsertRowid, medicineId, batchId, quantity, unitCost);
    return Number(purchase.lastInsertRowid);
  });
  const id = addPurchase();
  audit(req, 'inventory.purchase.create', `Recorded purchase ${reference}`);
  res.status(201).json({ id });
});

app.get('/api/invoices', requirePermission('sales'), (req, res) => {
  res.json(db.prepare(`SELECT i.*,u.username FROM invoices i LEFT JOIN users u ON u.id=i.user_id ORDER BY i.id DESC LIMIT 200`).all());
});
app.post('/api/invoices', requirePermission('sales'), (req, res) => {
  const customer = text(req.body.customer, 'Customer');
  const items = req.body.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) throw new Error('An invoice must contain between 1 and 50 line items.');
  const normalized = items.map((item) => ({
    medicineId: positiveInt(item.medicineId, 'Medicine'),
    quantity: positiveInt(item.quantity, 'Quantity'),
    unitPrice: nonNegative(item.unitPrice, 'Unit price')
  }));
  const reference = `INV-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const makeInvoice = db.transaction(() => {
    const allocations = [];
    const reserved = new Map();
    for (const item of normalized) {
      const batches = db.prepare("SELECT id,quantity,unit_cost FROM batches WHERE medicine_id=? AND quantity>0 AND expiry_date>=date('now') ORDER BY expiry_date ASC,id ASC").all(item.medicineId);
      const available = batches.reduce((sum, batch) => sum + batch.quantity - (reserved.get(batch.id) || 0), 0);
      if (available < item.quantity) throw new Error(`Insufficient unexpired stock for medicine ID ${item.medicineId} (available: ${available}).`);
      let remaining = item.quantity;
      for (const batch of batches) {
        if (!remaining) break;
        const quantity = Math.min(batch.quantity - (reserved.get(batch.id) || 0), remaining);
        if (quantity <= 0) continue;
        allocations.push({ ...item, batchId: batch.id, quantity, unitCost: batch.unit_cost });
        reserved.set(batch.id, (reserved.get(batch.id) || 0) + quantity);
        remaining -= quantity;
      }
    }
    const total = normalized.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const invoice = db.prepare('INSERT INTO invoices(customer,reference,total,user_id) VALUES(?,?,?,?)')
      .run(customer, reference, total, req.session.user.id);
    const insertItem = db.prepare('INSERT INTO invoice_items(invoice_id,medicine_id,batch_id,quantity,unit_price,unit_cost) VALUES(?,?,?,?,?,?)');
    const decrease = db.prepare('UPDATE batches SET quantity=quantity-? WHERE id=? AND quantity>=?');
    for (const allocation of allocations) {
      const changed = decrease.run(allocation.quantity, allocation.batchId, allocation.quantity).changes;
      if (!changed) throw new Error('Stock changed while creating the invoice. Please try again.');
      insertItem.run(invoice.lastInsertRowid, allocation.medicineId, allocation.batchId, allocation.quantity, allocation.unitPrice, allocation.unitCost);
    }
    return Number(invoice.lastInsertRowid);
  });
  const id = makeInvoice();
  audit(req, 'sales.invoice.create', `Created ${reference} for ${customer}`);
  res.status(201).json({ id, reference });
});

app.get('/api/expenses', requirePermission('expenses'), (req, res) => {
  res.json(db.prepare('SELECT e.*,u.username FROM expenses e LEFT JOIN users u ON u.id=e.user_id ORDER BY e.id DESC LIMIT 200').all());
});
app.post('/api/expenses', requirePermission('expenses'), (req, res) => {
  const category = text(req.body.category, 'Category', 80);
  const description = text(req.body.description, 'Description', 300);
  const amount = positiveAmount(req.body.amount);
  const result = db.prepare('INSERT INTO expenses(category,description,amount,user_id) VALUES(?,?,?,?)')
    .run(category, description, amount, req.session.user.id);
  audit(req, 'finance.expense.create', `${category}: ${amount}`);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});
function positiveAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000000) throw new Error('Amount must be greater than zero and within the supported range.');
  return amount;
}

app.get('/api/payments', requirePermission('payments'), (req, res) => {
  res.json(db.prepare('SELECT p.*,u.username FROM payments p LEFT JOIN users u ON u.id=p.user_id ORDER BY p.id DESC LIMIT 200').all());
});
app.post('/api/payments', requirePermission('payments'), (req, res) => {
  const partyType = req.body.partyType;
  const direction = req.body.direction;
  if (!['Customer', 'Supplier'].includes(partyType) || !['Received', 'Paid'].includes(direction)) throw new Error('Choose a valid transaction type.');
  if (req.session.user.role === 'Salesperson' && (partyType !== 'Customer' || direction !== 'Received')) {
    return res.status(403).json({ error: 'Salespeople may only record payments received from customers.' });
  }
  const party = text(req.body.party, 'Customer or supplier');
  const amount = positiveAmount(req.body.amount);
  const method = text(req.body.method || 'Cash', 'Payment method', 40);
  const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 300) : '';
  const result = db.prepare('INSERT INTO payments(party_type,party,direction,amount,method,note,user_id) VALUES(?,?,?,?,?,?,?)')
    .run(partyType, party, direction, amount, method, note, req.session.user.id);
  audit(req, 'finance.payment.create', `${direction} ${amount} ${partyType}: ${party}`);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

app.get('/api/reports', requirePermission('reports'), (req, res) => {
  const start = req.query.start || '0001-01-01';
  const end = req.query.end || '9999-12-31';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
    return res.status(400).json({ error: 'Enter a valid date range.' });
  }
  const sales = db.prepare('SELECT COUNT(*) AS invoice_count,COALESCE(SUM(total),0) AS total_sales FROM invoices WHERE date(created_at) BETWEEN ? AND ?').get(start, end);
  const profit = db.prepare('SELECT COALESCE(SUM((ii.unit_price-ii.unit_cost)*ii.quantity),0) AS gross_profit FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id WHERE date(i.created_at) BETWEEN ? AND ?').get(start, end);
  const expenses = db.prepare('SELECT COALESCE(SUM(amount),0) AS total_expenses FROM expenses WHERE date(created_at) BETWEEN ? AND ?').get(start, end);
  const inventory = db.prepare("SELECT COALESCE(SUM(b.quantity*b.unit_cost),0) AS stock_value FROM batches b WHERE b.expiry_date>=date('now')").get();
  res.json({ ...sales, ...profit, ...expenses, ...inventory });
});
app.get('/api/audit', requirePermission('audit'), (req, res) => {
  res.json(db.prepare('SELECT id,username,action,details,created_at FROM audit_log ORDER BY id DESC LIMIT 300').all());
});
app.get('/api/users', requirePermission('users'), (req, res) => {
  res.json(db.prepare('SELECT id,username,role,created_at FROM users ORDER BY id').all());
});
app.post('/api/users', requirePermission('users'), asyncRoute(async (req, res) => {
  const username = text(req.body.username, 'Username', 50);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const role = req.body.role;
  if (username.length < 3 || !/^[a-zA-Z0-9._-]+$/.test(username)) throw new Error('Username must be 3-50 characters and use letters, numbers, dots, underscores or hyphens.');
  if (password.length < 12 || password.length > 200) throw new Error('Password must be between 12 and 200 characters.');
  if (!ROLES.includes(role)) throw new Error('Choose a valid user role.');
  const hash = await bcrypt.hash(password, 12);
  const result = db.prepare('INSERT INTO users(username,password_hash,role) VALUES(?,?,?)').run(username, hash, role);
  audit(req, 'users.create', `Created ${role} account ${username}`);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
}));

app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: '1h' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof Error && (error.message.includes('UNIQUE constraint failed') || error.message.includes('CHECK constraint failed'))) {
    return res.status(409).json({ error: 'That record conflicts with existing data. Check for duplicate values.' });
  }
  if (error instanceof Error && !(error instanceof SyntaxError) && !(error.code && error.code.startsWith('SQLITE_'))) {
    return res.status(400).json({ error: error.message });
  }
  console.error('MediCore request failed:', error);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`MediCore is listening on port ${PORT}`);
  if (!hasAdmin()) console.log('First-time administrator setup is required.');
});
