import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

/**
 * A minimal OIDC provider for tests: discovery, JWKS, and a /token endpoint that
 * mints a signed ID token for the currently-configured user. Enough for
 * openid-client's authorization-code grant to succeed end-to-end over http.
 */
export interface MockUser {
  sub: string;
  email?: string;
  name?: string;
}

export interface MockOidc {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Set the identity the next /token call will mint an ID token for. */
  setUser(u: MockUser): void;
  close(): Promise<void>;
}

export interface MockOidcOptions {
  /** Advertise an end_session_endpoint (Auth0/Entra-like). Default false (Google-like). */
  endSession?: boolean;
}

export async function startMockOidc(
  clientId = 'test-client',
  clientSecret = 'test-secret',
  opts: MockOidcOptions = {}
): Promise<MockOidc> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  let user: MockUser = { sub: 'user-1', email: 'a@example.com', name: 'User A' };
  let issuer = '';

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', issuer || `http://${req.headers.host}`);
      const json = (body: unknown) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(body));
      };
      switch (url.pathname) {
        case '/.well-known/openid-configuration':
          return json({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            jwks_uri: `${issuer}/jwks`,
            userinfo_endpoint: `${issuer}/userinfo`,
            response_types_supported: ['code'],
            subject_types_supported: ['public'],
            id_token_signing_alg_values_supported: ['RS256'],
            code_challenge_methods_supported: ['S256'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
            ...(opts.endSession ? { end_session_endpoint: `${issuer}/logout` } : {}),
          });
        case '/jwks':
          return json({ keys: [jwk] });
        case '/token': {
          const idToken = await new SignJWT({ email: user.email, name: user.name })
            .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
            .setIssuer(issuer)
            .setSubject(user.sub)
            .setAudience(clientId)
            .setIssuedAt()
            .setExpirationTime('5m')
            .sign(privateKey);
          return json({
            access_token: 'mock-access-token',
            id_token: idToken,
            token_type: 'bearer',
            expires_in: 300,
          });
        }
        case '/userinfo':
          return json({ sub: user.sub, email: user.email, name: user.name });
        default:
          res.statusCode = 404;
          res.end('not found');
      }
    })().catch((err) => {
      res.statusCode = 500;
      res.end(String(err));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    issuer,
    clientId,
    clientSecret,
    setUser(u) {
      user = u;
    },
    close: () =>
      new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
