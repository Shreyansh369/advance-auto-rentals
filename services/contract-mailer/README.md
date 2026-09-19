# Contract mailer

Sends an approved rental agreement to the customer by email,
and tells the administrators when a staff account is waiting
for approval.

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
| `STAFF_NOTIFICATION_EMAILS` | for staff notices | Comma-separated administrator addresses told about a new staff access request. Fixed here, never taken from the request. |
| `APP_BASE_URL` | no | Origin of the deployed workspace, e.g. `https://your-project.web.app`, used to link an administrator straight to the Staff screen. |
| `CONTRACT_MAILER_ALLOWED_ORIGINS` | yes | Comma-separated browser origins allowed to call this endpoint, e.g. `https://your-project.web.app`. |
| `FIRESTORE_BASE_URL` | no | Override, for pointing the tests at the emulator. |
| `IDENTITY_BASE_URL` | no | Override, for pointing the tests at the emulator. |
| `RESEND_BASE_URL` | no | Override, for pointing the tests at a stub provider. |

## Before this can send anything: the domain

Resend's free tier covers 3,000 emails a month and 100 a day,
which is far more than this business sends. The cost is not
the obstacle. **The domain is.**

Resend will only deliver to arbitrary recipients from a domain
you have verified with DNS records. Until then an account can
only send to its own address, so a customer never receives
anything.

A Gmail address cannot be verified: `gmail.com` is not yours,
and no provider will let you send as it — Google's own
anti-spoofing rules are what stop it. So
`advanceautobvi@gmail.com` cannot be the sending address here,
whatever provider is chosen.

This endpoint is therefore worth switching on **only once the
business owns a domain** (`advanceautobvi.com`, say) and has
verified it in Resend. `CONTRACT_FROM_EMAIL` then becomes
something like
`Advance Auto Rental & Repairs <contracts@advanceautobvi.com>`
and `CONTRACT_REPLY_TO` can still point at the Gmail address
so replies land where the office already reads them.

Until then, the agreement screen sends through the office's
own Gmail account instead — see **Sending without a domain**
below. Nothing needs to be deployed for that to work.

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
NEXT_PUBLIC_STAFF_MAILER_URL=https://<deployment>/api/notify-staff
```

Two things have to line up or the browser call fails before
it leaves the page:

- `CONTRACT_MAILER_ALLOWED_ORIGINS` must contain the hosting
  origin, or the browser blocks the response on CORS.
- The `connect-src` directive in `firebase.json` must include
  the mailer origin, or the Content-Security-Policy blocks
  the request.

Leave `NEXT_PUBLIC_CONTRACT_MAILER_URL` unset and the feature
stays switched off: the agreement screen sends through the
office's own mail account instead.

## Sending without a domain

This is what the application does today, and it needs no
provider, no domain, no deployment and no money.

On an approved agreement the screen offers:

- **Send with Gmail** — opens Gmail's compose window with the
  customer's address, the subject and the filled-in agreement
  already written. On a phone the Gmail app takes the link
  over. The operator attaches the saved PDF and presses send.
- **Send from my mail app** — the same message, handed to
  whatever mail client is installed.
- **Copy agreement** — the same text on the clipboard, for
  WhatsApp or anything else.

Because the message is sent from the office's own account, it
arrives from the address the renter would reply to, and there
is no deliverability question at all.

The clauses are deliberately not in the body: fourteen of them
do not fit in a compose URL, and the copy the renter signs is
the printed one, which the operator attaches. `Print` on the
same screen saves it as a PDF.

## Staff access notifications

`api/notify-staff.ts` is the second route on the same
deployment. It exists because an account that registers sits
at `status: "pending"` until an administrator approves it, and
an administrator cannot approve what nobody told them about.

It takes one field, `action`:

- `access_requested` — sent by the applicant's own browser
  right after registration. The endpoint reads
  `users/{uid}`, requires `status: "pending"`, and mails the
  addresses in `STAFF_NOTIFICATION_EMAILS`. The recipients
  come from the deployment, never from the request: an
  applicant can ask for access, not choose who hears about
  it. A receipt at `staffAccessRequests/{uid}` makes this
  once per account, so a retry loop cannot become a stream of
  mail to the office. An administrator deletes that receipt
  to let an account announce itself again.
- `decision` — sent by an administrator's browser after
  approving or declining. The caller must be an approved
  administrator, and the message goes to the address on the
  reviewed profile.

Neither call is allowed to fail the thing it reports on.
Registration completes and approval takes effect whether or
not the mail goes out, and the Staff screen says so when the
notifier is not configured.

**This route works without a verified domain**, as long as
the address in `STAFF_NOTIFICATION_EMAILS` is the one the
Resend account was opened with — providers let you mail
yourself before you have proved a domain. The contract route
does not, because it writes to customers. So the staff
notifications can be switched on today and the contract send
switched on when the domain is ready.

Leave `NEXT_PUBLIC_STAFF_MAILER_URL` unset and nothing
breaks: new registrations still appear on the Staff screen,
they just arrive silently.

## Tests

`tests/rules/contract-mailer.test.ts` exercises the whole
path against the Firebase emulators with a stub provider: a
real token, real rules, real REST reads and writes. Run it
with `pnpm test:rules`.

`tests/unit/contract-mailer-handler.test.ts` runs the whole
endpoint with the identity toolkit, Firestore and the provider
stubbed, and asserts what actually reaches the provider: the
recipient, the subject, the filled-in form and all fourteen
clauses, plus the receipt written for a success and for a
refusal.

`tests/unit/contract-mailer.test.ts` covers the rendering and
the configuration, and compares this directory's copy of the
agreement wording against `lib/agreement.ts` — the two are not
allowed to drift.

`tests/unit/contract-message.test.ts` covers the Gmail and
mail-app messages the browser builds.

`tests/unit/staff-notification-handler.test.ts` runs the
staff route the same way: who may call it, what is sent, that
the recipients cannot be steered from the request, and that a
second announcement does not reach the provider.
