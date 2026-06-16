export declare const operations: readonly [{
    readonly method: "GET";
    readonly path: "/api/v1/leases/{leaseId}/channel";
    readonly operationId: "connectLeaseSessionChannel";
    readonly summary: "Open a claimed runner session WebSocket channel";
    readonly tags: readonly ["Leases"];
}, {
    readonly method: "POST";
    readonly path: "/api/v1/agents";
    readonly operationId: "createAgent";
    readonly summary: "Create an agent";
    readonly tags: readonly ["Agents"];
}, {
    readonly method: "POST";
    readonly path: "/api/v1/auth/sessions";
    readonly operationId: "createAuthSession";
    readonly summary: "Complete OIDC sign-in and create an httpOnly session cookie";
    readonly tags: readonly ["Auth"];
}, {
    readonly method: "POST";
    readonly path: "/api/v1/budgets";
    readonly operationId: "createBudget";
    readonly summary: "Create a budget";
    readonly tags: readonly ["Governance"];
}, {
    readonly method: "POST";
    readonly path: "/api/v1/connections";
    readonly operationId: "createConnection";
    readonly summary: "Create a connector connection";
    readonly tags: readonly ["Connections"];
}, {
    readonly method: "POST";
    readonly path: "/api/v1/environments";
    readonly operationId: "createEnvironment";
    readonly summary: "Create an environment";
    readonly tags: readonly ["Environments"];
}, {
    readonly method: "POST";
    readonly path: "/api/v1/auth/federated-tenants";
    readonly operationId: "createFederatedTenant";
    readonly summary: "Authorize an external issuer tenant for the current project";
    readonly tags: readonly ["Auth"];
}, {
    readonly method: "POST";
    readonly path: "/api/v1/leases";
    readonly operationId: "createLease";
    readonly summary: "Claim a specific available work item for a runner";
    readonly tags: readonly ["Leases"];
}, {
    readonly method: "POST";
    readonly path: "/api/v1/policies";
    readonly operationId: "createPolicy";
    readonly summary: "Create a scoped governance policy";
    readonly tags: readonly ["Governance"];
}, {
    readonly method: "POST";
    readonly path: "/api/v1/projects";
    readonly operationId: "createProject";
    readonly summary: "Create a project in the current organization";
    readonly tags: readonly ["Projects"];
}, {
    readonly method: "POST";
    readonly path: "/api/v1/runners";
    readonly operationId: "createRunner";
    readonly summary: "Register a self-hosted runner";
    readonly tags: readonly ["Runners"];
}, {
    readonly method: "POST";
    readonly path: "/api/v1/sessions";
    readonly operationId: "createSession";
    readonly summary: "Create a session";
    readonly tags: readonly ["Sessions"];
}, {
    readonly method: "POST";
    readonly path: "/api/v1/sessions/{sessionId}/events";
    readonly operationId: "createSessionEvents";
    readonly summary: "Batch-create session events";
    readonly tags: readonly ["Sessions"];
}, {
    readonly method: "POST";
    readonly path: "/api/v1/sessions/{sessionId}/messages";
    readonly operationId: "createSessionMessage";
    readonly summary: "Send a prompt message to a session";
    readonly tags: readonly ["Sessions"];
}, {
    readonly method: "POST";
    readonly path: "/api/v1/connections/{connectionId}/tools/{toolName}/calls";
    readonly operationId: "createToolCall";
    readonly summary: "Execute a connection tool through the AMA policy boundary";
    readonly tags: readonly ["Connections"];
}, {
    readonly method: "POST";
    readonly path: "/api/v1/triggers";
    readonly operationId: "createTrigger";
    readonly summary: "Create a trigger";
    readonly tags: readonly ["Triggers"];
}, {
    readonly method: "POST";
    readonly path: "/api/v1/vaults";
    readonly operationId: "createVault";
    readonly summary: "Create a vault";
    readonly tags: readonly ["Vaults"];
}, {
    readonly method: "POST";
    readonly path: "/api/v1/vaults/{vaultId}/credentials";
    readonly operationId: "createVaultCredential";
    readonly summary: "Create vault credential metadata";
    readonly tags: readonly ["Vaults"];
}, {
    readonly method: "POST";
    readonly path: "/api/v1/vaults/{vaultId}/credentials/{credentialId}/versions";
    readonly operationId: "createVaultCredentialVersion";
    readonly summary: "Rotate a vault credential by creating a new version";
    readonly tags: readonly ["Vaults"];
}, {
    readonly method: "PATCH";
    readonly path: "/api/v1/sessions/{sessionId}/approvals/{approvalId}";
    readonly operationId: "decideSessionApproval";
    readonly summary: "Approve or deny a pending tool call";
    readonly tags: readonly ["Sessions"];
}, {
    readonly method: "DELETE";
    readonly path: "/api/v1/budgets/{budgetId}";
    readonly operationId: "deleteBudget";
    readonly summary: "Delete a budget";
    readonly tags: readonly ["Governance"];
}, {
    readonly method: "DELETE";
    readonly path: "/api/v1/auth/sessions/current";
    readonly operationId: "deleteCurrentAuthSession";
    readonly summary: "Sign out and clear the session cookie";
    readonly tags: readonly ["Auth"];
}, {
    readonly method: "DELETE";
    readonly path: "/api/v1/auth/federated-tenants/{tenantId}";
    readonly operationId: "deleteFederatedTenant";
    readonly summary: "Delete a federated tenant";
    readonly tags: readonly ["Auth"];
}, {
    readonly method: "DELETE";
    readonly path: "/api/v1/policies/{policyId}";
    readonly operationId: "deletePolicy";
    readonly summary: "Delete a governance policy";
    readonly tags: readonly ["Governance"];
}, {
    readonly method: "DELETE";
    readonly path: "/api/v1/vaults/{vaultId}/credentials/{credentialId}/versions/{versionId}";
    readonly operationId: "deleteVaultCredentialVersion";
    readonly summary: "Delete an unused vault credential version";
    readonly tags: readonly ["Vaults"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/health";
    readonly operationId: "getHealth";
    readonly summary: "Get Worker health";
    readonly tags: readonly ["System"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/agents/{agentId}/handoff-candidates";
    readonly operationId: "listAgentHandoffCandidates";
    readonly summary: "List handoff candidate agents";
    readonly tags: readonly ["Agents"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/agents";
    readonly operationId: "listAgents";
    readonly summary: "List agents";
    readonly tags: readonly ["Agents"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/agents/{agentId}/versions";
    readonly operationId: "listAgentVersions";
    readonly summary: "List agent versions";
    readonly tags: readonly ["Agents"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/audit-records";
    readonly operationId: "listAuditRecords";
    readonly summary: "List audit records";
    readonly tags: readonly ["Audit"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/budgets";
    readonly operationId: "listBudgets";
    readonly summary: "List budgets";
    readonly tags: readonly ["Governance"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/connections";
    readonly operationId: "listConnections";
    readonly summary: "List connections";
    readonly tags: readonly ["Connections"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/connections/{connectionId}/tools";
    readonly operationId: "listConnectionTools";
    readonly summary: "List connection tools";
    readonly tags: readonly ["Connections"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/connectors";
    readonly operationId: "listConnectors";
    readonly summary: "List connectors";
    readonly tags: readonly ["Connectors"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/environments";
    readonly operationId: "listEnvironments";
    readonly summary: "List environments";
    readonly tags: readonly ["Environments"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/environments/{environmentId}/versions";
    readonly operationId: "listEnvironmentVersions";
    readonly summary: "List environment versions";
    readonly tags: readonly ["Environments"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/auth/federated-tenants";
    readonly operationId: "listFederatedTenants";
    readonly summary: "List federated tenants for the current project";
    readonly tags: readonly ["Auth"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/leases";
    readonly operationId: "listLeases";
    readonly summary: "List work leases";
    readonly tags: readonly ["Leases"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/providers/models";
    readonly operationId: "listModels";
    readonly summary: "List all catalog models";
    readonly tags: readonly ["Providers"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/policies";
    readonly operationId: "listPolicies";
    readonly summary: "List scoped governance policies";
    readonly tags: readonly ["Governance"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/projects";
    readonly operationId: "listProjects";
    readonly summary: "List projects in the current organization";
    readonly tags: readonly ["Projects"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/providers/{providerId}/models";
    readonly operationId: "listProviderModels";
    readonly summary: "List a vendor's models";
    readonly tags: readonly ["Providers"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/providers";
    readonly operationId: "listProviders";
    readonly summary: "List model vendors";
    readonly tags: readonly ["Providers"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/runners";
    readonly operationId: "listRunners";
    readonly summary: "List self-hosted runners";
    readonly tags: readonly ["Runners"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/sessions/{sessionId}/approvals";
    readonly operationId: "listSessionApprovals";
    readonly summary: "List tool approvals for a session";
    readonly tags: readonly ["Sessions"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/sessions/{sessionId}/events";
    readonly operationId: "listSessionEvents";
    readonly summary: "List session events";
    readonly tags: readonly ["Sessions"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/sessions/{sessionId}/messages";
    readonly operationId: "listSessionMessages";
    readonly summary: "List session messages";
    readonly tags: readonly ["Sessions"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/sessions";
    readonly operationId: "listSessions";
    readonly summary: "List sessions";
    readonly tags: readonly ["Sessions"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/connections/{connectionId}/tools/{toolName}/calls";
    readonly operationId: "listToolCalls";
    readonly summary: "List tool calls";
    readonly tags: readonly ["Connections"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/triggers/{triggerId}/runs";
    readonly operationId: "listTriggerRuns";
    readonly summary: "List trigger runs";
    readonly tags: readonly ["Triggers"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/triggers";
    readonly operationId: "listTriggers";
    readonly summary: "List triggers";
    readonly tags: readonly ["Triggers"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/usage-records";
    readonly operationId: "listUsageRecords";
    readonly summary: "List usage records";
    readonly tags: readonly ["Usage"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/vaults/{vaultId}/credentials";
    readonly operationId: "listVaultCredentials";
    readonly summary: "List vault credential metadata";
    readonly tags: readonly ["Vaults"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/vaults/{vaultId}/credentials/{credentialId}/versions";
    readonly operationId: "listVaultCredentialVersions";
    readonly summary: "List vault credential versions";
    readonly tags: readonly ["Vaults"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/vaults";
    readonly operationId: "listVaults";
    readonly summary: "List vaults";
    readonly tags: readonly ["Vaults"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/work-items";
    readonly operationId: "listWorkItems";
    readonly summary: "List queued self-hosted work items";
    readonly tags: readonly ["Work items"];
}, {
    readonly method: "PUT";
    readonly path: "/api/v1/runners/{runnerId}/heartbeat";
    readonly operationId: "putRunnerHeartbeat";
    readonly summary: "Replace the current runner heartbeat state";
    readonly tags: readonly ["Runners"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/agents/{agentId}";
    readonly operationId: "readAgent";
    readonly summary: "Read an agent";
    readonly tags: readonly ["Agents"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/agents/{agentId}/memory";
    readonly operationId: "readAgentMemory";
    readonly summary: "Read agent memory";
    readonly tags: readonly ["Agents"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/agents/{agentId}/versions/{version}";
    readonly operationId: "readAgentVersion";
    readonly summary: "Read an agent version";
    readonly tags: readonly ["Agents"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/audit-records/{recordId}";
    readonly operationId: "readAuditRecord";
    readonly summary: "Read an audit record";
    readonly tags: readonly ["Audit"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/auth/config";
    readonly operationId: "readAuthConfig";
    readonly summary: "Discover available sign-in methods for an organization";
    readonly tags: readonly ["Auth"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/budgets/{budgetId}";
    readonly operationId: "readBudget";
    readonly summary: "Read a budget";
    readonly tags: readonly ["Governance"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/connections/{connectionId}";
    readonly operationId: "readConnection";
    readonly summary: "Read connection";
    readonly tags: readonly ["Connections"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/connectors/{connectorId}";
    readonly operationId: "readConnector";
    readonly summary: "Read connector";
    readonly tags: readonly ["Connectors"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/auth/sessions/current";
    readonly operationId: "readCurrentAuthSession";
    readonly summary: "Read the authenticated session context";
    readonly tags: readonly ["Auth"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/effective-policy";
    readonly operationId: "readEffectivePolicy";
    readonly summary: "Read the effective governance policy";
    readonly tags: readonly ["Governance"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/environments/{environmentId}";
    readonly operationId: "readEnvironment";
    readonly summary: "Read an environment";
    readonly tags: readonly ["Environments"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/environments/{environmentId}/versions/{version}";
    readonly operationId: "readEnvironmentVersion";
    readonly summary: "Read an environment version";
    readonly tags: readonly ["Environments"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/auth/federated-tenants/{tenantId}";
    readonly operationId: "readFederatedTenant";
    readonly summary: "Read a federated tenant";
    readonly tags: readonly ["Auth"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/leases/{leaseId}";
    readonly operationId: "readLease";
    readonly summary: "Read a work lease";
    readonly tags: readonly ["Leases"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/policies/{policyId}";
    readonly operationId: "readPolicy";
    readonly summary: "Read a governance policy";
    readonly tags: readonly ["Governance"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/projects/{projectId}";
    readonly operationId: "readProject";
    readonly summary: "Read a single project";
    readonly tags: readonly ["Projects"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/providers/{providerId}";
    readonly operationId: "readProvider";
    readonly summary: "Read a model vendor";
    readonly tags: readonly ["Providers"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/runners/{runnerId}";
    readonly operationId: "readRunner";
    readonly summary: "Read a self-hosted runner";
    readonly tags: readonly ["Runners"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/runners/{runnerId}/heartbeat";
    readonly operationId: "readRunnerHeartbeat";
    readonly summary: "Read the current runner heartbeat state";
    readonly tags: readonly ["Runners"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/sessions/{sessionId}";
    readonly operationId: "readSession";
    readonly summary: "Read a session";
    readonly tags: readonly ["Sessions"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/sessions/{sessionId}/approvals/{approvalId}";
    readonly operationId: "readSessionApproval";
    readonly summary: "Read a tool approval";
    readonly tags: readonly ["Sessions"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/sessions/{sessionId}/connection";
    readonly operationId: "readSessionConnection";
    readonly summary: "Read session runtime connection details";
    readonly tags: readonly ["Sessions"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/sessions/{sessionId}/messages/{messageId}";
    readonly operationId: "readSessionMessage";
    readonly summary: "Read a session message delivery state";
    readonly tags: readonly ["Sessions"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/connections/{connectionId}/tools/{toolName}/calls/{callId}";
    readonly operationId: "readToolCall";
    readonly summary: "Read tool call";
    readonly tags: readonly ["Connections"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/triggers/{triggerId}";
    readonly operationId: "readTrigger";
    readonly summary: "Read a trigger";
    readonly tags: readonly ["Triggers"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/triggers/{triggerId}/runs/{runId}";
    readonly operationId: "readTriggerRun";
    readonly summary: "Read a trigger run";
    readonly tags: readonly ["Triggers"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/usage-records/{recordId}";
    readonly operationId: "readUsageRecord";
    readonly summary: "Read a usage record";
    readonly tags: readonly ["Usage"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/usage-summary";
    readonly operationId: "readUsageSummary";
    readonly summary: "Read aggregated usage";
    readonly tags: readonly ["Usage"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/vaults/{vaultId}";
    readonly operationId: "readVault";
    readonly summary: "Read a vault";
    readonly tags: readonly ["Vaults"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/vaults/{vaultId}/credentials/{credentialId}";
    readonly operationId: "readVaultCredential";
    readonly summary: "Read vault credential metadata";
    readonly tags: readonly ["Vaults"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/vaults/{vaultId}/credentials/{credentialId}/versions/{versionId}";
    readonly operationId: "readVaultCredentialVersion";
    readonly summary: "Read a vault credential version";
    readonly tags: readonly ["Vaults"];
}, {
    readonly method: "GET";
    readonly path: "/api/v1/work-items/{workItemId}";
    readonly operationId: "readWorkItem";
    readonly summary: "Read a queued self-hosted work item";
    readonly tags: readonly ["Work items"];
}, {
    readonly method: "POST";
    readonly path: "/api/v1/providers/refresh";
    readonly operationId: "refreshCatalog";
    readonly summary: "Refresh the model catalog";
    readonly tags: readonly ["Providers"];
}, {
    readonly method: "PUT";
    readonly path: "/api/v1/agents/{agentId}/memory";
    readonly operationId: "replaceAgentMemory";
    readonly summary: "Replace agent memory";
    readonly tags: readonly ["Agents"];
}, {
    readonly method: "PUT";
    readonly path: "/api/v1/policies/{policyId}";
    readonly operationId: "replacePolicy";
    readonly summary: "Replace a governance policy";
    readonly tags: readonly ["Governance"];
}, {
    readonly method: "PATCH";
    readonly path: "/api/v1/agents/{agentId}";
    readonly operationId: "updateAgent";
    readonly summary: "Update an agent";
    readonly tags: readonly ["Agents"];
}, {
    readonly method: "PATCH";
    readonly path: "/api/v1/budgets/{budgetId}";
    readonly operationId: "updateBudget";
    readonly summary: "Update a budget";
    readonly tags: readonly ["Governance"];
}, {
    readonly method: "PATCH";
    readonly path: "/api/v1/connections/{connectionId}";
    readonly operationId: "updateConnection";
    readonly summary: "Update connection state, credential, or settings";
    readonly tags: readonly ["Connections"];
}, {
    readonly method: "PATCH";
    readonly path: "/api/v1/environments/{environmentId}";
    readonly operationId: "updateEnvironment";
    readonly summary: "Update an environment";
    readonly tags: readonly ["Environments"];
}, {
    readonly method: "PATCH";
    readonly path: "/api/v1/auth/federated-tenants/{tenantId}";
    readonly operationId: "updateFederatedTenant";
    readonly summary: "Update a federated tenant";
    readonly tags: readonly ["Auth"];
}, {
    readonly method: "PATCH";
    readonly path: "/api/v1/leases/{leaseId}";
    readonly operationId: "updateLease";
    readonly summary: "Renew or finish a work lease";
    readonly tags: readonly ["Leases"];
}, {
    readonly method: "PATCH";
    readonly path: "/api/v1/runners/{runnerId}";
    readonly operationId: "updateRunner";
    readonly summary: "Update or archive a self-hosted runner";
    readonly tags: readonly ["Runners"];
}, {
    readonly method: "PATCH";
    readonly path: "/api/v1/sessions/{sessionId}";
    readonly operationId: "updateSession";
    readonly summary: "Update a session";
    readonly tags: readonly ["Sessions"];
}, {
    readonly method: "PATCH";
    readonly path: "/api/v1/triggers/{triggerId}";
    readonly operationId: "updateTrigger";
    readonly summary: "Update, pause, or archive a trigger";
    readonly tags: readonly ["Triggers"];
}, {
    readonly method: "PATCH";
    readonly path: "/api/v1/vaults/{vaultId}";
    readonly operationId: "updateVault";
    readonly summary: "Update or archive a vault";
    readonly tags: readonly ["Vaults"];
}, {
    readonly method: "PATCH";
    readonly path: "/api/v1/vaults/{vaultId}/credentials/{credentialId}";
    readonly operationId: "updateVaultCredential";
    readonly summary: "Update or revoke vault credential metadata";
    readonly tags: readonly ["Vaults"];
}];
export type AmaOperationId = (typeof operations)[number]['operationId'];
