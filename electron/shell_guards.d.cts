// Type declarations for the CommonJS shell-guard helpers (electron/shell_guards.cjs),
// which electron/main.cjs consumes at runtime and tests/electron_shell_guards.test.ts
// exercises directly. main.cjs itself runs outside tsc; these types serve the test.

export function deriveOrigin(urlString: string): string | null;
export function originAllowed(urlString: string, allowedOrigins: Iterable<string>): boolean;
export function appNavigationOrigins(
  appOrigin: string,
  devServerUrl: string | undefined,
): Set<string>;
export function navigationAllowed(
  url: string,
  isMainFrame: boolean,
  mainFrameOrigins: Iterable<string>,
  subframeOrigins?: Iterable<string>,
): boolean;
export const EMBEDDED_SUBFRAME_ORIGINS: Set<string>;
