"use client";

import {
  getApps,
  getApp,
  initializeApp,
  type FirebaseApp,
} from "firebase/app";

import {
  connectAuthEmulator,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
  type Auth,
} from "firebase/auth";

import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from "firebase/firestore";

import {
  connectStorageEmulator,
  getStorage,
  type FirebaseStorage,
} from "firebase/storage";

import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from "firebase/app-check";

import { firebaseEnvironment } from "./config";

export interface FirebaseClient {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  storage: FirebaseStorage;
  appCheck?: AppCheck;
}

let client:
  | FirebaseClient
  | undefined;

let emulatorsConnected = false;

let appCheckInitialized = false;

/*
 * The signed-in session is kept in localStorage first.
 *
 * Firebase's default store, IndexedDB, closes itself whenever the
 * page is hidden and refuses to reopen until it is visible again.
 * On an iPad or a phone "Continue with Google" opens Google in a
 * new tab, which hides this one, so when Google handed the session
 * back it could not be saved and sign-in failed with "Database is
 * closing/hidden". localStorage has no such state.
 *
 * IndexedDB stays second in the list: a session already stored
 * there is found and moved across, so nobody signed in today has
 * to sign in again.
 */
function browserAuth(app: FirebaseApp): Auth {
  try {
    return initializeAuth(app, {
      persistence: [
        browserLocalPersistence,
        indexedDBLocalPersistence,
      ],
      popupRedirectResolver:
        browserPopupRedirectResolver,
    });
  } catch {
    /* Already set up, e.g. after a hot reload in development. */
    return getAuth(app);
  }
}

export function getFirebaseClient(): FirebaseClient {
  if (client) {
    return client;
  }

  const environment =
    firebaseEnvironment();

  if (!environment) {
    throw new Error(
      "Firebase is not configured. Set the required NEXT_PUBLIC_FIREBASE_* values.",
    );
  }

  const app =
    getApps().length
      ? getApp()
      : initializeApp(
          environment,
        );

  const auth =
    typeof window === "undefined"
      ? getAuth(app)
      : browserAuth(app);

  const db =
    getFirestore(app);

  const storage =
    getStorage(app);

  let appCheck:
    | AppCheck
    | undefined;

  if (
    !environment.useEmulators &&
    environment.appCheckSiteKey &&
    typeof window !==
      "undefined" &&
    !appCheckInitialized
  ) {
    appCheck =
      initializeAppCheck(
        app,
        {
          provider:
            new ReCaptchaEnterpriseProvider(
              environment.appCheckSiteKey,
            ),

          isTokenAutoRefreshEnabled:
            true,
        },
      );

    appCheckInitialized =
      true;
  }

  if (
    environment.useEmulators &&
    typeof window !==
      "undefined" &&
    !emulatorsConnected
  ) {
    connectAuthEmulator(
      auth,
      "http://127.0.0.1:9099",
      {
        disableWarnings:
          true,
      },
    );

    connectFirestoreEmulator(
      db,
      "127.0.0.1",
      8080,
    );

    connectStorageEmulator(
      storage,
      "127.0.0.1",
      9199,
    );

    emulatorsConnected =
      true;
  }

  client = {
    app,
    auth,
    db,
    storage,
    ...(appCheck
      ? {
          appCheck,
        }
      : {}),
  };

  return client;
}