# Deployment and recovery

## Rules are not deployed by merging

Firestore and Storage rules ship separately from the web build. Merging a pull request, and deploying hosting, both leave the rules in the live project exactly as they were.

The symptom when they fall behind is specific and misleading: a screen reports **"Your account does not have permission for this action."** to a user who has every permission, because the application is reading a collection the deployed rules do not mention and the default deny catches it. It is not an account problem and re-granting a role will not fix it.

So whenever a release adds or renames a collection, deploy the rules with it:

```bash
pnpm exec firebase deploy --project <project-id> --only firestore:rules,firestore:indexes
```

`tests/rules/firestore.rules.test.ts` asserts that every collection the client reads is matched by a rule in this repository, which catches the rule that was never written. It cannot see what is actually deployed, so the deploy step above is still yours to run.

Releases that have needed it so far: `reservationContracts` and its `versions`/`deliveries` subcollections, and `rentals/{id}/extensions`.

## Firebase Storage is not used

Media lives in Cloudinary: vehicle photos, condition evidence and driver's licence images all upload straight there. The only remaining reference to Firebase Storage is a fallback in `components/customer-license-capture.tsx` that resolves licence images captured *before* that migration, and it is dead on any project whose bucket was never provisioned.

So Storage is deliberately left unprovisioned, and `storage` is not in the deploy targets. Setting it up is what would force the Blaze plan; nothing in the application needs it. Attempting to deploy it on a project without a bucket fails with:

```
Error: Firebase Storage has not been set up on project '<id>'.
```

`storage.rules` and its tests are kept because they are correct and reviewed, and `firebase.json` still configures the Storage emulator so `pnpm test:rules` can exercise them. If Storage is ever genuinely needed — a migration away from Cloudinary, say — provision the bucket, add `storage` back to the `--only` list here and in `.github/workflows/deploy.yml`, and deploy the rules with it. Never enable the bucket without deploying those rules.

## Environment separation

Create three separate Firebase projects: development, staging and production. Register a web app in each and give only its public configuration to the matching environment file. Never set `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true` outside local development.

Before the first staging deployment:

1. Enable Email/Password and Google in Firebase Authentication. Staff register themselves from the Sign up screen, which creates a pending profile; an administrator then sets `role` and `status: "approved"` on that `users/{uid}` document. Seed the very first administrator directly in the Firestore console, because approval requires an existing administrator.
2. Create the Firestore database. Do **not** set up Firebase Storage — see below. Set the Cloudinary cloud name and unsigned upload preset, and the reCAPTCHA Enterprise site key, in the corresponding hosting environment.
3. Replace `.firebaserc` aliases with real staging/production project IDs locally only if the repository is private; preferably use `firebase use --add` and keep deployment mapping in a secure CI environment.
4. Deploy rules and indexes first to staging: `pnpm exec firebase deploy --project <staging-project-id> --only firestore:rules,firestore:indexes`. Pass `--project` explicitly rather than relying on the `.firebaserc` default, which points at the emulator project.
5. Deploy web hosting only after `pnpm verify`, `pnpm test:rules`, and an approved staging acceptance run. Cloud Functions are not part of the deployment: the project stays on the Spark plan and every workflow runs in the browser.

The supplied `Deploy` workflow is manual-only and uses protected GitHub environments. In each `staging` and `production` environment, configure `GCP_WIF_PROVIDER`, `GCP_DEPLOYER_SERVICE_ACCOUNT`, and `FIREBASE_PROJECT_ID`; set the remaining public web configuration as GitHub environment variables named `FIREBASE_*` and `RECAPTCHA_ENTERPRISE_SITE_KEY`; require production reviewer approval. The deployer service account needs only the Firebase Hosting and Firestore rules/index deployment permissions. App Check enforcement and a named rollback owner must be confirmed before its first production run.

## Contract email

Emailing an approved agreement is optional and off until it is configured. It runs on a separate serverless deployment, `services/contract-mailer/`, because the mail provider's API key must never reach a browser.

1. Verify the sending domain in Resend and create an API key.
2. Deploy `services/contract-mailer` (Vercel, Netlify, Cloudflare Workers and Deno Deploy all accept the handler as it stands; only `api/send-contract.ts` is platform-specific).
3. Set `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY` (the public web key), `RESEND_API_KEY`, `CONTRACT_FROM_EMAIL` and `CONTRACT_MAILER_ALLOWED_ORIGINS` on that deployment.
4. Set `NEXT_PUBLIC_CONTRACT_MAILER_URL` on the web build, add the mailer origin to the `connect-src` directive in `firebase.json`, and redeploy hosting.

Miss step 4 and the browser is blocked before the request leaves the page — by CORS if the origin is not allowed, by the Content-Security-Policy if `connect-src` was not extended. Leave `NEXT_PUBLIC_CONTRACT_MAILER_URL` unset and the agreement screen simply says email delivery is not configured and offers print and save-as-PDF. Full details are in `services/contract-mailer/README.md`.

## Release checks

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`
- `pnpm test:rules` with the Firestore, Auth and Storage emulators (the Storage emulator covers `storage.rules`, which are not deployed — see above)
- dependency audit and secret scan
- staging workflow: customer → reservation → checkout → inspection → payment → return → final balance; test a duplicate payment and conflicting reservation
- contract workflow: submit for review → reject with a note → resubmit → approve → email, and confirm the delivery receipt records the provider message ID
- rules deployed before hosting, and the booking, customers and dashboard screens loaded once against the deployed rules with no permission error
- mobile browser verification for sign-in, photo capture and return inspection

## Recovery

- **Bad frontend:** redeploy the previously approved hosting build.
- **Bad rules:** restore the preceding reviewed rules file, deploy it, then run its emulator tests before reopening access.
- **Migration incident:** stop the import, preserve its report and `imports` document, restore affected documents from the pre-import Firestore export, and perform a reviewed reconciliation. Historic payments, refunds and ledger records are corrected with new compensating records rather than deletion.

The `functions/` directory is kept as the reference implementation of the rental workflows for a future move to the Blaze plan. It is not built, deployed or called by the application, and `pnpm verify` does not compile it.
