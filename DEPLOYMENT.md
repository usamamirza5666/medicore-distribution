# Deploy MediCore on Render

Render gives the app a public HTTPS address that can be shared with anyone. The
app must remain deployed for that address to work. This configuration uses a
Render persistent disk for the SQLite database; a free, ephemeral filesystem
would lose user accounts, inventory, and invoices when the service restarts.
Render persistent disks require a paid web-service plan.

## Publish and deploy

1. Put the project files, including `render.yaml` and `package-lock.json`, in a
   GitHub repository. Do not upload the `node_modules` or local `data` folders.
2. In Render, choose **New → Blueprint** and connect that repository.
3. During setup, enter a long, unique random value for the prompted
   `SETUP_TOKEN` secret. Save it somewhere secure; it is needed once to create
   the first administrator. Do not put it in the repository.
4. Review the paid service and persistent disk, then create the Blueprint.
   Render will generate the `SESSION_SECRET` and deploy the app.
5. Once the service is live, open its `https://<service-name>.onrender.com`
   address. Enter the setup code and create the administrator account.
6. Share that HTTPS address. Each person can open it in a browser and sign in
   with an account the administrator creates.

The `SETUP_TOKEN` protects the unclaimed first-admin screen from a visitor
registering the public site before its owner. After the administrator exists,
the setup endpoint rejects further attempts regardless of the token.

The SQLite database and sessions are stored under `/var/data/medicore` on the
persistent disk. Keep that disk attached and do not scale this SQLite service
to multiple instances. Back up the database regularly. A custom domain can be
added later in the Render service's **Settings → Custom Domains**.
