# Render API + Firebase Hosting Deployment

This project has one production API: the standalone Fastify service on Render.
Firebase is used for Authentication and static Hosting. Supabase PostgreSQL is
the authoritative database.

## 1. Commit and push from a clean branch

Run the checks locally:

```bash
npm run build
npm run lint
npm test
npm run db:check
```

Review the files before committing. Keep credentials, `.env` files, approved
seed files, and user-provided attachments out of the commit:

```bash
git status --short
git add .env.example firebase.json package.json package-lock.json render.yaml client server shared tests docs
git commit -m "prepare Render and Firebase deployment"
git push origin main
```

The push must authenticate through the repository’s configured GitHub
credential or GitHub App. Do not put a personal access token in a remote URL or
in source files, and do not force-push.

## 2. Create the Render Web Service

In Render, create a Web Service from the repository and deploy the `main`
branch. The checked-in `render.yaml` expresses the service defaults:

- Build command: `npm ci && npm run build:server`
- Start command: `npm run start`
- Health check: `/health`
- Runtime: Node.js

Render supplies `PORT`; the server binds to that value and uses `0.0.0.0`.
After the first successful deployment, record the real HTTPS service URL, for
example `https://your-service.onrender.com`. Do not replace that value with a
guess in Git.

### Required Render environment

Set these as Render environment variables or secret values:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `APP_ENV` | `production` |
| `FIREBASE_MODE` | `live` |
| `DATABASE_URL` or `PGURI` | Supabase PostgreSQL TLS connection string |
| `FIREBASE_PROJECT_ID` | Firebase project ID |
| `FIREBASE_CLIENT_EMAIL` | Firebase Admin service-account email |
| `FIREBASE_PRIVATE_KEY` | Firebase Admin private key |
| `CORS_ORIGINS` | Optional comma-separated HTTP/HTTPS origins; blank or `*` uses Firebase Hosting defaults |
| `ADMIN_FIREBASE_UID` | Optional real Firebase Auth UID for initial admin mapping |

`DATABASE_URL` takes precedence when both database variables are present.
Production trims CORS values, removes trailing slashes, accepts valid HTTP/HTTPS
origins, ignores wildcard or invalid list entries, and falls back to the
Firebase Hosting defaults when no usable origin remains. Keep
`FIREBASE_PRIVATE_KEY` and database credentials server-side.

Run the approved seed against the Render/Supabase environment only when the
reviewed seed JSON is available:

```bash
SEED_INPUT_FILE=/secure/path/approved-seed.json \
ADMIN_FIREBASE_UID=<real-firebase-auth-uid> \
npm run db:seed
```

The seed command fails closed without approved input and does not create sample
branches, users, loans, payments, or financial values.

For the approved operational defaults used by the initial pilot, run the
idempotent defaults command. It creates or updates only the `MAIN` branch and
the active UGX `STARTER`, `WORKING_CAPITAL`, and `EMERGENCY` loan products:

```bash
npm run db:seed:defaults
```

## 3. Configure and deploy Firebase Hosting

Build the PWA with public Firebase web configuration and the real Render API
URL:

```bash
export VITE_API_BASE_URL="https://your-service.onrender.com"
export VITE_FIREBASE_MODE="live"
export VITE_FIREBASE_API_KEY="<public-web-api-key>"
export VITE_FIREBASE_AUTH_DOMAIN="<firebase-project>.firebaseapp.com"
export VITE_FIREBASE_PROJECT_ID="<firebase-project>"
export VITE_FIREBASE_STORAGE_BUCKET="<firebase-project>.firebasestorage.app"
export VITE_FIREBASE_MESSAGING_SENDER_ID="<sender-id>"
export VITE_FIREBASE_APP_ID="<web-app-id>"

firebase login
firebase use <firebase-project>
firebase deploy --only hosting
```

`firebase.json` serves `client/dist` and rewrites unknown frontend routes to
`/index.html`. API calls use `VITE_API_BASE_URL`; Firebase Hosting does not
proxy `/api/**` to a retired serverless function.

Add both Firebase Hosting origins to Render’s `CORS_ORIGINS` when applicable:

- `https://<firebase-project>.web.app`
- `https://<firebase-project>.firebaseapp.com`

The browser should then load the PWA from Firebase and call the Render API
over HTTPS. Verify:

```bash
curl -i https://your-service.onrender.com/health
```

The healthy response is HTTP 200 with `data.database` equal to `"up"`. A
database outage must return HTTP 503 with `data.database` equal to `"down"`.

## 4. Post-deployment checks

1. Confirm Render logs show a successful compiled-server start.
2. Confirm `/health` returns 200 and `database: "up"`.
3. Confirm Firebase Hosting serves the PWA shell and manifest.
4. Sign in with a real Firebase Auth account.
5. Confirm the API resolves that Firebase UID to the intended PostgreSQL user
   and role.
6. Confirm branch-scoped read and command routes reject out-of-scope access.
7. Confirm no financial data is created by deployment itself.