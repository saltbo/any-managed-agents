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
        create: (body: types.CreateAgentRequest) => Promise<types.Agent | undefined>;
        get: (agentId: string) => Promise<types.Agent | undefined>;
        update: (agentId: string, body: types.UpdateAgentRequest) => Promise<types.Agent | undefined>;
        list: (query?: types.ListAgentsData["query"]) => Promise<types.AgentListResponse | undefined>;
    };
    environments: {
        create: (body: types.CreateEnvironmentRequest) => Promise<types.Environment | undefined>;
        get: (environmentId: string) => Promise<types.Environment | undefined>;
        update: (environmentId: string, body: types.UpdateEnvironmentRequest) => Promise<types.Environment | undefined>;
        list: (query?: types.ListEnvironmentsData["query"]) => Promise<types.EnvironmentListResponse | undefined>;
    };
    projects: {
        create: (body: types.CreateProjectRequest) => Promise<types.Project | undefined>;
        get: (projectId: string) => Promise<types.Project | undefined>;
    };
    sessions: {
        create: (body: types.CreateSessionRequest) => Promise<types.Session | undefined>;
        get: (sessionId: string) => Promise<types.Session | undefined>;
        update: (sessionId: string, body: types.UpdateSessionRequest) => Promise<types.Session | undefined>;
        list: (query?: types.ListSessionsData["query"]) => Promise<types.SessionListResponse | undefined>;
        listEvents: (sessionId: string, query?: types.ListSessionEventsData["query"]) => Promise<types.SessionEventListResponse | undefined>;
        createMessage: (sessionId: string, body: types.CreateSessionMessageRequest) => Promise<types.SessionMessage | undefined>;
    };
    vaults: {
        create: (body: types.CreateVaultRequest) => Promise<types.Vault | undefined>;
        createCredential: (vaultId: string, body: types.CreateVaultCredentialRequest) => Promise<types.VaultCredential | undefined>;
        updateCredential: (vaultId: string, credentialId: string, body: types.UpdateVaultCredentialRequest) => Promise<types.VaultCredential | undefined>;
    };
    triggers: {
        create: (body: types.CreateTriggerRequest) => Promise<types.Trigger | undefined>;
        get: (triggerId: string) => Promise<types.Trigger | undefined>;
        update: (triggerId: string, body: types.UpdateTriggerRequest) => Promise<types.Trigger | undefined>;
        delete: (triggerId: string) => Promise<void | undefined>;
        listRuns: (triggerId: string, query?: types.ListTriggerRunsData["query"]) => Promise<types.TriggerRunListResponse | undefined>;
    };
    runners: {
        list: (query?: types.ListRunnersData["query"]) => Promise<types.RunnerListResponse | undefined>;
    };
    usage: {
        listRecords: (query?: types.ListUsageRecordsData["query"]) => Promise<types.UsageRecordListResponse | undefined>;
        summary: (query?: types.ReadUsageSummaryData["query"]) => Promise<types.UsageSummary | undefined>;
    };
    models: {
        list: (query?: types.ListModelsData["query"]) => Promise<types.ProviderModelListResponse | undefined>;
    };
    federatedTenants: {
        create: (body: types.CreateFederatedTenantRequest) => Promise<types.FederatedTenant | undefined>;
    };
};
