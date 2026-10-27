# MediCore Distribution Management

MediCore is a self-hosted web application for a medicine wholesaler or distributor. This workspace began empty; the initial implementation uses the Node.js 24 built-in HTTP server and SQLite (`node:sqlite`), so the application has no npm runtime dependencies.

## Project structure

```text
server.js                 HTTP API, SQLite schema, authentication, business rules
public/
  index.html              Application entry point
  app.js                  Responsive browser UI and API client
  styles.css              Shared design system and print styles
test/
  workflows.test.js       End-to-end inventory, sales, accounting and access tests
data/                     Created at runtime; SQLite database (not checked in)
```

## Development plan and delivered scope

The implementation was built in vertical slices:

1. Establish the Node/SQLite application shell, secure first-admin setup, authentication, role checks and audit events.
2. Add medicine/customer/supplier records and supplier purchases that receive batch-level stock.
3. Add FEFO sales, expired/unavailable-stock protection, invoice price snapshots, COGS, receipts/payments and operating expenses.
4. Add dashboards, date-filtered sales and inventory reports, CSV export, invoice printing, responsive layouts and workflow tests.

The delivered release supports those workflows. It is a useful operational foundation, **not yet a fully certified production ERP**. In particular, it does not yet include purchase orders, sales/purchase returns or credit notes, invoice cancellation/reversal workflows, manual stock adjustments/damaged-stock write-offs, product edits, user deactivation, complete customer/supplier statement exports, cash-versus-bank balance reconciliation, XLSX/PDF report generation, or automated scheduled backups. Do not use it as a substitute for regulated accounting, tax, or pharmaceutical compliance advice. Add and validate these workflows before relying on MediCore for production financial close or regulated traceability.

## Requirements and local setup

- Node.js 24 or later (`node:sqlite` is used).
- Windows PowerShell, macOS Terminal, or Linux shell.

From the project directory:

```powershell
npm test
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). On first launch, create the initial administrator account in the setup screen. There are no demo accounts or seeded business records. Use a unique password with at least 12 characters.

The default listener is `127.0.0.1:3000`. To change it in PowerShell:

```powershell
$env:HOST = "127.0.0.1"
$env:PORT = "3000"
$env:DATA_DIR = "C:\MediCore\data"
npm start
```

The database is created as `medicore.sqlite` inside `DATA_DIR` (default: `.\data`). Do not place the database in a public web directory or commit it to source control.

## Core workflows

1. Create supplier and customer profiles.
2. Create medicine catalogue records with a low-stock threshold and sale/retail prices.
3. Record supplier invoices. Each line receives a product, batch, expiry, quantity and unit purchase cost. Repeated receipts of the same product/batch update its on-hand quantity and weighted-average valuation cost.
4. Record a sales invoice. The server allocates available batches in earliest-expiry-first order, rejects expired or insufficient stock, records batch-level cost and decrements quantities in a database transaction.
5. Record a receipt or supplier payment. Payments apply to the oldest open invoices first and cannot exceed the account's outstanding balance. Non-empty payment references are unique per account and direction.
6. Record operating expenses and use the date-filtered report for sales, COGS, gross profit, expenses, net profit and batch stock valuation. Report tables can be downloaded as CSV or printed; sales invoices can be printed from the invoice number.

Amounts are stored in PKR. Invoice totals and sales COGS are persisted as transaction snapshots; changing catalogue prices does not rewrite posted invoice prices.

## Roles

| Role | Main access |
|---|---|
| Administrator | All modules, user administration and audit log |
| Manager | Operations, users, reports and audit log |
| Salesperson | Sales, customers, products and receipts |
| Storekeeper | Inventory and purchases |
| Accountant | Sales/purchase history, parties, payments, expenses and reports |

Authorization is enforced by the API, not only by hidden navigation. All posted transactions and important record creation/login events are appended to the audit log. Completed invoices cannot be deleted through the application.

## Deployment and security notes

- Keep the listener on loopback behind a maintained HTTPS reverse proxy. Restrict access to the application and its first-run setup to your trusted network.
- Set `NODE_ENV=production` to enable the `Secure` session-cookie attribute. Terminate TLS at the proxy, preserve the external `Host` header, and do not expose the app over plain public HTTP.
- Use a dedicated Windows service account or restricted OS user for the process and database directory. Limit filesystem access to authorized operators.
- Sessions are in memory and expire after inactivity; a server restart signs users out. Use a process supervisor for availability and plan a maintenance window for upgrades.
- The database uses SQLite WAL mode, foreign keys, and transactional invoice posting. Keep the database on a local disk; do not share the SQLite file over a network filesystem.
- First-run setup is available only while the user table is empty. Start the server on loopback for initial setup and do not expose the setup screen on an untrusted network.

## Backup and recovery

The application does not yet schedule or verify backups. Establish an encrypted, access-controlled backup process and routinely test restores. For a simple manual local backup:

1. Stop MediCore gracefully (`Ctrl+C`) so SQLite closes and checkpoints its write-ahead log.
2. Copy `data\medicore.sqlite` (or the configured `DATA_DIR` database) to a dated, access-restricted backup location.
3. Record the backup date and verify that the copied file is non-empty. Keep multiple generations off the application host.

To restore, stop the server, preserve a copy of the current database for investigation, replace the database file with the selected known-good backup, and restart. Validate the login, recent invoices and stock balances before returning the restored instance to users. For important businesses, automate SQLite-consistent snapshots and test recovery objectives before deployment.

## Validation

`npm test` launches an isolated temporary database and exercises first-run setup, authentication, role authorization, purchase receipt, multiple batch FEFO allocation, COGS, customer/supplier balances, payment duplicate/overpayment protection, invalid dates and expired-stock rejection. The tests remove their temporary database after completion.
