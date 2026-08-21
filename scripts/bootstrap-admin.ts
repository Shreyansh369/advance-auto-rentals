import process from "node:process";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.error(
    "Usage: pnpm bootstrap:admin -- <email> <password>",
  );
  process.exit(1);
}

if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== "true") {
  throw new Error(
    "Refusing to bootstrap an admin unless NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true.",
  );
}

process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.GCLOUD_PROJECT ??= "demo-advance-auto-rentals";

if (!getApps().length) {
  initializeApp({
    projectId: process.env.GCLOUD_PROJECT,
  });
}

const auth = getAuth();
const db = getFirestore();

let user;

try {
  user = await auth.getUserByEmail(email);
} catch {
  user = await auth.createUser({
    email,
    password,
    emailVerified: true,
    disabled: false,
  });
}

await auth.setCustomUserClaims(user.uid, {
  role: "admin",
});

await db.collection("users").doc(user.uid).set(
  {
    uid: user.uid,
    email,
    role: "admin",
    active: true,
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  },
  { merge: true },
);

console.log("");
console.log("Local admin ready.");
console.log(`Email: ${email}`);
console.log(`UID: ${user.uid}`);
console.log("Role: admin");