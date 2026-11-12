# MedSupply

MedSupply is a browser-based starter workspace for medicine distribution operations. It includes a medicine catalog, batch and expiry tracking, customer orders, returns quarantine and inspection, supplier contacts, low-stock and expiry reports, and CSV export.

## Run it

Open `index.html` in a modern browser. No build step or external package is required.

## Data and scope

Changes are stored in the browser's local storage on that device. Use **Reset sample data** to restore the demo. This starter has no user accounts, shared database, backup, or synchronization between devices; it is not a production or regulatory-compliance system. Verify applicable storage, traceability, privacy, and distribution requirements before using real operational data.

Order fulfillment checks available in-date stock and allocates from the earliest-expiring batches first. Expired stock remains visible in batch and expiry reports but is excluded from available inventory.

Customer returns are logged against their original batch and held in quarantine without changing available stock. Restocking requires documented inspection notes and is limited to in-date batches; returns marked not restockable do not change inventory. The CSV report includes return and disposition records. This workflow is an operational aid, not a substitute for required quality, traceability, or regulatory procedures.
