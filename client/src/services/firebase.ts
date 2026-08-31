import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, onIdTokenChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import type { UserRole } from '../../../shared/contracts.js';

export type FirebaseClientMode = 'live' | 'mock';
export interface FirebaseClientConfig { apiKey: string; authDomain: string; projectId: string; storageBucket: string; messagingSenderId: string; appId: string; }
export interface AuthIdentity { uid: string; userId?: string; collectorId: string; role: UserRole; branchId: string | null; clientId: string | null; permissions?: string[]; branchName?: string; }
export interface AuthSession { uid: string; email: string | null; displayName: string | null; identity: AuthIdentity | null; }
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

export async function getFirebaseIdToken(): Promise<string | undefined> {
  const app = getFirebaseClient();
  const user = app ? getAuth(app).currentUser : null;
  return user ? user.getIdToken() : undefined;
}

const roles = new Set<UserRole>(['admin', 'manager', 'officer', 'collector', 'accountant', 'client', 'marketing']);

export function identityFromClaims(uid: string, claims: Record<string, unknown>): AuthIdentity | null {
  const role = typeof claims.role === 'string' && roles.has(claims.role as UserRole) ? claims.role as UserRole : undefined;
  if (!uid || !role) return null;
  return {
    uid,
    collectorId: typeof claims.collectorId === 'string' && claims.collectorId ? claims.collectorId : uid,
    role,
    branchId: typeof claims.branchId === 'string' && claims.branchId ? claims.branchId : null,
    clientId: typeof claims.clientId === 'string' && claims.clientId ? claims.clientId : null,
    branchName: typeof claims.branchName === 'string' && claims.branchName ? claims.branchName : undefined,
  };
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const app = getFirebaseClient();
  if (!app) throw new Error('FIREBASE_CLIENT_NOT_CONFIGURED');
  await signInWithEmailAndPassword(getAuth(app), email.trim(), password);
}

export async function signOutFirebase(): Promise<void> {
  const app = getFirebaseClient();
  if (!app) return;
  await signOut(getAuth(app));
}

function sessionFromUser(user: User): AuthSession {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    identity: null,
  };
}

export function subscribeToFirebaseAuth(onChange: (session: AuthSession | null) => void): () => void {
  const app = getFirebaseClient();
  if (!app) { onChange(null); return () => undefined; }
  return onIdTokenChanged(getAuth(app), (user) => {
    if (!user) { onChange(null); return; }
    void user.getIdTokenResult().then((token) => onChange({ ...sessionFromUser(user), identity: identityFromClaims(user.uid, token.claims) })).catch(() => onChange({ ...sessionFromUser(user), identity: null }));
  });
}
