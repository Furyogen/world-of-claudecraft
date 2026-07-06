// Client-side X link state for the account portal, Community panel, and in-game
// link prompt. This is external account state fetched over REST by main.ts, not
// deterministic world state.

export interface XAccountStatus {
  enabled: boolean;
  linked: boolean;
  promptHidden: boolean;
  passwordSet: boolean;
  username: string | null;
  displayName: string | null;
  avatar: string | null;
  verified: boolean;
  verifiedType: string | null;
  profileUrl: string | null;
}

const DISABLED: XAccountStatus = {
  enabled: false,
  linked: false,
  promptHidden: false,
  passwordSet: true,
  username: null,
  displayName: null,
  avatar: null,
  verified: false,
  verifiedType: null,
  profileUrl: null,
};

let status: XAccountStatus = DISABLED;
let listener: (() => void) | null = null;

export function xStatus(): XAccountStatus {
  return status;
}

export function setXStatus(value: XAccountStatus | null): void {
  status = value ?? DISABLED;
  listener?.();
}

export function resetXStatus(): void {
  status = DISABLED;
  listener?.();
}

export function onXStatusChange(cb: () => void): void {
  listener = cb;
}
