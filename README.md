# Advance Auto Rentals

Secure operations software for Advance Auto Rentals. It is a separate application so the existing MANSI prototype in the parent workspace remains untouched.

## Included

- Next.js operations dashboard with Firebase Authentication gate
- Self-service staff registration with an administrator approval screen, role assignment and optional email notification of each request
- Firestore/Storage security rules and indexes
- Transactional reservation, checkout, extension, return, pricing and payment workflows that run in the browser against Firestore, so no Blaze-plan Cloud Functions are required
- Cloudinary media capture for vehicle condition photos, fleet photos and driver's licence images
- Printable rental agreement rebuilt from the stored booking, with an employee review workflow — submit, approve or reject, then email — and an immutable snapshot of what was approved
- Optional contract email and staff access notifications through a separate serverless endpoint (`services/contract-mailer/`) so the mail provider's key never reaches the browser
- Append-only audit and financial ledger records
- Spreadsheet import that defaults to dry-run and produces a validation report
- Emulator configuration, security-rule tests, unit tests, CI, and deployment/recovery documentation

## Start locally

1. Copy `.env.example` to `.env.local` and fill in a **development** Firebase project configuration.
2. Install dependencies with `pnpm install`.
3. Run `pnpm exec firebase login`, then replace the staging/production aliases in `.firebaserc`. The default `demo-advance-auto-rentals` alias is emulator-only and cannot deploy a real project.
4. Start local services: `pnpm exec firebase emulators:start`.
5. In another terminal run `pnpm dev` and open `http://localhost:3000`.

The application refuses to initialise Firebase until all public configuration values are present. Set `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true` for local work.

## Inventory import

The supplied workbook has an `INVENTORY` sheet. It contains 33 non-empty vehicle records. The import deliberately flags missing VINs, years, insurance expirations, and rates; it does not silently invent values.

```powershell
pnpm import:inventory -- --file "C:\Users\shrey\Downloads\Advance Auto Rentals Inventory.xlsx"
pnpm import:inventory -- --file "C:\Users\shrey\Downloads\Advance Auto Rentals Inventory.xlsx" --commit
```

The first command is dry-run. `--commit` is required to write, and each run creates a timestamped report under `reports/`. See `docs/migration.md` before importing production data.

## Commands

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:rules
pnpm verify
```

## Staff access

A new account registers itself and is stored with `status: "pending"`. It can sign in, and it reaches nothing: the security rules read `role` and `status` from `users/{uid}`. An administrator approves it and assigns the role on the **Staff** screen, and the account opens as soon as it does — no second sign-in needed.

Two things have to be true before anyone can register at all:

- **Email/Password and Google must be enabled** in Firebase Authentication → Sign-in method. They are off in a new project, and until then sign-in fails with `auth/operation-not-allowed` however correct the credentials are.
- **One administrator must exist already**, because approval is an administrator's decision. Seed the first one by hand — see [`docs/deployment.md`](docs/deployment.md).

Set `NEXT_PUBLIC_STAFF_MAILER_URL` and `STAFF_NOTIFICATION_EMAILS` and each request is also emailed to the administrators; leave them unset and requests still queue on the Staff screen, which says so.

See [`docs/architecture.md`](docs/architecture.md), [`docs/security.md`](docs/security.md), and [`docs/deployment.md`](docs/deployment.md).
