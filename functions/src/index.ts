import { onRequest } from 'firebase-functions/v2/https';
import { buildApp } from '../../server/src/app.js';
import { createConfiguredTokenVerifier } from '../../server/src/config/firebaseAdmin.js';
import { resolveDatabaseUser } from '../../server/src/middleware/auth.js';

const app = buildApp({
  tokenVerifier: createConfiguredTokenVerifier(),
  userResolver: resolveDatabaseUser,
  serveStatic: false,
});
const appReady = app.ready();

export const api = onRequest({
  secrets: [
    'DATABASE_URL',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY',
    'SESSION_SECRET',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'FLUTTERWAVE_SECRET_HASH',
  ],
}, async (request, response) => {
  await appReady;
  app.server.emit('request', request, response);
});