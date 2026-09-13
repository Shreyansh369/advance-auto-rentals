/*
 * The caller presents the same Firebase ID token the browser
 * already holds. Rather than carry a JWT library and a copy
 * of Google's signing keys, the token is handed back to the
 * identity toolkit, which validates the signature, audience
 * and expiry and returns the account it belongs to. A forged
 * or expired token gets no account back.
 */
export class AuthenticationError extends Error {}

export async function resolveCaller(options: {
  baseUrl: string;
  apiKey: string;
  idToken: string;
  fetchImpl?: typeof fetch;
}): Promise<{ uid: string; email: string | null }> {
  const call = options.fetchImpl ?? fetch;

  const response = await call(
    `${options.baseUrl.replace(
      /\/+$/,
      "",
    )}/v1/accounts:lookup?key=${encodeURIComponent(
      options.apiKey,
    )}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        idToken: options.idToken,
      }),
    },
  );

  if (!response.ok) {
    throw new AuthenticationError(
      "Your session is no longer valid. Sign in again and retry.",
    );
  }

  const body = (await response.json()) as {
    users?: Array<{
      localId?: string;
      email?: string;
    }>;
  };

  const account = body.users?.[0];

  if (!account?.localId) {
    throw new AuthenticationError(
      "Your session is no longer valid. Sign in again and retry.",
    );
  }

  return {
    uid: account.localId,
    email: account.email?.trim() || null,
  };
}
