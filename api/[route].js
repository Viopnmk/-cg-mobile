/**
 * Vercel entry point for every /api/<route> call (catch-all, one segment).
 *
 * The real adapter lives in adapters/vercel.js; api/brief.js, api/whales.js and
 * api/health.js are explicit re-exports of the same handler, so the two
 * endpoints the phone page actually calls work even if Vercel's dynamic-segment
 * routing ever changes behaviour.
 */

export { default, config } from "../adapters/vercel.js";
