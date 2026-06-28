// Stable facade generated from sdk/spec/resources.json.
// The generated OpenAPI layer owns HTTP shapes; this file owns public SDK shape.
import { createClient, createConfig } from './generated/client/index.js';
import * as ops from './generated/sdk.gen.js';
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
        raw: client,
        system: {
            health: () => unwrap(ops.getHealth({ client })),
        },
        auth: {
            config: (query) => unwrap(ops.readAuthConfig({ client, query })),
            createSession: (body) => unwrap(ops.createAuthSession({ client, body })),
            currentSession: () => unwrap(ops.readCurrentAuthSession({ client })),
            deleteCurrentSession: () => unwrap(ops.deleteCurrentAuthSession({ client })),
            listFederatedTenants: (query) => unwrap(ops.listFederatedTenants({ client, query })),
            createFederatedTenant: (body) => unwrap(ops.createFederatedTenant({ client, body })),
            getFederatedTenant: (tenantId) => unwrap(ops.readFederatedTenant({ client, path: { tenantId } })),
            updateFederatedTenant: (tenantId, body) => unwrap(ops.updateFederatedTenant({ client, path: { tenantId }, body })),
            deleteFederatedTenant: (tenantId) => unwrap(ops.deleteFederatedTenant({ client, path: { tenantId } })),
        },
        projects: {
            list: (query) => unwrap(ops.listProjects({ client, query })),
            create: (body) => unwrap(ops.createProject({ client, body })),
            get: (projectId) => unwrap(ops.readProject({ client, path: { projectId } })),
        },
        agents: {
            list: (query) => unwrap(ops.listAgents({ client, query })),
            create: (body) => unwrap(ops.createAgent({ client, body })),
            get: (agentId) => unwrap(ops.readAgent({ client, path: { agentId } })),
            update: (agentId, body) => unwrap(ops.updateAgent({ client, path: { agentId }, body })),
            listHandoffCandidates: (agentId, query) => unwrap(ops.listAgentHandoffCandidates({ client, path: { agentId }, query })),
            getMemory: (agentId) => unwrap(ops.readAgentMemory({ client, path: { agentId } })),
            replaceMemory: (agentId, body) => unwrap(ops.replaceAgentMemory({ client, path: { agentId }, body })),
            listVersions: (agentId) => unwrap(ops.listAgentVersions({ client, path: { agentId } })),
            getVersion: (agentId, version) => unwrap(ops.readAgentVersion({ client, path: { agentId, version } })),
        },
        environments: {
            list: (query) => unwrap(ops.listEnvironments({ client, query })),
            create: (body) => unwrap(ops.createEnvironment({ client, body })),
            get: (environmentId) => unwrap(ops.readEnvironment({ client, path: { environmentId } })),
            update: (environmentId, body) => unwrap(ops.updateEnvironment({ client, path: { environmentId }, body })),
            listVersions: (environmentId) => unwrap(ops.listEnvironmentVersions({ client, path: { environmentId } })),
            getVersion: (environmentId, version) => unwrap(ops.readEnvironmentVersion({ client, path: { environmentId, version } })),
        },
        providers: {
            list: () => unwrap(ops.listProviders({ client })),
            listModels: () => unwrap(ops.listModels({ client })),
            refreshCatalog: () => unwrap(ops.refreshCatalog({ client })),
            get: (providerId) => unwrap(ops.readProvider({ client, path: { providerId } })),
            listProviderModels: (providerId) => unwrap(ops.listProviderModels({ client, path: { providerId } })),
        },
        runners: {
            list: (query) => unwrap(ops.listRunners({ client, query })),
            create: (body) => unwrap(ops.createRunner({ client, body })),
            get: (runnerId) => unwrap(ops.readRunner({ client, path: { runnerId } })),
            update: (runnerId, body) => unwrap(ops.updateRunner({ client, path: { runnerId }, body })),
            channel: (runnerId) => unwrap(ops.connectRunnerChannel({ client, path: { runnerId } })),
            getHeartbeat: (runnerId) => unwrap(ops.readRunnerHeartbeat({ client, path: { runnerId } })),
            putHeartbeat: (runnerId, body) => unwrap(ops.putRunnerHeartbeat({ client, path: { runnerId }, body })),
        },
        workItems: {
            list: (query) => unwrap(ops.listWorkItems({ client, query })),
            get: (workItemId) => unwrap(ops.readWorkItem({ client, path: { workItemId } })),
        },
        leases: {
            list: (query) => unwrap(ops.listLeases({ client, query })),
            create: (body) => unwrap(ops.createLease({ client, body })),
            get: (leaseId) => unwrap(ops.readLease({ client, path: { leaseId } })),
            update: (leaseId, body) => unwrap(ops.updateLease({ client, path: { leaseId }, body })),
        },
        policies: {
            list: () => unwrap(ops.listPolicies({ client })),
            create: (body) => unwrap(ops.createPolicy({ client, body })),
            get: (policyId) => unwrap(ops.readPolicy({ client, path: { policyId } })),
            replace: (policyId, body) => unwrap(ops.replacePolicy({ client, path: { policyId }, body })),
            delete: (policyId) => unwrap(ops.deletePolicy({ client, path: { policyId } })),
            effective: (query) => unwrap(ops.readEffectivePolicy({ client, query })),
        },
        budgets: {
            list: () => unwrap(ops.listBudgets({ client })),
            create: (body) => unwrap(ops.createBudget({ client, body })),
            get: (budgetId) => unwrap(ops.readBudget({ client, path: { budgetId } })),
            update: (budgetId, body) => unwrap(ops.updateBudget({ client, path: { budgetId }, body })),
            delete: (budgetId) => unwrap(ops.deleteBudget({ client, path: { budgetId } })),
        },
        connectors: {
            list: (query) => unwrap(ops.listConnectors({ client, query })),
            get: (connectorId) => unwrap(ops.readConnector({ client, path: { connectorId } })),
        },
        connections: {
            list: (query) => unwrap(ops.listConnections({ client, query })),
            create: (body) => unwrap(ops.createConnection({ client, body })),
            get: (connectionId) => unwrap(ops.readConnection({ client, path: { connectionId } })),
            update: (connectionId, body) => unwrap(ops.updateConnection({ client, path: { connectionId }, body })),
            listTools: (connectionId) => unwrap(ops.listConnectionTools({ client, path: { connectionId } })),
            listToolCalls: (connectionId, toolName, query) => unwrap(ops.listToolCalls({ client, path: { connectionId, toolName }, query })),
            createToolCall: (connectionId, toolName, body) => unwrap(ops.createToolCall({ client, path: { connectionId, toolName }, body })),
            getToolCall: (connectionId, toolName, callId) => unwrap(ops.readToolCall({ client, path: { connectionId, toolName, callId } })),
        },
        audit: {
            listRecords: (query) => unwrap(ops.listAuditRecords({ client, query })),
            getRecord: (recordId) => unwrap(ops.readAuditRecord({ client, path: { recordId } })),
        },
        triggers: {
            list: (query) => unwrap(ops.listTriggers({ client, query })),
            create: (body) => unwrap(ops.createTrigger({ client, body })),
            get: (triggerId) => unwrap(ops.readTrigger({ client, path: { triggerId } })),
            update: (triggerId, body) => unwrap(ops.updateTrigger({ client, path: { triggerId }, body })),
            delete: (triggerId) => unwrap(ops.deleteTrigger({ client, path: { triggerId } })),
            listRuns: (triggerId, query) => unwrap(ops.listTriggerRuns({ client, path: { triggerId }, query })),
            createRun: (triggerId, body, options) => unwrap(ops.createTriggerRun({ client, path: { triggerId }, body, headers: options?.headers })),
            getRun: (triggerId, runId) => unwrap(ops.readTriggerRun({ client, path: { triggerId, runId } })),
        },
        sessions: {
            list: (query) => unwrap(ops.listSessions({ client, query })),
            create: (body) => unwrap(ops.createSession({ client, body })),
            get: (sessionId) => unwrap(ops.readSession({ client, path: { sessionId } })),
            update: (sessionId, body) => unwrap(ops.updateSession({ client, path: { sessionId }, body })),
            connection: (sessionId) => unwrap(ops.readSessionConnection({ client, path: { sessionId } })),
            socket: (sessionId) => unwrap(ops.connectSessionSocket({ client, path: { sessionId } })),
            listMessages: (sessionId, query) => unwrap(ops.listSessionMessages({ client, path: { sessionId }, query })),
            createMessage: (sessionId, body) => unwrap(ops.createSessionMessage({ client, path: { sessionId }, body })),
            getMessage: (sessionId, messageId) => unwrap(ops.readSessionMessage({ client, path: { sessionId, messageId } })),
            listEvents: (sessionId, query) => unwrap(ops.listSessionEvents({ client, path: { sessionId }, query })),
            createEvents: (sessionId, body) => unwrap(ops.createSessionEvents({ client, path: { sessionId }, body })),
            listApprovals: (sessionId) => unwrap(ops.listSessionApprovals({ client, path: { sessionId } })),
            getApproval: (sessionId, approvalId) => unwrap(ops.readSessionApproval({ client, path: { sessionId, approvalId } })),
            decideApproval: (sessionId, approvalId, body) => unwrap(ops.decideSessionApproval({ client, path: { sessionId, approvalId }, body })),
        },
        memoryStores: {
            list: (query) => unwrap(ops.listMemoryStores({ client, query })),
            create: (body) => unwrap(ops.createMemoryStore({ client, body })),
            get: (storeId) => unwrap(ops.readMemoryStore({ client, path: { storeId } })),
            update: (storeId, body) => unwrap(ops.updateMemoryStore({ client, path: { storeId }, body })),
            listMemories: (storeId, query) => unwrap(ops.listMemoryStoreMemories({ client, path: { storeId }, query })),
            createMemory: (storeId, body) => unwrap(ops.createMemoryStoreMemory({ client, path: { storeId }, body })),
            updateMemory: (storeId, memoryId, body) => unwrap(ops.updateMemoryStoreMemory({ client, path: { storeId, memoryId }, body })),
            deleteMemory: (storeId, memoryId) => unwrap(ops.deleteMemoryStoreMemory({ client, path: { storeId, memoryId } })),
        },
        vaults: {
            list: (query) => unwrap(ops.listVaults({ client, query })),
            create: (body) => unwrap(ops.createVault({ client, body })),
            get: (vaultId) => unwrap(ops.readVault({ client, path: { vaultId } })),
            update: (vaultId, body) => unwrap(ops.updateVault({ client, path: { vaultId }, body })),
            listCredentials: (vaultId, query) => unwrap(ops.listVaultCredentials({ client, path: { vaultId }, query })),
            createCredential: (vaultId, body) => unwrap(ops.createVaultCredential({ client, path: { vaultId }, body })),
            getCredential: (vaultId, credentialId) => unwrap(ops.readVaultCredential({ client, path: { vaultId, credentialId } })),
            updateCredential: (vaultId, credentialId, body) => unwrap(ops.updateVaultCredential({ client, path: { vaultId, credentialId }, body })),
            listCredentialVersions: (vaultId, credentialId, query) => unwrap(ops.listVaultCredentialVersions({ client, path: { vaultId, credentialId }, query })),
            createCredentialVersion: (vaultId, credentialId, body) => unwrap(ops.createVaultCredentialVersion({ client, path: { vaultId, credentialId }, body })),
            getCredentialVersion: (vaultId, credentialId, versionId) => unwrap(ops.readVaultCredentialVersion({ client, path: { vaultId, credentialId, versionId } })),
            deleteCredentialVersion: (vaultId, credentialId, versionId) => unwrap(ops.deleteVaultCredentialVersion({ client, path: { vaultId, credentialId, versionId } })),
        },
        usage: {
            listRecords: (query) => unwrap(ops.listUsageRecords({ client, query })),
            getRecord: (recordId) => unwrap(ops.readUsageRecord({ client, path: { recordId } })),
            summary: (query) => unwrap(ops.readUsageSummary({ client, query })),
        },
    };
}
