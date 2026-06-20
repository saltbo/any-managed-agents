import type * as types from './generated/types.gen.js';
export interface AmaClientConfig {
    /** AMA control-plane origin, e.g. https://ama.example.com */
    baseUrl: string;
    /** OIDC access token; sent as `Authorization: Bearer <token>`. */
    accessToken?: string;
    /** Sent as `x-ama-project-id` to scope project-bound operations. */
    projectId?: string;
    /** Extra headers merged last. */
    headers?: Record<string, string>;
}
/** Thrown on any non-2xx response. `status` lets callers branch on 404/409/etc. */
export declare class AmaApiError extends Error {
    readonly status: number | undefined;
    readonly responseText: string;
    readonly body: unknown;
    constructor(status: number | undefined, responseText: string, body: unknown);
}
export type AmaClient = ReturnType<typeof createAmaClient>;
export declare function createAmaClient(config: AmaClientConfig): {
    /** Escape hatch: the raw generated client for operations not yet on the facade. */
    raw: import("./generated/client/types.gen.js").Client;
    agents: {
        create: (body: types.CreateAgentRequest) => Promise<types.Agent>;
        get: (agentId: string) => Promise<types.Agent>;
        update: (agentId: string, body: types.UpdateAgentRequest) => Promise<types.Agent>;
        list: (query?: types.ListAgentsData["query"]) => Promise<types.AgentListResponse>;
    };
    environments: {
        create: (body: types.CreateEnvironmentRequest) => Promise<types.Environment>;
        get: (environmentId: string) => Promise<types.Environment>;
        update: (environmentId: string, body: types.UpdateEnvironmentRequest) => Promise<types.Environment>;
        list: (query?: types.ListEnvironmentsData["query"]) => Promise<types.EnvironmentListResponse>;
    };
    projects: {
        create: (body: types.CreateProjectRequest) => Promise<types.Project>;
        get: (projectId: string) => Promise<types.Project>;
    };
    sessions: {
        create: (body: types.CreateSessionRequest) => Promise<types.Session>;
        get: (sessionId: string) => Promise<types.Session>;
        update: (sessionId: string, body: types.UpdateSessionRequest) => Promise<types.Session>;
        list: (query?: types.ListSessionsData["query"]) => Promise<types.SessionListResponse>;
        connection: (sessionId: string) => Promise<types.SessionConnection>;
        listEvents: (sessionId: string, query?: types.ListSessionEventsData["query"]) => Promise<types.SessionEventListResponse>;
        createMessage: (sessionId: string, body: types.CreateSessionMessageRequest) => Promise<types.SessionMessage>;
    };
    vaults: {
        create: (body: types.CreateVaultRequest) => Promise<types.Vault>;
        createCredential: (vaultId: string, body: types.CreateVaultCredentialRequest) => Promise<types.VaultCredential>;
        updateCredential: (vaultId: string, credentialId: string, body: types.UpdateVaultCredentialRequest) => Promise<types.VaultCredential>;
    };
    triggers: {
        create: (body: types.CreateTriggerRequest) => Promise<types.Trigger>;
        get: (triggerId: string) => Promise<types.Trigger>;
        update: (triggerId: string, body: types.UpdateTriggerRequest) => Promise<types.Trigger>;
        delete: (triggerId: string) => Promise<void>;
        listRuns: (triggerId: string, query?: types.ListTriggerRunsData["query"]) => Promise<types.TriggerRunListResponse>;
    };
    runners: {
        list: (query?: types.ListRunnersData["query"]) => Promise<types.RunnerListResponse>;
    };
    usage: {
        listRecords: (query?: types.ListUsageRecordsData["query"]) => Promise<types.UsageRecordListResponse>;
        summary: (query?: types.ReadUsageSummaryData["query"]) => Promise<types.UsageSummary>;
    };
    models: {
        list: (query?: types.ListModelsData["query"]) => Promise<types.ProviderModelListResponse>;
    };
    federatedTenants: {
        create: (body: types.CreateFederatedTenantRequest) => Promise<types.FederatedTenant>;
    };
};
