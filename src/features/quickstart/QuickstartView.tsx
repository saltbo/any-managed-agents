import { ExternalLink } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusBadge, TableSurface } from '@/console/components'
import { JsonBlock } from '@/features/console/json-block'
import type { Agent, Environment, Session } from '@/lib/api'

export function QuickstartView({
  agents,
  environments,
  sessions,
}: {
  agents: Agent[]
  environments: Environment[]
  sessions: Session[]
}) {
  const steps = [
    { label: 'Provider', complete: true, call: 'GET /api/providers' },
    {
      label: 'Environment',
      complete: environments.some((item) => item.status === 'active'),
      call: 'POST /api/environments',
    },
    { label: 'Agent', complete: agents.some((item) => item.status === 'active'), call: 'POST /api/agents' },
    { label: 'Session', complete: sessions.length > 0, call: 'POST /api/sessions' },
    {
      label: 'Integration',
      complete: sessions.some((item) => item.runtimeEndpointPath),
      call: 'GET /api/openapi.json',
    },
  ]
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>First run workflow</CardTitle>
          <CardDescription>Create the minimum resources required to run a Pi-backed session.</CardDescription>
        </CardHeader>
        <CardContent>
          <TableSurface>
            <TableHeader>
              <TableRow>
                <TableHead>Step</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>API contract</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {steps.map((step, index) => (
                <TableRow key={step.label}>
                  <TableCell className="font-medium">
                    {index + 1}. {step.label}
                  </TableCell>
                  <TableCell>
                    <StatusBadge value={step.complete ? 'complete' : 'pending'} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{step.call}</TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Button asChild variant="outline" size="sm">
                        <Link
                          to={
                            step.label === 'Provider'
                              ? '/providers'
                              : step.label === 'Environment'
                                ? '/environments'
                                : step.label === 'Agent'
                                  ? '/agents'
                                  : step.label === 'Session'
                                    ? '/sessions'
                                    : '/usage'
                          }
                        >
                          Open
                          <ExternalLink data-icon="inline-end" />
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </TableSurface>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Integration snippets</CardTitle>
          <CardDescription>
            Use the OpenAPI contract for control-plane automation and the session runtime endpoint for live traffic.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <JsonBlock
            value={
              'restish :/api/openapi.json\nprintf \'%s\\n\' \'{"agentId":"agent_abc123","environmentId":"env_abc123"}\' | restish post :/api/sessions\ncurl -X POST "$ORIGIN/api/sessions/{sessionId}/runtime"'
            }
          />
        </CardContent>
      </Card>
    </div>
  )
}
