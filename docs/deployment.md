# Deployment and recovery

## Environment separation

Create three separate Firebase projects: development, staging and production. Register a web app in each and give only its public configuration to the matching environment file. Never set `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true` outside local development.

Before the first staging deployment:

1. Enable Email/Password and Google in Firebase Authentication. Staff register themselves from the Sign up screen, which creates a pending profile; an administrator then sets `role` and `status: "approved"` on that `users/{uid}` document. Seed the very first administrator directly in the Firestore console, because approval requires an existing administrator.
2. Create the Firestore database and, if licence images from before the Cloudinary migration must stay readable, the Storage bucket. Set the Cloudinary cloud name and unsigned upload preset, and the reCAPTCHA Enterprise site key, in the corresponding hosting environment.
3. Replace `.firebaserc` aliases with real staging/production project IDs locally only if the repository is private; preferably use `firebase use --add` and keep deployment mapping in a secure CI environment.
4. Deploy rules and indexes first to staging: `pnpm exec firebase use staging` then `pnpm exec firebase deploy --only firestore:rules,firestore:indexes,storage`.
5. Deploy web hosting only after `pnpm verify`, `pnpm test:rules`, and an approved staging acceptance run. Cloud Functions are not part of the deployment: the project stays on the Spark plan and every workflow runs in the browser.

The supplied `Deploy` workflow is manual-only and uses protected GitHub environments. In each `staging` and `production` environment, configure `GCP_WIF_PROVIDER`, `GCP_DEPLOYER_SERVICE_ACCOUNT`, and `FIREBASE_PROJECT_ID`; set the remaining public web configuration as GitHub environment variables named `FIREBASE_*` and `RECAPTCHA_ENTERPRISE_SITE_KEY`; require production reviewer approval. The deployer service account needs only the Firebase Hosting and Firestore rules/index deployment permissions. App Check enforcement and a named rollback owner must be confirmed before its first production run.

## Release checks

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`
- `pnpm test:rules` with Firestore and Storage emulators
- dependency audit and secret scan
- staging workflow: customer → reservation → checkout → inspection → payment → return → final balance; test a duplicate payment and conflicting reservation
- mobile browser verification for sign-in, photo capture and return inspection

## Recovery

- **Bad frontend:** redeploy the previously approved hosting build.
- **Bad rules:** restore the preceding reviewed rules file, deploy it, then run its emulator tests before reopening access.
- **Migration incident:** stop the import, preserve its report and `imports` document, restore affected documents from the pre-import Firestore export, and perform a reviewed reconciliation. Historic payments, refunds and ledger records are corrected with new compensating records rather than deletion.

The `functions/` directory is kept as the reference implementation of the rental workflows for a future move to the Blaze plan. It is not built, deployed or called by the application, and `pnpm verify` does not compile it.
