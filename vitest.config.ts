import { defineConfig } from 'vitest/config';

const dbUrl = process.env.DATABASE_URL;
if (dbUrl && (dbUrl.includes('<') || dbUrl.includes('>') || !dbUrl.startsWith('postgres'))) {
  delete process.env.DATABASE_URL;
}

export default defineConfig({
  test: {
    environment: 'node',
  },
});
