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
function createSessionStream(config, sessionId) {
    const url = new URL(`/api/v1/sessions/${sessionId}/socket`, config.baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    // Browsers can't set an Authorization header on a WebSocket; AMA's auth wall
    // also accepts the token as an access_token query param, so use that.
    if (config.accessToken) {
        url.searchParams.set('access_token', config.accessToken);
    }
    const socket = new WebSocket(url.toString());
    const buffered = [];
    const waiters = [];
    const backfillWaiters = new Map();
    let done = false;
    const drainDone = () => {
        done = true;
        for (const resolve of waiters.splice(0)) {
            resolve({ value: undefined, done: true });
        }
    };
    socket.addEventListener('message', (event) => {
        const frame = JSON.parse(typeof event.data === 'string' ? event.data : '');
        if (frame.type === 'event') {
            const waiter = waiters.shift();
            if (waiter) {
                waiter({ value: frame.event, done: false });
            }
            else {
                buffered.push(frame.event);
            }
        }
        else if (frame.type === 'backfill') {
            const resolve = frame.requestId ? backfillWaiters.get(frame.requestId) : undefined;
            if (frame.requestId) {
                backfillWaiters.delete(frame.requestId);
            }
            resolve?.(frame);
        }
    });
    socket.addEventListener('close', drainDone);
    const ready = new Promise((resolve, reject) => {
        socket.addEventListener('open', () => resolve());
        socket.addEventListener('error', () => reject(new Error('Session socket failed to open')));
    });
    let backfillSeq = 0;
    return {
        events: {
            [Symbol.asyncIterator]() {
                return {
                    next() {
                        const value = buffered.shift();
                        if (value !== undefined) {
                            return Promise.resolve({ value, done: false });
                        }
                        if (done) {
                            return Promise.resolve({ value: undefined, done: true });
                        }
                        return new Promise((resolve) => waiters.push(resolve));
                    },
                };
            },
        },
        async send(frame) {
            await ready;
            socket.send(JSON.stringify(frame));
        },
        async backfill(options = {}) {
            await ready;
            const requestId = `bf_${(backfillSeq += 1)}`;
            const response = new Promise((resolve) => backfillWaiters.set(requestId, resolve));
            socket.send(JSON.stringify({ type: 'backfill', requestId, ...options }));
            return response;
        },
        close() {
            socket.close();
        },
    };
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
            connection: (sessionId) => unwrap(ops.readSessionConnection({ client, path: { sessionId } })),
            /** Open the live session WebSocket: pushed events + backfill replay + typed input frames. */
            stream: (sessionId) => createSessionStream(config, sessionId),
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
