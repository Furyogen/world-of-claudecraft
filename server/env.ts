export function loadServerEnv(opts: { includeTest?: boolean } = {}): void {
  if (!opts.includeTest && (process.env.NODE_ENV === 'test' || process.env.VITEST)) return;
  try {
    process.loadEnvFile?.();
  } catch {
    // .env is optional; production usually injects environment variables directly.
  }
  try {
    // Local-dev convenience: also load .env.local so the server can reuse the
    // client's VITE_* values for server-side reads. Existing keys are not overwritten.
    process.loadEnvFile?.('.env.local');
  } catch {
    // .env.local is optional.
  }
}

loadServerEnv();
