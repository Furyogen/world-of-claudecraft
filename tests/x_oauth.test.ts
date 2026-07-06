import { describe, expect, it } from 'vitest';
import {
  basicAuthHeader,
  buildAuthorizeUrl,
  buildTokenRequestBody,
  isXLinkMode,
  isXUserId,
  parseTokenResponse,
  parseXUser,
  pkceChallengeFromVerifier,
  xDisplayName,
  xProfileUrl,
} from '../server/x_oauth';

describe('x oauth pkce', () => {
  it('matches the RFC 7636 S256 test vector', () => {
    expect(pkceChallengeFromVerifier('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});

describe('x authorize url', () => {
  it('encodes the X authorization-code request', () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: 'client',
        redirectUri: 'https://worldofclaudecraft.com/api/auth/x/callback',
        state: 'nonce',
        codeChallenge: 'challenge',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://x.com/i/oauth2/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('client');
    expect(url.searchParams.get('scope')).toBe('users.read');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });
});

describe('x token request', () => {
  it('uses confidential-client basic auth and a PKCE form body', () => {
    expect(basicAuthHeader('Aladdin', 'open sesame')).toBe(
      `Basic ${Buffer.from('Aladdin:open%20sesame').toString('base64')}`,
    );
    const body = new URLSearchParams(
      buildTokenRequestBody({
        code: 'code',
        redirectUri: 'https://x/cb',
        codeVerifier: 'verifier',
      }),
    );
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('code');
    expect(body.get('redirect_uri')).toBe('https://x/cb');
    expect(body.get('code_verifier')).toBe('verifier');
    expect(body.get('client_secret')).toBeNull();
  });
});

describe('x parsers', () => {
  it('parses tokens and authenticated user profiles', () => {
    expect(
      parseTokenResponse({
        access_token: 'tok',
        token_type: 'bearer',
        scope: 'users.read',
        expires_in: 7200,
      }),
    ).toEqual({ accessToken: 'tok', tokenType: 'bearer', scope: 'users.read', expiresIn: 7200 });
    expect(parseTokenResponse({ error: 'invalid_grant' })).toBeNull();

    expect(
      parseXUser({
        data: {
          id: '2244994945',
          username: 'TwitterDev',
          name: 'X Dev',
          profile_image_url: 'https://pbs.twimg.com/profile_images/a.jpg',
          verified: true,
          verified_type: 'blue',
        },
      }),
    ).toEqual({
      id: '2244994945',
      username: 'TwitterDev',
      name: 'X Dev',
      profileImageUrl: 'https://pbs.twimg.com/profile_images/a.jpg',
      verified: true,
      verifiedType: 'blue',
    });
    expect(parseXUser({ data: { id: 'bad', username: 'x' } })).toBeNull();
    expect(parseXUser({ data: { id: '2244994945' } })).toBeNull();
  });

  it('formats display names and profile urls defensively', () => {
    expect(xDisplayName({ name: 'Display', username: 'handle' })).toBe('Display');
    expect(xDisplayName({ name: '  ', username: 'handle' })).toBe('handle');
    expect(xProfileUrl('TwitterDev')).toBe('https://x.com/TwitterDev');
    expect(xProfileUrl('not/a/handle')).toBeNull();
  });
});

describe('x guards', () => {
  it('validates ids and link modes', () => {
    expect(isXUserId('2244994945')).toBe(true);
    expect(isXUserId('not-id')).toBe(false);
    expect(isXLinkMode('login')).toBe(false);
    expect(isXLinkMode('link')).toBe(true);
    expect(isXLinkMode('other')).toBe(false);
  });
});
