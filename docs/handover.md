# Handover

Moving the application from the developer's accounts to the
client's, so that when it is done the client owns everything
and the developer's accounts can be closed without breaking a
thing.

Three accounts hold state: **Firebase** (the database, the
staff sign-ins and the hosting), **Cloudinary** (every uploaded
photo and licence image), and **Google Cloud** (the same
project as Firebase — it is what signs the Gmail send). There
is no mail provider, no server and no other third party.

Read the whole page before starting. Nothing here deletes
anything from the old accounts, so a step that goes wrong can
be repeated.

---

## 0. Before you start

Take an export of the live data even if you are certain
nothing will go wrong:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/path/to/old-project-key.json \
  pnpm export:firestore -- --out ./handover/firestore
```

Keep that directory. It is the only copy of the database that
is not inside somebody's account.

> The export contains customer names, addresses, licence
> numbers and dates of birth. Keep it encrypted, hand it over
> on something you control, and delete it once the client
> confirms the new system is live.

---

## 1. Cloudinary

**Prefer transferring the account.** Cloudinary lets the owner
email be changed, and doing so moves every image and leaves
every URL already stored in Firestore working untouched. It is
one setting and no migration.

1. In the old account: **Settings → Account**.
2. Change the owner email to the client's.
3. The client confirms the email, sets a new password, and
   removes the developer from **Settings → Users**.
4. `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` and
   `NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET` do not change.

**If the client insists on a fresh account instead**, the
images have to be copied across and the stored URLs rewritten:

1. The client creates a Cloudinary account and notes the cloud
   name.
2. **Settings → Upload → Upload presets → Add** an *unsigned*
   preset. Restrict it, as the old one is restricted: allowed
   formats `jpg, jpeg, png, webp, heic`, a maximum file size
   of 10 MB, and a fixed folder. The preset name ships in the
   browser bundle, so these limits are the only thing binding
   an upload.
3. Dry-run the move, pointing at the **new** Firebase project
   once step 2 below is done:

   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/new-project-key.json \
     pnpm migrate:cloudinary -- \
       --to-cloud <new-cloud-name> \
       --preset <new-unsigned-preset>
   ```

4. Re-run with `--commit`. Each image is fetched from the old
   cloud, uploaded to the new one, and the URL in Firestore
   rewritten. Nothing is deleted from the old account.
5. Open a few customers and rentals in the application and
   confirm the licence images and condition photos still
   render before the old account is closed.

---

## 2. Firebase

### 2.1 Create the project

The client creates a Firebase project on the **Spark** (free)
plan under their own Google account. Nothing here needs Blaze.

- **Firestore Database** → create, in the region closest to
  the BVI (`us-east1` is the usual choice).
- **Authentication** → enable **Email/Password** and
  **Google**. Google is what the Gmail send uses.
- **Hosting** → enable.

### 2.2 Deploy the rules first

Deploy the security rules **before** importing any data, or
the first thing the application does on the new project is
fail with a permission error:

```bash
pnpm exec firebase deploy \
  --project <new-project-id> \
  --only firestore:rules,firestore:indexes
```

### 2.3 Move the staff sign-ins

Firebase's own tooling moves accounts with their password
hashes intact, so nobody has to reset a password:

```bash
pnpm exec firebase auth:export users.json \
  --project <old-project-id>

pnpm exec firebase auth:import users.json \
  --project <new-project-id> \
  --hash-algo=SCRYPT \
  --hash-key <key> \
  --salt-separator <separator> \
  --rounds 8 --mem-cost 14
```

The four hash parameters come from the old project:
**Authentication → Users → ⋮ → Password hash parameters**.
Get them wrong and the accounts import but nobody can sign in,
so copy them exactly.

Account UIDs are preserved, which matters: every rental,
audit entry and contract records the UID of the staff member
who touched it, and a new UID would orphan all of it.

### 2.4 Move the data

```bash
# Dry run first — it writes nothing and reports what it would.
GOOGLE_APPLICATION_CREDENTIALS=/path/to/new-project-key.json \
  pnpm import:firestore -- --in ./handover/firestore

GOOGLE_APPLICATION_CREDENTIALS=/path/to/new-project-key.json \
  pnpm import:firestore -- --in ./handover/firestore --commit
```

The service account key comes from the new project:
**Project settings → Service accounts → Generate new private
key**. It is free on Spark. Delete the key file once the
import is done.

