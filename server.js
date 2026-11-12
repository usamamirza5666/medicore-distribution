'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const db = require('./database');

const PORT = Number(process.env.PORT) || 3000;
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set when NODE_ENV=production.');
}

class SQLiteSessionStore extends session.Store {
  get(sid, callback) {
    db.get('SELECT sess FROM sessions WHERE sid = ? AND expired_at > ?', sid, Date.now())
      .then((row) => callback(null, row ? JSON.parse(row.sess) : null), callback);
  }
  set(sid, sess, callback = () => {}) {
    const expiresAt = sess.cookie && sess.cookie.expires
      ? new Date(sess.cookie.expires).getTime()
      : Date.now() + 8 * 60 * 60 * 1000;
    db.run('INSERT INTO sessions(sid,sess,expired_at) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess, expired_at=excluded.expired_at',
      sid, JSON.stringify(sess), expiresAt).then(() => callback(null), callback);
  }
  destroy(sid, callback = () => {}) {
    db.run('DELETE FROM sessions WHERE sid = ?', sid).then(() => callback(null), callback);
  }
  touch(sid, sess, callback = () => {}) {
    this.set(sid, sess, callback);
  }
}

const app = express();
if (process.env.TRUST_PROXY === '1' || process.env.VERCEL) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  db.initialize().then(() => next(), next);
});
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
const hasAdmin = async () => Boolean(await db.get("SELECT 1 FROM users WHERE role = 'Administrator' LIMIT 1"));
const audit = (req, action, details) => db.run('INSERT INTO audit_log(user_id,username,action,details) VALUES(?,?,?,?)',
  req.session.user.id, req.session.user.username, action, String(details).slice(0, 1000));
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

app.get('/api/status', asyncRoute(async (req, res) => res.json({
  setupRequired: !(await hasAdmin()),
  setupTokenRequired: process.env.NODE_ENV === 'production'
})));
app.post('/api/setup', asyncRoute(async (req, res) => {
  if (await hasAdmin()) return res.status(409).json({ error: 'Initial administrator setup has already been completed.' });
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
  const result = await db.transaction(async (tx) => {
    if (await tx.get("SELECT 1 FROM users WHERE role = 'Administrator' LIMIT 1")) return null;
    return tx.insert('INSERT INTO users(username,password_hash,role) VALUES(?,?,?)', username, hash, 'Administrator');
  });
  if (!result) return res.status(409).json({ error: 'Initial administrator setup has already been completed.' });
  req.session.user = { id: Number(result.lastInsertRowid), username, role: 'Administrator' };
  req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  await audit(req, 'admin.setup', 'Created initial administrator account');
  res.status(201).json({ user: req.session.user, csrfToken: req.session.csrfToken });
}));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false });
app.post('/api/login', loginLimiter, asyncRoute(async (req, res) => {
  if (!(await hasAdmin())) return res.status(428).json({ error: 'Complete first-time administrator setup before signing in.' });
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const user = await db.get('SELECT id,username,password_hash,role FROM users WHERE lower(username) = lower(?)', username);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }
  await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
  req.session.user = { id: Number(user.id), username: user.username, role: user.role };
  req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  await audit(req, 'auth.login', 'Signed in');
  res.json({ user: req.session.user, csrfToken: req.session.csrfToken });
}));
app.post('/api/logout', requireAuth, csrfGuard, asyncRoute(async (req, res) => {
  await audit(req, 'auth.logout', 'Signed out');
  await new Promise((resolve, reject) => req.session.destroy((error) => error ? reject(error) : resolve()));
  res.clearCookie('medicore.sid');
  res.json({ ok: true });
}));
app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.session.user, csrfToken: req.session.csrfToken }));

app.use('/api', requireAuth, csrfGuard);

