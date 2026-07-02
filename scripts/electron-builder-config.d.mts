// Hand-written declarations for scripts/electron-builder-config.mjs so the
// Vitest suite type-checks its imports (same convention as the electron/*.d.cts
// files). Keep in sync with the .mjs exports.

export interface AzureSignOptions {
  publisherName: string;
  endpoint: string;
  codeSigningAccountName: string;
  certificateProfileName: string;
}

export function azureSignOptionsFromEnv(
  env?: Record<string, string | undefined>,
): AzureSignOptions | null;

export function desktopBuilderConfig(input: {
  base: Record<string, unknown>;
  distribution: string;
  mode?: 'pack' | 'build';
  crashSubmitUrl?: string;
  azureSign?: AzureSignOptions | null;
}): Record<string, any>;
