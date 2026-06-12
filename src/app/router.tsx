import { createBrowserRouter, Navigate } from 'react-router'
import { AgentBuilderPage } from '@/features/agents/AgentBuilderPage'
import { AgentDetailPage } from '@/features/agents/AgentDetailPage'
import { AgentsPage } from '@/features/agents/AgentsPage'
import { AuditPage } from '@/features/audit/AuditPage'
import { AuthCallbackPage } from '@/features/auth/AuthCallbackPage'
import { ConsoleLayout } from '@/features/console/ConsoleLayout'
import { EnvironmentDetailPage } from '@/features/environments/EnvironmentDetailPage'
import { EnvironmentsPage } from '@/features/environments/EnvironmentsPage'
import { McpConnectorPage } from '@/features/mcp/McpConnectorPage'
import { McpPage } from '@/features/mcp/McpPage'
import { ProviderDetailPage } from '@/features/providers/ProviderDetailPage'
import { ProviderPolicyPage } from '@/features/providers/ProviderPolicyPage'
import { ProvidersPage } from '@/features/providers/ProvidersPage'
import { QuickstartPage } from '@/features/quickstart/QuickstartPage'
import { SessionDetailPage } from '@/features/sessions/SessionDetailPage'
import { SessionsPage } from '@/features/sessions/SessionsPage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { UsagePage } from '@/features/usage/UsagePage'
import { VaultDetailPage } from '@/features/vaults/VaultDetailPage'
import { VaultsPage } from '@/features/vaults/VaultsPage'

export function createAppRouter() {
  return createBrowserRouter([
    {
      path: '/auth/callback',
      element: <AuthCallbackPage />,
    },
    {
      path: '/',
      element: <ConsoleLayout />,
      children: [
        { index: true, element: <Navigate to="/quickstart" replace /> },
        { path: 'quickstart', element: <QuickstartPage /> },
        { path: 'agents', element: <AgentsPage /> },
        { path: 'agents/new', element: <AgentBuilderPage /> },
        { path: 'agents/:agentId', element: <AgentDetailPage /> },
        { path: 'environments', element: <EnvironmentsPage /> },
        { path: 'environments/:environmentId', element: <EnvironmentDetailPage /> },
        { path: 'sessions', element: <SessionsPage /> },
        { path: 'sessions/:sessionId', element: <SessionDetailPage /> },
        { path: 'providers', element: <ProvidersPage /> },
        { path: 'providers/policy', element: <ProviderPolicyPage /> },
        { path: 'providers/:providerId', element: <ProviderDetailPage /> },
        { path: 'vaults', element: <VaultsPage /> },
        { path: 'vaults/:vaultId', element: <VaultDetailPage /> },
        { path: 'mcp', element: <McpPage /> },
        { path: 'mcp/:connectorId', element: <McpConnectorPage /> },
        { path: 'usage', element: <UsagePage /> },
        { path: 'audit', element: <AuditPage /> },
        { path: 'settings', element: <SettingsPage /> },
        { path: '*', element: <Navigate to="/quickstart" replace /> },
      ],
    },
  ])
}
