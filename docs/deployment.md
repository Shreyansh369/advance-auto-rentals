# Deployment and recovery

## Environment separation

Create three separate Firebase projects: development, staging and production. Register a web app in each and give only its public configuration to the matching environment file. Never set `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true` outside local development.

Before the first staging deployment:

1. Enable Email/Password (or the selected approved provider) in Firebase Authentication and provision users through the Admin SDK/console. Use `setUserRole` from an already-admin account to issue custom role claims.
2. Create the Firestore database, Storage bucket and App Check web-provider configuration. Set the reCAPTCHA Enterprise site key in the corresponding hosting environment.
3. Replace `.firebaserc` aliases with real staging/production project IDs locally only if the repository is private; preferably use `firebase use --add` and keep deployment mapping in a secure CI environment.
4. Deploy rules and indexes first to staging: `pnpm exec firebase use staging` then `pnpm exec firebase deploy --only firestore:rules,firestore:indexes,storage`.
5. Deploy functions and web hosting only after `pnpm verify`, `pnpm test:rules`, and an approved staging acceptance run.

The supplied `Deploy` workflow is manual-only and uses protected GitHub environments. In each `staging` and `production` environment, configure `GCP_WIF_PROVIDER`, `GCP_DEPLOYER_SERVICE_ACCOUNT`, and `FIREBASE_PROJECT_ID`; set the remaining public web configuration as GitHub environment variables named `FIREBASE_*` and `RECAPTCHA_ENTERPRISE_SITE_KEY`; require production reviewer approval. The deployer service account needs only the Firebase Hosting, Functions deploy, Firestore rules/index and Storage rules deployment permissions. App Check enforcement and a named rollback owner must be confirmed before its first production run.

## Release checks

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm functions:build`, and `pnpm build`
- `pnpm test:rules` with Firestore and Storage emulators
- dependency audit and secret scan
- staging workflow: customer → reservation → checkout → inspection → payment → return → final balance; test a duplicate payment and conflicting reservation
- mobile browser verification for sign-in, photo capture and return inspection

## Recovery

- **Bad frontend:** redeploy the previously approved hosting build.
- **Bad function:** redeploy the preceding function revision; do not delete financial documents to compensate.
- **Bad rules:** restore the preceding reviewed rules file, deploy it, then run its emulator tests before reopening access.
- **Migration incident:** stop the import, preserve its report and `imports` document, restore affected documents from the pre-import Firestore export, and perform a reviewed reconciliation. Historic payments, refunds and ledger records are corrected with new compensating records rather than deletion.

Cloud Functions requires a supported Node runtime. This repository sets Node 22. The local toolchain used for development may be newer; production runtime comes from `firebase.json`.
