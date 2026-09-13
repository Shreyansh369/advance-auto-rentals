# Contract mailer

Sends an approved rental agreement to the customer by email.

The rental workspace is published as a static export with no
server of its own, and the mail provider's API key must never
be handed to a browser. This directory is therefore deployed
separately, as a single serverless function, and is the only
part of the system that holds a private credential.

## What it does

1. Reads the `Authorization: Bearer <firebase id token>` the
   employee's browser attached, and has Google's identity
   toolkit verify it. A forged or expired token resolves to
   no account and the request stops here.
2. Reads `users/{uid}` and requires `status: "approved"` and
   a role of `admin` or `operations`.
3. Reads `reservationContracts/{reservationId}` and requires
   `status: "approved"`, then loads the frozen snapshot at
   `versions/v{approvedVersion}`.
4. Renders the agreement from that snapshot and sends it to
   the email address stored on the customer.
5. Writes an append-only receipt to
   `reservationContracts/{reservationId}/deliveries/{id}`
   recording the send time, the provider's message ID, the
   recipient, the contract version and who sent it.

The request body carries one field, `reservationId`. Nothing
else the browser sends is used: the recipient address, the
customer identity and every monetary figure come from
Firestore. A tampered request cannot change what is sent or
where it goes.

Firestore is read and written **as the employee**, using the
same ID token, so the security rules in `firestore.rules`
apply here exactly as they do in the browser. There is no
service account key to deploy, rotate or leak.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `FIREBASE_PROJECT_ID` | yes | Project whose Firestore holds the contracts. |
| `FIREBASE_API_KEY` | yes | The Firebase **web** API key. Public by design; used only to verify ID tokens. |
| `RESEND_API_KEY` | yes | Resend credential. Private — this is why the endpoint exists. |
| `CONTRACT_FROM_EMAIL` | yes | Verified sender, e.g. `Advance Auto Rental & Repairs <contracts@yourdomain.com>`. |
| `CONTRACT_REPLY_TO` | no | Reply address shown to the customer. |
| `CONTRACT_MAILER_ALLOWED_ORIGINS` | yes | Comma-separated browser origins allowed to call this endpoint, e.g. `https://your-project.web.app`. |
| `FIRESTORE_BASE_URL` | no | Override, for pointing the tests at the emulator. |
| `IDENTITY_BASE_URL` | no | Override, for pointing the tests at the emulator. |
| `RESEND_BASE_URL` | no | Override, for pointing the tests at a stub provider. |

The sending domain has to be verified in Resend first, or
every send comes back as a recorded failure.

## Deploying

The handler is a plain `Request` in, `Response` out function,
which is what Vercel, Netlify, Cloudflare Workers and Deno
Deploy all hand a function. Only `api/send-contract.ts` is
platform-specific.

For Vercel:

```bash
cd services/contract-mailer
vercel deploy --prod
```

Set the variables above on the project, then point the web
application at the deployed URL:

```
NEXT_PUBLIC_CONTRACT_MAILER_URL=https://<deployment>/api/send-contract
```

Two things have to line up or the browser call fails before
it leaves the page:

- `CONTRACT_MAILER_ALLOWED_ORIGINS` must contain the hosting
  origin, or the browser blocks the response on CORS.
- The `connect-src` directive in `firebase.json` must include
  the mailer origin, or the Content-Security-Policy blocks
  the request.

Leave `NEXT_PUBLIC_CONTRACT_MAILER_URL` unset and the feature
stays switched off: the agreement screen says email delivery
is not configured and offers print and save-as-PDF instead.

## Tests

`tests/rules/contract-mailer.test.ts` exercises the whole
path against the Firebase emulators with a stub provider: a
real token, real rules, real REST reads and writes. Run it
with `pnpm test:rules`. The rendering and configuration are
covered by `tests/unit/contract-mailer.test.ts`.
