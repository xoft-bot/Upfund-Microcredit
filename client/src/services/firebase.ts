import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';

export type FirebaseClientMode = 'live' | 'mock';
export interface FirebaseClientConfig { apiKey: string; authDomain: string; projectId: string; storageBucket: string; messagingSenderId: string; appId: string; }
const config: FirebaseClientConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '',
};

export function getFirebaseClientMode(): FirebaseClientMode { return import.meta.env.VITE_FIREBASE_MODE === 'mock' ? 'mock' : 'live'; }
export function isFirebaseClientConfigured(): boolean { return getFirebaseClientMode() === 'live' && Object.values(config).every(Boolean); }
export function getFirebaseClient(): FirebaseApp | null { if (!isFirebaseClientConfigured()) return null; return getApps().length ? getApp() : initializeApp(config); }
export function getFirebaseClientConfig(): Readonly<FirebaseClientConfig> { return config; }
