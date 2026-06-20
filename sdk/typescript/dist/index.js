// Public entry point for @any-managed-agents/sdk.
//
// Everything under ./generated is produced by `pnpm run generate`
// (@hey-api/openapi-ts) from sdk/openapi.json — do not edit it by hand.
// This file is the only hand-maintained surface: it re-exports the generated
// typed operations and models, plus the client factory used to target a
// specific origin and authenticate per request.
export * from './generated/index.js';
export { createClient, createConfig, mergeHeaders } from './generated/client/index.js';
