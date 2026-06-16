// Pure provider catalog value sets. Zero outward imports — directly
// unit-testable. (BYOK provider-type/credential/baseUrl rules were removed with
// the per-tenant provider model; providers are now global model vendors.)

export const MODEL_AVAILABILITY = ['available', 'unavailable', 'disabled'] as const
export type ModelAvailability = (typeof MODEL_AVAILABILITY)[number]

// The model catalog's operational state per vendor: 'ready' once a discovery
// refresh has populated it, 'error' when the last refresh failed.
export const MODEL_CATALOG_STATES = ['ready', 'error'] as const
export type ModelCatalogState = (typeof MODEL_CATALOG_STATES)[number]
