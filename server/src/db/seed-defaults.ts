import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { pool, withTransaction } from '../db.js';
import { seedDatabase, type SeedInput, type SeedResult } from './seed.js';

export const defaultSeed: SeedInput = {
  approved: true,
  branches: [
    { code: 'MAIN', name: 'Main Branch' },
  ],
  users: [],
  loanProducts: [
    { code: 'STARTER', name: 'Starter Loan', currency: 'UGX', active: true },
    { code: 'WORKING_CAPITAL', name: 'Working Capital Loan', currency: 'UGX', active: true },
    { code: 'EMERGENCY', name: 'Emergency Loan', currency: 'UGX', active: true },
  ],
};

export async function runDefaultSeed(): Promise<SeedResult> {
  // Do not pass ADMIN_FIREBASE_UID here: this command owns operational defaults,
  // while the separate admin seed owns Firebase-to-database user mapping.
  return seedDatabase(defaultSeed, withTransaction, undefined);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runDefaultSeed()
    .then((result) => console.log(`Seeded ${result.branches} branches, ${result.users} users, and ${result.loanProducts} loan products.`))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'DEFAULT_SEED_FAILED');
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}