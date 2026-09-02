import admin from 'firebase-admin';
import type { TokenVerifier } from '../middleware/auth.js';
import { getFirebaseAuthMode, getFirebasePrivateKey, isProductionRuntime } from '../config.js';

export type FirebaseMode = 'live' | 'mock';
export function getFirebaseMode(): FirebaseMode { return getFirebaseAuthMode() === 'mock' ? 'mock' : 'live'; }
function requireLiveCredentials(): { projectId: string; clientEmail: string; privateKey: string } {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim() ?? ''; const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim() ?? ''; const privateKey = getFirebasePrivateKey();
  if (!projectId || !clientEmail || !privateKey) throw new Error('FIREBASE_ADMIN_CREDENTIALS_NOT_CONFIGURED');
  return { projectId, clientEmail, privateKey };
}
function getFirebaseApp(): admin.app.App {
  if (admin.apps.length > 0) return admin.app();
  const credentials = requireLiveCredentials(); return admin.initializeApp({ credential: admin.credential.cert(credentials) });
}

export function createConfiguredTokenVerifier(): TokenVerifier {
  const mode = getFirebaseMode();
  if (mode === 'mock') {
    if (isProductionRuntime()) throw new Error('MOCK_FIREBASE_FORBIDDEN_IN_PRODUCTION');
    return async (token) => { const [prefix, uid, role, branchId = ''] = token.split(':'); if (prefix !== 'mock' || !uid || !role) throw new Error('INVALID_MOCK_TOKEN'); return { uid, role, branchId } as never; };
  }
  return async (token) => getFirebaseApp().auth().verifyIdToken(token, true);
}

export function isFirebaseLive(): boolean { return getFirebaseMode() === 'live' && Boolean(process.env.FIREBASE_PROJECT_ID?.trim() && process.env.FIREBASE_CLIENT_EMAIL?.trim() && getFirebasePrivateKey().trim()); }
