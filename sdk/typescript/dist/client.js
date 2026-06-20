// Stable, hand-maintained facade over the generated client.
//
// External consumers code against `createAmaClient(...).<resource>.<verb>(...)`.
// Each method is a thin delegation to a function in ./generated (produced by
// @hey-api/openapi-ts). The generated layer may be re-shaped — or the generator
// swapped entirely — without changing this public surface: only the one-line
// bodies here move. This is the contract consumers depend on, not sdk.gen.ts.
//
// Adding an operation is a one-liner; see the patterns below.
import { createClient, createConfig } from './generated/client/index.js';
import * as ops from './generated/sdk.gen.js';
/** Thrown on any non-2xx response. `status` lets callers branch on 404/409/etc. */
export class AmaApiError extends Error {
    status;
    responseText;
    body;
    constructor(status, responseText, body) {
        super(`AMA API request failed${status === undefined ? '' : ` with HTTP ${status}`}`);
        this.status = status;
        this.responseText = responseText;
        this.body = body;
        this.name = 'AmaApiError';
    }
}
// The generated functions resolve to { data, error, response } where `data` is
// `T | undefined` across the success/error union. Typing the param as
// `T | undefined` makes inference recover the bare success type `T`.
async function unwrap(call) {
    const { data, error, response } = await call;
    if (response?.ok && error === undefined) {
        return data;
    }
    const body = error ?? data;
    throw new AmaApiError(response?.status, typeof body === 'string' ? body : JSON.stringify(body ?? {}), body);
}
export function createAmaClient(config) {
    const client = createClient(createConfig({
        baseUrl: config.baseUrl,
        headers: {
            ...(config.accessToken ? { authorization: `Bearer ${config.accessToken}` } : {}),
            ...(config.projectId ? { 'x-ama-project-id': config.projectId } : {}),
            ...config.headers,
        },
    }));
    return {
        /** Escape hatch: the raw generated client for operations not yet on the facade. */
        raw: client,
        agents: {
            create: (body) => unwrap(ops.createAgent({ client, body })),
            get: (agentId) => unwrap(ops.readAgent({ client, path: { agentId } })),
            update: (agentId, body) => unwrap(ops.updateAgent({ client, path: { agentId }, body })),
            list: (query) => unwrap(ops.listAgents({ client, query })),
        },
        environments: {
            create: (body) => unwrap(ops.createEnvironment({ client, body })),
            get: (environmentId) => unwrap(ops.readEnvironment({ client, path: { environmentId } })),
            update: (environmentId, body) => unwrap(ops.updateEnvironment({ client, path: { environmentId }, body })),
            list: (query) => unwrap(ops.listEnvironments({ client, query })),
        },
        projects: {
            create: (body) => unwrap(ops.createProject({ client, body })),
            get: (projectId) => unwrap(ops.readProject({ client, path: { projectId } })),
        },
        sessions: {
            create: (body) => unwrap(ops.createSession({ client, body })),
            get: (sessionId) => unwrap(ops.readSession({ client, path: { sessionId } })),
            update: (sessionId, body) => unwrap(ops.updateSession({ client, path: { sessionId }, body })),
            list: (query) => unwrap(ops.listSessions({ client, query })),
            listEvents: (sessionId, query) => unwrap(ops.listSessionEvents({ client, path: { sessionId }, query })),
            createMessage: (sessionId, body) => unwrap(ops.createSessionMessage({ client, path: { sessionId }, body })),
        },
        vaults: {
            create: (body) => unwrap(ops.createVault({ client, body })),
            createCredential: (vaultId, body) => unwrap(ops.createVaultCredential({ client, path: { vaultId }, body })),
            updateCredential: (vaultId, credentialId, body) => unwrap(ops.updateVaultCredential({ client, path: { vaultId, credentialId }, body })),
        },
        triggers: {
            create: (body) => unwrap(ops.createTrigger({ client, body })),
            get: (triggerId) => unwrap(ops.readTrigger({ client, path: { triggerId } })),
            update: (triggerId, body) => unwrap(ops.updateTrigger({ client, path: { triggerId }, body })),
            delete: (triggerId) => unwrap(ops.deleteTrigger({ client, path: { triggerId } })),
            listRuns: (triggerId, query) => unwrap(ops.listTriggerRuns({ client, path: { triggerId }, query })),
        },
        runners: {
            list: (query) => unwrap(ops.listRunners({ client, query })),
        },
        usage: {
            listRecords: (query) => unwrap(ops.listUsageRecords({ client, query })),
            summary: (query) => unwrap(ops.readUsageSummary({ client, query })),
        },
        models: {
            list: (query) => unwrap(ops.listModels({ client, query })),
        },
        federatedTenants: {
            create: (body) => unwrap(ops.createFederatedTenant({ client, body })),
        },
    };
}
