# Advance Auto Rentals

Secure operations software for Advance Auto Rentals. It is a separate application so the existing MANSI prototype in the parent workspace remains untouched.

## Included

- Next.js operations dashboard with Firebase Authentication gate
- Firestore/Storage security rules, indexes, App Check-aware callable functions
- Transactional reservation, checkout, return, pricing, payment and rate-change workflows
- Immutable audit and financial ledger records
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
pnpm functions:build
pnpm verify
```

See [`docs/architecture.md`](docs/architecture.md), [`docs/security.md`](docs/security.md), and [`docs/deployment.md`](docs/deployment.md).
