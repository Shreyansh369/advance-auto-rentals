import { readEnv } from "../src/env";
import { handleSendContract } from "../src/handler";

/*
 * Deployment entry point.
 *
 * The handler itself is a plain `Request` in, `Response` out
 * function, which is what Vercel, Netlify, Cloudflare Workers
 * and Deno Deploy all hand a function. Only this file is
 * platform-specific; moving providers means replacing it.
 */
export default async function handler(
  request: Request,
): Promise<Response> {
  return handleSendContract(
    request,
    readEnv(
      process.env as Record<
        string,
        string | undefined
      >,
    ),
  );
}
