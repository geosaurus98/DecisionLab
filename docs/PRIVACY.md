# Privacy and security

DecisionLab holds sensitive personal financial data, so privacy is a core design constraint.

## What happens to your data

| Data | Where it lives | Leaves the device? |
| --- | --- | --- |
| Transactions, categories, rules, decisions, scenarios, plan settings | IndexedDB in this browser profile | Never, unless you download a backup |
| Imported CSV files | Read in memory by the File API; only parsed rows are stored | Never uploaded |
| Theme preference | `localStorage` | No |
| Backups | A file you download | Only where you put it |

- No server, no account, no authentication (none is needed for a strictly local app).
- No analytics, telemetry, error reporting, third-party scripts or web fonts. The production build ships a strict Content-Security-Policy (`connect-src 'self'`, `script-src 'self'`), so even a compromised dependency could not send data to another origin from the page.
- Links you store in decisions are plain text; DecisionLab never fetches them.
- The app does not log transaction data to the browser console.
- Any future external integration (bank feeds, sync) must be opt-in with explicit consent and documented here first.

## Limitations of browser storage — read this

- **IndexedDB is not encrypted by DecisionLab.** Anyone who can use your browser profile, or read your disk, can read your data (e.g. via developer tools). Protect the device: OS login, full-disk encryption (BitLocker/FileVault/Android device encryption), and ideally a dedicated browser profile.
- Browser extensions with access to the page could read it. Use a profile without untrusted extensions.
- **Data can be lost**: clearing site data, uninstalling the browser, private/incognito windows, or storage eviction under disk pressure. DecisionLab requests persistent storage (`navigator.storage.persist()`); Settings shows whether it was granted. Keep backups.
- Data is per browser and per origin: opening the app from a different URL or browser shows a different (empty) database.

## Backups

- **Encrypted backup (recommended)**: AES-256-GCM, key derived from your passphrase with PBKDF2-HMAC-SHA-256, 600,000 iterations, random 16-byte salt and 12-byte IV per backup (Web Crypto API). GCM authentication means a wrong passphrase or tampered file fails cleanly. There is no recovery if you forget the passphrase. Strength depends entirely on the passphrase: use a long, unique one.
- **Plain backup**: readable JSON containing everything. Treat it like a bank statement.
- Restores validate the whole file before replacing anything and run in one database transaction.

## Safe CSV processing

- Files are size-limited (10 MB, 50,000 rows) and parsed as data only; nothing is evaluated.
- Values are rendered as text by React (no HTML injection).
- CSV exports neutralise spreadsheet formula injection (cells starting with `=`, `+`, `-`, `@` are prefixed with `'`, except plain numbers).

## Deleting data

- Undo an import: removes exactly the transactions it created.
- Delete an account: removes it with its transactions and import history.
- Remove demo data: removes only synthetic accounts, transactions and decisions.
- Settings → Data & privacy → **Delete everything**: clears all tables (type `DELETE` to confirm). Browser-level “clear site data” also removes everything.

## Development rules

Use only synthetic data in tests, fixtures, screenshots and bug reports. Keep personal CSVs in `./private/` (git-ignored). Backups (`*.decisionlab-backup*.json`) are git-ignored too.