app.get('/api/dashboard', requirePermission('dashboard'), asyncRoute(async (req, res) => {
  const sales = (await db.get('SELECT COALESCE(SUM(total),0) AS total FROM invoices WHERE created_at::date=CURRENT_DATE')).total;
  const profit = (await db.get('SELECT COALESCE(SUM((ii.unit_price-ii.unit_cost)*ii.quantity),0) AS total FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id WHERE i.created_at::date=CURRENT_DATE')).total;
  const lowStock = await db.all(`SELECT m.id,m.name,m.sku,m.reorder_level,
    COALESCE(SUM(CASE WHEN b.expiry_date >= CURRENT_DATE::text THEN b.quantity ELSE 0 END),0) AS quantity
    FROM medicines m LEFT JOIN batches b ON b.medicine_id=m.id GROUP BY m.id
    HAVING COALESCE(SUM(CASE WHEN b.expiry_date >= CURRENT_DATE::text THEN b.quantity ELSE 0 END),0) <= m.reorder_level
    ORDER BY quantity ASC LIMIT 8`);
  const expiring = await db.all("SELECT b.batch_number,b.expiry_date,b.quantity,m.name FROM batches b JOIN medicines m ON m.id=b.medicine_id WHERE b.quantity>0 AND b.expiry_date BETWEEN CURRENT_DATE::text AND (CURRENT_DATE + INTERVAL '90 days')::text ORDER BY b.expiry_date LIMIT 8");
  res.json({ sales, profit, lowStock, expiring });
}));

app.get('/api/medicines', requirePermission('inventory'), asyncRoute(async (req, res) => {
  res.json(await db.all(`SELECT m.id,m.name,m.sku,m.unit,m.reorder_level,
    COALESCE(SUM(CASE WHEN b.expiry_date >= CURRENT_DATE::text THEN b.quantity ELSE 0 END),0) AS quantity,
    COALESCE(SUM(CASE WHEN b.expiry_date >= CURRENT_DATE::text THEN b.quantity*b.unit_cost ELSE 0 END),0) AS stock_value
    FROM medicines m LEFT JOIN batches b ON b.medicine_id=m.id GROUP BY m.id ORDER BY m.name`));
}));
app.post('/api/medicines', requirePermission('inventory'), asyncRoute(async (req, res) => {
  const name = text(req.body.name, 'Medicine name');
  const sku = text(req.body.sku, 'SKU', 50);
  const unit = text(req.body.unit || 'unit', 'Unit', 30);
  const reorder = req.body.reorderLevel === undefined ? 10 : Number(req.body.reorderLevel);
  if (!Number.isSafeInteger(reorder) || reorder < 0) throw new Error('Reorder level must be a non-negative whole number.');
  const result = await db.insert('INSERT INTO medicines(name,sku,unit,reorder_level) VALUES(?,?,?,?)', name, sku, unit, reorder);
  await audit(req, 'inventory.medicine.create', `Created medicine ${sku}`);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
}));

app.get('/api/purchases', requirePermission('purchases'), asyncRoute(async (req, res) => {
  res.json(await db.all('SELECT p.*,u.username FROM purchases p LEFT JOIN users u ON u.id=p.user_id ORDER BY p.id DESC LIMIT 200'));
}));
app.post('/api/purchases', requirePermission('purchases'), asyncRoute(async (req, res) => {
  const supplier = text(req.body.supplier, 'Supplier');
  const reference = text(req.body.reference, 'Purchase reference', 80);
  const medicineId = positiveInt(req.body.medicineId, 'Medicine');
  const batchNumber = text(req.body.batchNumber, 'Batch number', 80);
  const expiryDate = text(req.body.expiryDate, 'Expiry date', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryDate) || Number.isNaN(Date.parse(`${expiryDate}T00:00:00Z`))) throw new Error('Expiry date must be a valid date.');
  const quantity = positiveInt(req.body.quantity, 'Quantity');
  const unitCost = nonNegative(req.body.unitCost, 'Unit cost');
  const medicine = await db.get('SELECT id FROM medicines WHERE id=?', medicineId);
  if (!medicine) throw new Error('Selected medicine does not exist.');
  const id = await db.transaction(async (tx) => {
    const total = quantity * unitCost;
    const purchase = await tx.insert('INSERT INTO purchases(supplier,reference,total,user_id) VALUES(?,?,?,?)',
      supplier, reference, total, req.session.user.id);
    const prior = await tx.get('SELECT id FROM batches WHERE medicine_id=? AND batch_number=?', medicineId, batchNumber);
    let batchId;
    if (prior) {
      const batch = await tx.get('SELECT expiry_date,unit_cost FROM batches WHERE id=?', prior.id);
      if (batch.expiry_date !== expiryDate || batch.unit_cost !== unitCost) throw new Error('An existing batch must keep the same expiry date and unit cost.');
      await tx.run('UPDATE batches SET quantity=quantity+? WHERE id=?', quantity, prior.id);
      batchId = prior.id;
    } else {
      batchId = Number((await tx.insert('INSERT INTO batches(medicine_id,batch_number,expiry_date,quantity,unit_cost) VALUES(?,?,?,?,?)',
        medicineId, batchNumber, expiryDate, quantity, unitCost)).lastInsertRowid);
    }
    await tx.insert('INSERT INTO purchase_items(purchase_id,medicine_id,batch_id,quantity,unit_cost) VALUES(?,?,?,?,?)',
      purchase.lastInsertRowid, medicineId, batchId, quantity, unitCost);
    return Number(purchase.lastInsertRowid);
  });
  await audit(req, 'inventory.purchase.create', `Recorded purchase ${reference}`);
  res.status(201).json({ id });
}));

