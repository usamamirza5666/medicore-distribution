# Deploy MediCore on Vercel

MediCore keeps the local SQLite database for development. Vercel's serverless
filesystem is temporary, so production uses a hosted PostgreSQL database.

## 1. Push the project to GitHub

Create a GitHub repository and push the project files, including `package.json`,
`package-lock.json`, and `vercel.json`. Do not upload `node_modules`, the local
`data` folder, or any environment files containing secrets.

## 2. Create a PostgreSQL database

Create a hosted PostgreSQL database, for example through the Neon integration
in the Vercel Marketplace. Copy its pooled connection string and keep it secret.

## 3. Import existing MediCore records

Before deploying, run the migration from this project folder on the computer
that has the current `data/medicore.sqlite` file. Set `DATABASE_URL` in the
local process to the hosted database connection string without saving it in
the repository. In PowerShell, enter it at the hidden prompt, then run:

```powershell
$secureUrl = Read-Host "Hosted database URL" -AsSecureString
$env:DATABASE_URL = [System.Net.NetworkCredential]::new("", $secureUrl).Password
npm install
npm run migrate:postgres
Remove-Item Env:DATABASE_URL
```

The migration stops if the destination database already contains MediCore
records, to avoid overwriting or duplicating data. It copies users, medicines,
inventory, purchases, invoices, payments, expenses, and audit history. Existing
login credentials remain unchanged. Active login sessions are not copied, so
users must sign in again after deployment. The local SQLite database is not modified.

If the database has already been created and populated, do not rerun the
migration. Keep the connection string out of Git and clear it from your local
environment after migration.

## 4. Deploy the GitHub repository

In Vercel, choose **Add New → Project** and import the repository. In the
project's **Settings → Environment Variables**, add these values before using
the deployment:

- `DATABASE_URL`: the hosted PostgreSQL connection string.
- `SESSION_SECRET`: a long, unique random value.
- `SETUP_TOKEN`: a separate long, unique setup code. Keep it private; it is
  only used if the hosted database has no administrator yet.

Apply the variables to Production (and Preview if needed), then redeploy. The
application creates its tables automatically. When the deployment is ready,
open the `.vercel.app` URL shown in the Vercel project and sign in with the
existing administrator account.

If the import was not run, first-time setup will be required; use the configured
`SETUP_TOKEN` to create the administrator. Do not share that setup code.

## Local development

Without `DATABASE_URL`, `npm start` continues to use the local SQLite database.
Run `npm run check` to check JavaScript syntax.