The import refuses to run against a project that already has
customers, rentals or reservations, so it cannot quietly merge
two databases. Documents keep their ids, so a run that fails
part way can simply be repeated.

### 2.5 Point the application at it

Take the web configuration from **Project settings → General →
Your apps → Web app** and set it wherever the site is built:

```
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_USE_FIREBASE_EMULATORS=false
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=
NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET=
```

Every `NEXT_PUBLIC_` value is baked in at build time, so the
site has to be rebuilt, not just redeployed. None of them are
secrets.

Update `.firebaserc` (or pass `--project`) and deploy:

```bash
pnpm build
pnpm exec firebase deploy \
  --project <new-project-id> \
  --only hosting,firestore:rules,firestore:indexes
```

---

## 3. Sending the agreement by Gmail

The agreement is emailed as a PDF from the operator's own
Gmail account. There is no provider and no key, but Google has
to be told the application is allowed to ask.

All of this is in the Google Cloud project that Firebase
created — the same project id.

1. **APIs & Services → Library →** enable the **Gmail API**.
2. **APIs & Services → OAuth consent screen**:
   - User type **External** (a `gmail.com` account cannot use
     Internal; Internal needs Google Workspace).
   - App name, the support email, and the developer email.
   - **Add scope** `https://www.googleapis.com/auth/gmail.send`
     and nothing else. That scope can send mail as the user;
     it cannot read a mailbox or list what is in one.
   - Under **Test users**, add every staff Google account that
     will send agreements.
3. **APIs & Services → Credentials**: Firebase already created
   an OAuth client for Google sign-in. Add the live site's
   origin to its **Authorised JavaScript origins** if it is
   not already there.

### What staff will see

The first time someone presses **Send with Gmail** on a
device, Google asks them to pick an account and grant
permission. Because the consent screen is unverified they see
a warning — *"Google hasn't verified this app"* — and have to
click **Advanced → Go to Advance Auto Rental**. That is
expected for a private business tool. It is asked once per
session, not once per agreement.

To remove the warning entirely, submit the consent screen for
verification (**OAuth consent screen → Publish app**). It
requires a privacy policy on a domain the business owns and
takes Google a few weeks. Not required; the application works
either way.

### If a staff member has no Google account

They can still use **Save PDF** and **Send from my mail app**
and send the agreement themselves. Only the one-click send
needs Google.

---

## 4. Check it actually works

Do all of this on the new project before the old accounts are
touched:

- [ ] Sign in as an administrator and as an operations user.
- [ ] The dashboard lists the vehicles and the rental history
      that were imported.
- [ ] Open a customer: the licence image renders.
- [ ] Open a past rental from **Customers → History**: the
      agreement opens, the vehicle diagrams and any condition
      photos render, and the owner signature line reads
      **Kendell Parsons**.
- [ ] Take a booking, check it out, submit it for review,
      approve it as an administrator.
- [ ] **Save PDF** — the file is the form, filled in.
- [ ] **Send with Gmail** — the renter receives it with the
      PDF attached, and the delivery is listed on the
      agreement screen.
- [ ] Record a payment and confirm it appears in **Finance**.

---

## 5. Closing the old accounts

Only after section 4 is fully ticked, and leave a week or two
between the two:

1. Remove the developer from the client's Firebase project
   (**Project settings → Users and permissions**) and from
   Cloudinary.
2. Delete the exported JSON and any service account keys.
3. Delete the old Firebase project and, if a new Cloudinary
   account was created, the old Cloudinary account.

Deleting a Firebase project is reversible for 30 days. Deleting
Cloudinary assets is not, so keep the old cloud until the
client has been running on the new one long enough to be sure.

---

## What the client owns afterwards

| Thing | Where | Cost |
| --- | --- | --- |
| Database, sign-ins, hosting | Firebase, Spark plan | Free |
| Uploaded images | Cloudinary, free tier | Free |
| Sending agreements | Staff members' own Gmail | Free |
| Source code | This repository | — |

Nothing in the running system bills anyone. The limits worth
knowing: Firestore's free tier is 50,000 reads and 20,000
writes a day, Cloudinary's is 25 GB of storage and monthly
bandwidth, and Gmail sends up to 500 messages a day per
account. A rental desk is nowhere near any of them.
