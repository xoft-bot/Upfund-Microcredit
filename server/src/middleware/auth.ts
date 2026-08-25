import type { FastifyReply, FastifyRequest } from 'fastify';
import admin from 'firebase-admin';
import type { Actor, UserRole } from '../../../shared/contracts.js';

const allowedRoles = new Set<UserRole>(['admin', 'manager', 'officer', 'collector', 'accountant']);

function getFirebaseApp(): admin.app.App {
  if (admin.apps.length > 0) return admin.app();
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
  }
  throw new Error('Firebase Admin credentials are not configured');
}

export type TokenVerifier = (token: string) => Promise<admin.auth.DecodedIdToken>;

export function createTokenVerifier(): TokenVerifier {
  return async (token) => getFirebaseApp().auth().verifyIdToken(token, true);
}

export function authMiddleware(verifier: TokenVerifier = createTokenVerifier()) {
  return async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      await reply.code(401).send({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
      return;
    }
    try {
      const decoded = await verifier(header.slice('Bearer '.length));
      const role = decoded.role as UserRole | undefined;
      if (!role || !allowedRoles.has(role)) {
        await reply.code(403).send({ ok: false, error: { code: 'FORBIDDEN', message: 'Role is not authorized' } });
        return;
      }
      request.actor = { userId: String(decoded.uid), firebaseUid: decoded.uid, role, branchId: typeof decoded.branchId === 'string' ? decoded.branchId : null };
    } catch {
      await reply.code(401).send({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Invalid authentication token' } });
    }
  };
}

declare module 'fastify' {
  interface FastifyRequest { actor?: Actor; }
}
