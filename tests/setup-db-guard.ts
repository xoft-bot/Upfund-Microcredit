const url = process.env.DATABASE_URL;
if (url && process.env.ALLOW_REMOTE_TEST_DB !== '1') {
  let host = '';
  try { host = new URL(url).hostname; } catch { /* unparseable */ }
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new Error(
      `Refusing to run tests against non-local database host "${host || 'unparseable'}". Set ALLOW_REMOTE_TEST_DB=1 to override.`
    );
  }
}
