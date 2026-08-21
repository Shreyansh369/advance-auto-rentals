"use client";

import { initializeApp, getApps } from "firebase/app";
import { getAuth, connectAuthEmulator, type Auth } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, type Firestore } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator, type Functions } from "firebase/functions";
import { getStorage, connectStorageEmulator, type FirebaseStorage } from "firebase/storage";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { firebaseEnvironment } from "./config";

export interface FirebaseClient { auth: Auth; db: Firestore; functions: Functions; storage: FirebaseStorage; }
let client: FirebaseClient | undefined;

export function getFirebaseClient(): FirebaseClient {
  if (client) return client;
  const environment = firebaseEnvironment();
  if (!environment) throw new Error("Firebase is not configured. Set the required NEXT_PUBLIC_FIREBASE_* values.");
  const app = getApps()[0] ?? initializeApp(environment);
  if (!environment.useEmulators && environment.appCheckSiteKey && typeof window !== "undefined") {
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(environment.appCheckSiteKey), isTokenAutoRefreshEnabled: true });
  }
  const auth = getAuth(app);
  const db = getFirestore(app);
  const functions = getFunctions(app, environment.functionsRegion);
  const storage = getStorage(app);

  if (environment.useEmulators && typeof window !== "undefined") {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
    connectStorageEmulator(storage, "127.0.0.1", 9199);
  }
  client = { auth, db, functions, storage };
  return client;
}
