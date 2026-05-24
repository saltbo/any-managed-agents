import { createBrowserRouter, Navigate } from 'react-router'
import { AgentsPage } from '@/features/agents/AgentsPage'
import { ConsoleLayout } from '@/features/console/ConsoleLayout'
import { EnvironmentsPage } from '@/features/environments/EnvironmentsPage'
import { SessionsPage } from '@/features/sessions/SessionsPage'

export function createAppRouter() {
  return createBrowserRouter([
    {
      path: '/',
      element: <ConsoleLayout />,
      children: [
        { index: true, element: <Navigate to="/agents" replace /> },
        { path: 'agents', element: <AgentsPage /> },
        { path: 'environments', element: <EnvironmentsPage /> },
        { path: 'sessions', element: <SessionsPage /> },
        { path: '*', element: <Navigate to="/agents" replace /> },
      ],
    },
  ])
}
