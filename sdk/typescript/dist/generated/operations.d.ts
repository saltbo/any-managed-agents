export declare const operations: readonly [{
    readonly method: "POST";
    readonly path: "/api/governance/config";
    readonly operationId: "applyGovernanceConfig";
    readonly summary: "Apply declarative governance config atomically";
    readonly tags: readonly ["Governance"];
}, {
    readonly method: "DELETE";
    readonly path: "/api/agents/{agentId}";
    readonly operationId: "archiveAgent";
    readonly summary: "Archive an agent";
    readonly tags: readonly ["Agents"];
}, {
    readonly method: "DELETE";
    readonly path: "/api/environments/{environmentId}";
    readonly operationId: "archiveEnvironment";
    readonly summary: "Archive an environment";
    readonly tags: readonly ["Environments"];
}, {
    readonly method: "DELETE";
    readonly path: "/api/scheduled-agent-triggers/{triggerId}";
    readonly operationId: "archiveScheduledAgentTrigger";
    readonly summary: "Archive a scheduled agent trigger";
    readonly tags: readonly ["Scheduled agent triggers"];
}, {
    readonly method: "DELETE";
    readonly path: "/api/sessions/{sessionId}";
    readonly operationId: "archiveSession";
    readonly summary: "Archive a session";
    readonly tags: readonly ["Sessions"];
}, {
    readonly method: "DELETE";
    readonly path: "/api/vaults/{vaultId}";
    readonly operationId: "archiveVault";
    readonly summary: "Archive a vault";
    readonly tags: readonly ["Vaults"];
}, {
    readonly method: "POST";
    readonly path: "/api/mcp/connections/{connectionId}/tools/{toolName}/calls";
    readonly operationId: "callMcpTool";
    readonly summary: "Call MCP tool through AMA policy boundary";
    readonly tags: readonly ["MCP"];
}, {
    readonly method: "POST";
    readonly path: "/api/mcp/connections";
    readonly operationId: "connectMcpConnector";
    readonly summary: "Connect or upsert an MCP connector";
    readonly tags: readonly ["MCP"];
}, {
    readonly method: "GET";
    readonly path: "/api/runners/{runnerId}/leases/{leaseId}/channel";
    readonly operationId: "connectRunnerSessionChannel";
    readonly summary: "Open a claimed runner session WebSocket channel";
    readonly tags: readonly ["Runner leases"];
}, {
    readonly method: "POST";
    readonly path: "/api/agents";
    readonly operationId: "createAgent";
    readonly summary: "Create an agent";
    readonly tags: readonly ["Agents"];
}, {
    readonly method: "POST";
    readonly path: "/api/auth/session";
    readonly operationId: "createAuthSession";
    readonly summary: "Complete OIDC sign-in and create an httpOnly session cookie";
    readonly tags: readonly ["Auth"];
}, {
    readonly method: "POST";
    readonly path: "/api/governance/budgets";
    readonly operationId: "createBudget";
    readonly summary: "Create budget";
    readonly tags: readonly ["Governance"];
}, {
    readonly method: "POST";
    readonly path: "/api/environments";
    readonly operationId: "createEnvironment";
    readonly summary: "Create an environment";
    readonly tags: readonly ["Environments"];
}, {
    readonly method: "POST";
    readonly path: "/api/projects/{projectId}/external-bindings";
    readonly operationId: "createExternalProjectBinding";
    readonly summary: "Bind an external issuer tenant to a project";
    readonly tags: readonly ["Projects"];
}, {
    readonly method: "POST";
    readonly path: "/api/projects";
    readonly operationId: "createProject";
    readonly summary: "Create a project in the current organization";
    readonly tags: readonly ["Projects"];
}, {
    readonly method: "POST";
    readonly path: "/api/providers";
    readonly operationId: "createProvider";
    readonly summary: "Create a provider";
    readonly tags: readonly ["Providers"];
}, {
    readonly method: "POST";
    readonly path: "/api/governance/provider-access-rules";
    readonly operationId: "createProviderAccessRule";
    readonly summary: "Create provider access rule";
    readonly tags: readonly ["Governance"];
}, {
    readonly method: "POST";
    readonly path: "/api/runners";
    readonly operationId: "createRunner";
    readonly summary: "Register a self-hosted runner";
    readonly tags: readonly ["Runners"];
}, {
    readonly method: "POST";
    readonly path: "/api/runners/{runnerId}/heartbeats";
    readonly operationId: "createRunnerHeartbeat";
    readonly summary: "Record a runner heartbeat";
    readonly tags: readonly ["Runners"];
}, {
    readonly method: "POST";
    readonly path: "/api/runners/{runnerId}/leases";
    readonly operationId: "createRunnerLease";
    readonly summary: "Claim queued self-hosted runner work";
    readonly tags: readonly ["Runner leases"];
}, {
    readonly method: "POST";
    readonly path: "/api/runners/{runnerId}/leases/{leaseId}/events";
    readonly operationId: "createRunnerLeaseEvents";
    readonly summary: "Upload structured runner lease events";
    readonly tags: readonly ["Runner leases"];
}, {
    readonly method: "POST";
    readonly path: "/api/scheduled-agent-triggers";
    readonly operationId: "createScheduledAgentTrigger";
    readonly summary: "Create a scheduled agent trigger";
    readonly tags: readonly ["Scheduled agent triggers"];
}, {
    readonly method: "POST";
    readonly path: "/api/sessions";
    readonly operationId: "createSession";
    readonly summary: "Create a session";
    readonly tags: readonly ["Sessions"];
}, {
    readonly method: "POST";
    readonly path: "/api/sessions/{sessionId}/commands";
    readonly operationId: "createSessionCommand";
    readonly summary: "Send a command to an active session";
    readonly tags: readonly ["Sessions"];
}, {
    readonly method: "POST";
    readonly path: "/api/vaults";
    readonly operationId: "createVault";
    readonly summary: "Create a vault";
    readonly tags: readonly ["Vaults"];
}, {
    readonly method: "POST";
    readonly path: "/api/vaults/{vaultId}/credentials";
    readonly operationId: "createVaultCredential";
    readonly summary: "Create vault credential metadata";
    readonly tags: readonly ["Vaults"];
}, {
    readonly method: "POST";
    readonly path: "/api/sessions/{sessionId}/approvals/{approvalId}";
    readonly operationId: "decideSessionApproval";
    readonly summary: "Approve or deny a pending tool call";
    readonly tags: readonly ["Sessions"];
}, {
    readonly method: "DELETE";
    readonly path: "/api/providers/{providerId}";
    readonly operationId: "deleteProvider";
    readonly summary: "Delete a provider";
    readonly tags: readonly ["Providers"];
}, {
    readonly method: "DELETE";
    readonly path: "/api/vaults/{vaultId}/credentials/{credentialId}/versions/{versionId}";
    readonly operationId: "deleteVaultCredentialVersion";
    readonly summary: "Delete unused vault credential version metadata";
    readonly tags: readonly ["Vaults"];
}, {
    readonly method: "DELETE";
    readonly path: "/api/mcp/connections/{connectionId}";
    readonly operationId: "disconnectMcpConnection";
    readonly summary: "Disconnect MCP connection";
    readonly tags: readonly ["MCP"];
}, {
    readonly method: "POST";
    readonly path: "/api/providers/{providerId}/models/discovery";
    readonly operationId: "discoverProviderModels";
    readonly summary: "Discover provider models";
    readonly tags: readonly ["Providers"];
}, {
    readonly method: "POST";
    readonly path: "/api/governance/evaluations";
    readonly operationId: "evaluateGovernancePolicy";
    readonly summary: "Evaluate governance policy";
    readonly tags: readonly ["Governance"];
}, {
    readonly method: "GET";
    readonly path: "/api/audit-records/export";
    readonly operationId: "exportAuditRecords";
    readonly summary: "Export audit records";
    readonly tags: readonly ["Audit"];
}, {
    readonly method: "GET";
    readonly path: "/api/sessions/{sessionId}/events/export";
    readonly operationId: "exportSessionEvents";
    readonly summary: "Export session events as NDJSON";
    readonly tags: readonly ["Sessions"];
}, {
    readonly method: "GET";
    readonly path: "/api/health";
    readonly operationId: "getHealth";
    readonly summary: "Get Worker health";
    readonly tags: readonly ["System"];
}, {
    readonly method: "GET";
    readonly path: "/api/auth/login-options";
    readonly operationId: "getLoginOptions";
    readonly summary: "Discover available login methods for an organization";
    readonly tags: readonly ["Auth"];
}, {
    readonly method: "GET";
    readonly path: "/api/agents/{agentId}/handoff-candidates";
    readonly operationId: "listAgentHandoffCandidates";
    readonly summary: "List handoff candidate agents";
    readonly tags: readonly ["Agents"];
}, {
    readonly method: "GET";
    readonly path: "/api/agents";
    readonly operationId: "listAgents";
    readonly summary: "List agents";
    readonly tags: readonly ["Agents"];
}, {
    readonly method: "GET";
    readonly path: "/api/agents/{agentId}/versions";
    readonly operationId: "listAgentVersions";
    readonly summary: "List agent versions";
    readonly tags: readonly ["Agents"];
}, {
    readonly method: "GET";
    readonly path: "/api/audit-records";
    readonly operationId: "listAuditRecords";
    readonly summary: "List audit records";
    readonly tags: readonly ["Audit"];
}, {
    readonly method: "GET";
    readonly path: "/api/governance/budgets";
    readonly operationId: "listBudgets";
    readonly summary: "List budgets";
    readonly tags: readonly ["Governance"];
}, {
    readonly method: "GET";
    readonly path: "/api/environments";
    readonly operationId: "listEnvironments";
    readonly summary: "List environments";
    readonly tags: readonly ["Environments"];
}, {
    readonly method: "GET";
    readonly path: "/api/environments/{environmentId}/versions";
    readonly operationId: "listEnvironmentVersions";
    readonly summary: "List environment versions";
    readonly tags: readonly ["Environments"];
}, {
    readonly method: "GET";
    readonly path: "/api/projects/{projectId}/external-bindings";
    readonly operationId: "listExternalProjectBindings";
    readonly summary: "List external tenant bindings for a project";
    readonly tags: readonly ["Projects"];
}, {
    readonly method: "GET";
    readonly path: "/api/mcp/connections";
    readonly operationId: "listMcpConnections";
    readonly summary: "List MCP connections";
    readonly tags: readonly ["MCP"];
}, {
    readonly method: "GET";
    readonly path: "/api/mcp/connectors";
    readonly operationId: "listMcpConnectors";
    readonly summary: "List MCP connectors";
    readonly tags: readonly ["MCP"];
}, {
    readonly method: "GET";
    readonly path: "/api/mcp/connections/{connectionId}/tools";
    readonly operationId: "listMcpTools";
    readonly summary: "List MCP connection tools";
    readonly tags: readonly ["MCP"];
}, {
    readonly method: "GET";
    readonly path: "/api/projects";
    readonly operationId: "listProjects";
    readonly summary: "List projects in the current organization";
    readonly tags: readonly ["Projects"];
}, {
    readonly method: "GET";
    readonly path: "/api/governance/provider-access-rules";
    readonly operationId: "listProviderAccessRules";
    readonly summary: "List provider access rules";
    readonly tags: readonly ["Governance"];
}, {
    readonly method: "GET";
    readonly path: "/api/providers/{providerId}/models";
    readonly operationId: "listProviderModels";
    readonly summary: "List provider models";
    readonly tags: readonly ["Providers"];
}, {
    readonly method: "GET";
    readonly path: "/api/providers";
    readonly operationId: "listProviders";
    readonly summary: "List providers";
    readonly tags: readonly ["Providers"];
}, {
    readonly method: "GET";
    readonly path: "/api/runners";
    readonly operationId: "listRunners";
    readonly summary: "List self-hosted runners";
    readonly tags: readonly ["Runners"];
}, {
    readonly method: "GET";
    readonly path: "/api/runners/work-items";
    readonly operationId: "listRunnerWorkItems";
    readonly summary: "List self-hosted runner work items";
    readonly tags: readonly ["Runner work"];
}, {
    readonly method: "GET";
    readonly path: "/api/scheduled-agent-triggers";
    readonly operationId: "listScheduledAgentTriggers";
    readonly summary: "List scheduled agent triggers";
    readonly tags: readonly ["Scheduled agent triggers"];
}, {
    readonly method: "GET";
    readonly path: "/api/scheduled-agent-triggers/{triggerId}/runs";
    readonly operationId: "listScheduledTriggerRuns";
    readonly summary: "List scheduled trigger runs";
    readonly tags: readonly ["Scheduled agent triggers"];
}, {
    readonly method: "GET";
    readonly path: "/api/sessions/{sessionId}/approvals";
    readonly operationId: "listSessionApprovals";
    readonly summary: "List pending tool approvals for a session";
    readonly tags: readonly ["Sessions"];
}, {
    readonly method: "GET";
    readonly path: "/api/sessions/{sessionId}/events";
    readonly operationId: "listSessionEvents";
    readonly summary: "List session events";
    readonly tags: readonly ["Sessions"];
}, {
    readonly method: "GET";
    readonly path: "/api/sessions";
    readonly operationId: "listSessions";
    readonly summary: "List sessions";
    readonly tags: readonly ["Sessions"];
}, {
    readonly method: "GET";
    readonly path: "/api/usage";
    readonly operationId: "listUsageRecords";
    readonly summary: "List usage records";
    readonly tags: readonly ["Usage"];
}, {
    readonly method: "GET";
    readonly path: "/api/vaults/{vaultId}/credentials";
    readonly operationId: "listVaultCredentials";
    readonly summary: "List vault credential metadata";
    readonly tags: readonly ["Vaults"];
}, {
    readonly method: "GET";
    readonly path: "/api/vaults/{vaultId}/credentials/{credentialId}/versions";
    readonly operationId: "listVaultCredentialVersions";
    readonly summary: "List vault credential versions";
    readonly tags: readonly ["Vaults"];
}, {
    readonly method: "GET";
    readonly path: "/api/vaults";
    readonly operationId: "listVaults";
    readonly summary: "List vaults";
    readonly tags: readonly ["Vaults"];
}, {
    readonly method: "POST";
    readonly path: "/api/governance/config/preview";
    readonly operationId: "previewGovernanceConfig";
    readonly summary: "Preview declarative governance config impact";
    readonly tags: readonly ["Governance"];
}, {
    readonly method: "GET";
    readonly path: "/api/agents/{agentId}";
    readonly operationId: "readAgent";
    readonly summary: "Read an agent";
    readonly tags: readonly ["Agents"];
}, {
    readonly method: "GET";
    readonly path: "/api/agents/{agentId}/memory";
    readonly operationId: "readAgentMemory";
    readonly summary: "Read agent memory";
    readonly tags: readonly ["Agents"];
}, {
    readonly method: "GET";
    readonly path: "/api/governance/effective-policy";
    readonly operationId: "readEffectiveGovernancePolicy";
    readonly summary: "Read effective governance policy";
    readonly tags: readonly ["Governance"];
}, {
    readonly method: "GET";
    readonly path: "/api/environments/{environmentId}";
    readonly operationId: "readEnvironment";
    readonly summary: "Read an environment";
    readonly tags: readonly ["Environments"];
}, {
    readonly method: "GET";
    readonly path: "/api/governance/policy";
    readonly operationId: "readGovernancePolicy";
    readonly summary: "Read governance policy";
    readonly tags: readonly ["Governance"];
}, {
    readonly method: "GET";
    readonly path: "/api/mcp/connections/{connectionId}";
    readonly operationId: "readMcpConnection";
    readonly summary: "Read MCP connection";
    readonly tags: readonly ["MCP"];
}, {
    readonly method: "GET";
    readonly path: "/api/mcp/connectors/{connectorId}";
    readonly operationId: "readMcpConnector";
    readonly summary: "Read MCP connector";
    readonly tags: readonly ["MCP"];
}, {
    readonly method: "GET";
    readonly path: "/api/providers/{providerId}";
    readonly operationId: "readProvider";
    readonly summary: "Read a provider";
    readonly tags: readonly ["Providers"];
}, {
    readonly method: "GET";
    readonly path: "/api/runners/{runnerId}";
    readonly operationId: "readRunner";
    readonly summary: "Read a self-hosted runner";
    readonly tags: readonly ["Runners"];
}, {
    readonly method: "GET";
    readonly path: "/api/scheduled-agent-triggers/{triggerId}";
    readonly operationId: "readScheduledAgentTrigger";
    readonly summary: "Read a scheduled agent trigger";
    readonly tags: readonly ["Scheduled agent triggers"];
}, {
    readonly method: "GET";
    readonly path: "/api/sessions/{sessionId}";
    readonly operationId: "readSession";
    readonly summary: "Read a session";
    readonly tags: readonly ["Sessions"];
}, {
    readonly method: "GET";
    readonly path: "/api/sessions/{sessionId}/reconnect";
    readonly operationId: "readSessionReconnect";
    readonly summary: "Read reconnect metadata";
    readonly tags: readonly ["Sessions"];
}, {
    readonly method: "GET";
    readonly path: "/api/usage/summary";
    readonly operationId: "readUsageSummary";
    readonly summary: "Read usage summary";
    readonly tags: readonly ["Usage"];
}, {
    readonly method: "GET";
    readonly path: "/api/vaults/{vaultId}";
    readonly operationId: "readVault";
    readonly summary: "Read a vault";
    readonly tags: readonly ["Vaults"];
}, {
    readonly method: "GET";
    readonly path: "/api/vaults/{vaultId}/credentials/{credentialId}";
    readonly operationId: "readVaultCredential";
    readonly summary: "Read vault credential metadata";
    readonly tags: readonly ["Vaults"];
}, {
    readonly method: "POST";
    readonly path: "/api/vaults/{vaultId}/credentials/{credentialId}/versions";
    readonly operationId: "rotateVaultCredential";
    readonly summary: "Rotate vault credential";
    readonly tags: readonly ["Vaults"];
}, {
    readonly method: "POST";
    readonly path: "/api/sessions/{sessionId}/stop";
    readonly operationId: "stopSession";
    readonly summary: "Stop a session";
    readonly tags: readonly ["Sessions"];
}, {
    readonly method: "GET";
    readonly path: "/api/sessions/{sessionId}/events/stream";
    readonly operationId: "streamSessionEvents";
    readonly summary: "Stream session events as NDJSON";
    readonly tags: readonly ["Sessions"];
}, {
    readonly method: "PATCH";
    readonly path: "/api/agents/{agentId}";
    readonly operationId: "updateAgent";
    readonly summary: "Update an agent";
    readonly tags: readonly ["Agents"];
}, {
    readonly method: "PATCH";
    readonly path: "/api/agents/{agentId}/memory";
    readonly operationId: "updateAgentMemory";
    readonly summary: "Update agent memory";
    readonly tags: readonly ["Agents"];
}, {
    readonly method: "PATCH";
    readonly path: "/api/environments/{environmentId}";
    readonly operationId: "updateEnvironment";
    readonly summary: "Update an environment";
    readonly tags: readonly ["Environments"];
}, {
    readonly method: "PUT";
    readonly path: "/api/governance/policy";
    readonly operationId: "updateGovernancePolicy";
    readonly summary: "Update governance policy";
    readonly tags: readonly ["Governance"];
}, {
    readonly method: "PATCH";
    readonly path: "/api/mcp/connections/{connectionId}";
    readonly operationId: "updateMcpConnection";
    readonly summary: "Update MCP connection";
    readonly tags: readonly ["MCP"];
}, {
    readonly method: "PATCH";
    readonly path: "/api/providers/{providerId}";
    readonly operationId: "updateProvider";
    readonly summary: "Update a provider";
    readonly tags: readonly ["Providers"];
}, {
    readonly method: "PATCH";
    readonly path: "/api/runners/{runnerId}";
    readonly operationId: "updateRunner";
    readonly summary: "Update a self-hosted runner";
    readonly tags: readonly ["Runners"];
}, {
    readonly method: "PATCH";
    readonly path: "/api/runners/{runnerId}/leases/{leaseId}";
    readonly operationId: "updateRunnerLease";
    readonly summary: "Renew or finish a runner lease";
    readonly tags: readonly ["Runner leases"];
}, {
    readonly method: "PATCH";
    readonly path: "/api/scheduled-agent-triggers/{triggerId}";
    readonly operationId: "updateScheduledAgentTrigger";
    readonly summary: "Update a scheduled agent trigger";
    readonly tags: readonly ["Scheduled agent triggers"];
}, {
    readonly method: "PATCH";
    readonly path: "/api/sessions/{sessionId}";
    readonly operationId: "updateSession";
    readonly summary: "Update a session lifecycle state";
    readonly tags: readonly ["Sessions"];
}, {
    readonly method: "PATCH";
    readonly path: "/api/vaults/{vaultId}";
    readonly operationId: "updateVault";
    readonly summary: "Update a vault";
    readonly tags: readonly ["Vaults"];
}, {
    readonly method: "PATCH";
    readonly path: "/api/vaults/{vaultId}/credentials/{credentialId}";
    readonly operationId: "updateVaultCredential";
    readonly summary: "Update or revoke vault credential metadata";
    readonly tags: readonly ["Vaults"];
}, {
    readonly method: "POST";
    readonly path: "/api/providers/{providerId}/models";
    readonly operationId: "upsertProviderModel";
    readonly summary: "Upsert provider model metadata";
    readonly tags: readonly ["Providers"];
}, {
    readonly method: "POST";
    readonly path: "/api/governance/config/validate";
    readonly operationId: "validateGovernanceConfig";
    readonly summary: "Validate declarative governance config";
    readonly tags: readonly ["Governance"];
}];
export type AmaOperationId = (typeof operations)[number]['operationId'];
