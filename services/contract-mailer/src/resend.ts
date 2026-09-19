/*
 * Resend is the only part of this endpoint that needs a
 * private credential, which is exactly why the send happens
 * here rather than in the browser.
 */
export type SendResult =
  | { ok: true; messageId: string }
  | { ok: false; reason: string };

export async function sendEmail(options: {
  baseUrl: string;
  apiKey: string;
  from: string;
  to: string | string[];
  replyTo: string | null;
  subject: string;
  html: string;
  text: string;
  fetchImpl?: typeof fetch;
}): Promise<SendResult> {
  const call = options.fetchImpl ?? fetch;

  let response: Response;

  try {
    response = await call(
      `${options.baseUrl.replace(
        /\/+$/,
        "",
      )}/emails`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: options.from,

          to: Array.isArray(options.to)
            ? options.to
            : [options.to],

          subject: options.subject,
          html: options.html,
          text: options.text,

          ...(options.replyTo
            ? { reply_to: options.replyTo }
            : {}),
        }),
      },
    );
  } catch (cause) {
    return {
      ok: false,
      reason:
        cause instanceof Error
          ? cause.message
          : "The mail provider could not be reached.",
    };
  }

  let body: {
    id?: string;
    message?: string;
    name?: string;
  } = {};

  try {
    body = (await response.json()) as typeof body;
  } catch {
    body = {};
  }

  if (!response.ok || !body.id) {
    return {
      ok: false,
      reason:
        body.message ??
        `The mail provider rejected the message (${response.status}).`,
    };
  }

  return { ok: true, messageId: body.id };
}