app.get('/api/invoices', requirePermission('sales'), asyncRoute(async (req, res) => {
  res.json(await db.all('SELECT i.*,u.username FROM invoices i LEFT JOIN users u ON u.id=i.user_id ORDER BY i.id DESC LIMIT 200'));
}));
app.post('/api/invoices', requirePermission('sales'), asyncRoute(async (req, res) => {
  const customer = text(req.body.customer, 'Customer');
  const items = req.body.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) throw new Error('An invoice must contain between 1 and 50 line items.');
  const normalized = items.map((item) => ({
    medicineId: positiveInt(item.medicineId, 'Medicine'),
    quantity: positiveInt(item.quantity, 'Quantity'),
    unitPrice: nonNegative(item.unitPrice, 'Unit price')
  }));
  const reference = `INV-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const id = await db.transaction(async (tx) => {
    const allocations = [];
    const reserved = new Map();
    for (const item of normalized) {
      const batches = await tx.all('SELECT id,quantity,unit_cost FROM batches WHERE medicine_id=? AND quantity>0 AND expiry_date>=CURRENT_DATE::text ORDER BY expiry_date ASC,id ASC FOR UPDATE', item.medicineId);
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
    const invoice = await tx.insert('INSERT INTO invoices(customer,reference,total,user_id) VALUES(?,?,?,?)',
      customer, reference, total, req.session.user.id);
    for (const allocation of allocations) {
      const changed = (await tx.run('UPDATE batches SET quantity=quantity-? WHERE id=? AND quantity>=?',
        allocation.quantity, allocation.batchId, allocation.quantity)).changes;
      if (!changed) throw new Error('Stock changed while creating the invoice. Please try again.');
      await tx.insert('INSERT INTO invoice_items(invoice_id,medicine_id,batch_id,quantity,unit_price,unit_cost) VALUES(?,?,?,?,?,?)',
        invoice.lastInsertRowid, allocation.medicineId, allocation.batchId, allocation.quantity, allocation.unitPrice, allocation.unitCost);
    }
    return Number(invoice.lastInsertRowid);
  });
  await audit(req, 'sales.invoice.create', `Created ${reference} for ${customer}`);
  res.status(201).json({ id, reference });
}));

app.get('/api/expenses', requirePermission('expenses'), asyncRoute(async (req, res) => {
  res.json(await db.all('SELECT e.*,u.username FROM expenses e LEFT JOIN users u ON u.id=e.user_id ORDER BY e.id DESC LIMIT 200'));
}));
app.post('/api/expenses', requirePermission('expenses'), asyncRoute(async (req, res) => {
  const category = text(req.body.category, 'Category', 80);
  const description = text(req.body.description, 'Description', 300);
  const amount = positiveAmount(req.body.amount);
  const result = await db.insert('INSERT INTO expenses(category,description,amount,user_id) VALUES(?,?,?,?)',
    category, description, amount, req.session.user.id);
  await audit(req, 'finance.expense.create', `${category}: ${amount}`);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
}));
function positiveAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000000) throw new Error('Amount must be greater than zero and within the supported range.');
  return amount;
}

app.get('/api/payments', requirePermission('payments'), asyncRoute(async (req, res) => {
  res.json(await db.all('SELECT p.*,u.username FROM payments p LEFT JOIN users u ON u.id=p.user_id ORDER BY p.id DESC LIMIT 200'));
}));
app.post('/api/payments', requirePermission('payments'), asyncRoute(async (req, res) => {
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
  const result = await db.insert('INSERT INTO payments(party_type,party,direction,amount,method,note,user_id) VALUES(?,?,?,?,?,?,?)',
    partyType, party, direction, amount, method, note, req.session.user.id);
  await audit(req, 'finance.payment.create', `${direction} ${amount} ${partyType}: ${party}`);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
}));

app.get('/api/reports', requirePermission('reports'), asyncRoute(async (req, res) => {
  const start = req.query.start || '0001-01-01';
  const end = req.query.end || '9999-12-31';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
    return res.status(400).json({ error: 'Enter a valid date range.' });
  }
  const sales = await db.get('SELECT COUNT(*) AS invoice_count,COALESCE(SUM(total),0) AS total_sales FROM invoices WHERE created_at::date BETWEEN ? AND ?', start, end);
  const profit = await db.get('SELECT COALESCE(SUM((ii.unit_price-ii.unit_cost)*ii.quantity),0) AS gross_profit FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id WHERE i.created_at::date BETWEEN ? AND ?', start, end);
  const expenses = await db.get('SELECT COALESCE(SUM(amount),0) AS total_expenses FROM expenses WHERE created_at::date BETWEEN ? AND ?', start, end);
  const inventory = await db.get('SELECT COALESCE(SUM(b.quantity*b.unit_cost),0) AS stock_value FROM batches b WHERE b.expiry_date>=CURRENT_DATE::text');
  res.json({ ...sales, ...profit, ...expenses, ...inventory });
}));
app.get('/api/audit', requirePermission('audit'), asyncRoute(async (req, res) => {
  res.json(await db.all('SELECT id,username,action,details,created_at FROM audit_log ORDER BY id DESC LIMIT 300'));
}));
app.get('/api/users', requirePermission('users'), asyncRoute(async (req, res) => {
  res.json(await db.all('SELECT id,username,role,created_at FROM users ORDER BY id'));
}));
app.post('/api/users', requirePermission('users'), asyncRoute(async (req, res) => {
  const username = text(req.body.username, 'Username', 50);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const role = req.body.role;
  if (username.length < 3 || !/^[a-zA-Z0-9._-]+$/.test(username)) throw new Error('Username must be 3-50 characters and use letters, numbers, dots, underscores or hyphens.');
  if (password.length < 12 || password.length > 200) throw new Error('Password must be between 12 and 200 characters.');
  if (!ROLES.includes(role)) throw new Error('Choose a valid user role.');
  const hash = await bcrypt.hash(password, 12);
  const result = await db.insert('INSERT INTO users(username,password_hash,role) VALUES(?,?,?)', username, hash, role);
  await audit(req, 'users.create', `Created ${role} account ${username}`);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
}));

app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: '1h' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error && (error.code === '23505' || error.code === '23514'
    || error.message.includes('UNIQUE constraint failed') || error.message.includes('CHECK constraint failed'))) {
    return res.status(409).json({ error: 'That record conflicts with existing data. Check for duplicate values.' });
  }
  if (error instanceof Error && !error.code && !(error instanceof SyntaxError)) {
    return res.status(400).json({ error: error.message });
  }
  console.error('MediCore request failed:', error);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

if (require.main === module) {
  db.initialize().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`MediCore is listening on port ${PORT}`);
    });
  }).catch((error) => {
    console.error('MediCore could not initialize its database:', error);
    process.exitCode = 1;
  });
}
module.exports = app;