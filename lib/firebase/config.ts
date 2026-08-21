export interface FirebaseEnvironment {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  functionsRegion: string;
  appCheckSiteKey?: string;
  useEmulators: boolean;
}

export function firebaseEnvironment(): FirebaseEnvironment | null {
  const required = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
  if (Object.values(required).some((value) => !value)) return null;
  return {
    ...required as Omit<FirebaseEnvironment, "functionsRegion" | "appCheckSiteKey" | "useEmulators">,
    functionsRegion: process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION || "us-central1",
    appCheckSiteKey: process.env.NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY,
    useEmulators: process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true",
  };
}
