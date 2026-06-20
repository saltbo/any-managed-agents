// Public entry point for @any-managed-agents/sdk.
//
// Prefer the stable facade: `createAmaClient(...).<resource>.<verb>(...)`.
// It is hand-maintained (src/client.ts) and insulates consumers from the
// generated layer — the generator can be re-shaped or swapped without changing
// the facade's call signatures.
//
// Everything under ./generated is produced by `pnpm run generate`
// (@hey-api/openapi-ts) from sdk/openapi.json — do not edit it by hand. The raw
// typed operation functions and models are also re-exported below as an escape
// hatch for operations the facade does not wrap yet.
export { createAmaClient, AmaApiError } from './client.js';
export * from './generated/index.js';
export { createClient, createConfig, mergeHeaders } from './generated/client/index.js';
