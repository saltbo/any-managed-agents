import { GovernanceView } from '@/console/views'
import { useConsoleContext } from '@/features/console/console-context'

export function SettingsPage() {
  const context = useConsoleContext()
  return <GovernanceView policy={context.governancePolicy} />
}
