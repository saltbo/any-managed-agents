import {
  ArrowRight,
  Bot,
  Code2,
  DatabaseZap,
  LogOut,
  MessageSquare,
  PlugZap,
  Server,
  Settings,
  ShieldCheck,
  Vault,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MobileNavButton, NavButton } from '@/console/components'
import { api } from '@/lib/api'
import { useConsoleContext } from './console-context'

export function ConsoleShell({ children }: { children: ReactNode }) {
  const context = useConsoleContext()
  return (
    <main className="min-h-screen bg-muted/40 text-foreground">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r bg-background px-4 py-5 lg:flex">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Bot size={20} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">Any Managed Agents</p>
            <p className="truncate text-xs text-muted-foreground">{context.auth.project.name}</p>
          </div>
        </div>
        <DesktopNav />
        <UserMenu placement="sidebar" />
      </aside>

      <section className="lg:pl-64">
        <div className="border-b bg-background px-4 py-4 lg:hidden">
          <div className="mb-3 min-w-0">
            <p className="truncate text-sm font-medium">Any Managed Agents</p>
            <p className="truncate text-xs text-muted-foreground">Console</p>
          </div>
          <MobileNav />
        </div>

        <div className="p-4 pb-24 lg:p-8 lg:pb-24">
          <section className="mx-auto max-w-6xl space-y-4">{children}</section>
        </div>
        <UserMenu placement="mobile" />
      </section>
    </main>
  )
}

function DesktopNav() {
  const context = useConsoleContext()
  return (
    <nav className="mt-8 flex-1 space-y-1">
      <NavButton
        icon={<Code2 size={17} />}
        active={context.view === 'quickstart'}
        to="/quickstart"
        label="Quickstart"
      />
      <NavButton icon={<Bot size={17} />} active={context.view === 'agents'} to="/agents" label="Agents" />
      <NavButton
        icon={<Server size={17} />}
        active={context.view === 'environments'}
        to="/environments"
        label="Environments"
      />
      <NavButton
        icon={<MessageSquare size={17} />}
        active={context.view === 'sessions'}
        to="/sessions"
        label="Sessions"
      />
      <NavButton
        icon={<ShieldCheck size={17} />}
        active={context.view === 'providers'}
        to="/providers"
        label="Providers"
      />
      <NavButton icon={<Vault size={17} />} active={context.view === 'vaults'} to="/vaults" label="Vaults" />
      <NavButton icon={<PlugZap size={17} />} active={context.view === 'mcp'} to="/mcp" label="MCP" />
      <NavButton icon={<Code2 size={17} />} active={context.view === 'usage'} to="/usage" label="Usage" />
      <NavButton icon={<DatabaseZap size={17} />} active={context.view === 'audit'} to="/audit" label="Audit" />
      <NavButton icon={<Settings size={17} />} active={context.view === 'settings'} to="/settings" label="Settings" />
    </nav>
  )
}

function UserMenu({ placement }: { placement: 'sidebar' | 'mobile' }) {
  const context = useConsoleContext()
  const userName = context.auth.user.name || context.auth.user.email
  const isSidebar = placement === 'sidebar'
  const containerClassName = isSidebar ? 'mt-4 border-t pt-3' : 'fixed bottom-4 left-4 z-20 lg:hidden'
  const triggerClassName =
    placement === 'sidebar'
      ? 'h-12 w-full justify-start gap-3 border-0 bg-transparent px-2 text-left shadow-none ring-0 hover:bg-muted focus-visible:border-0 focus-visible:ring-0 aria-expanded:bg-muted'
      : 'h-11 gap-3 bg-background shadow-sm'
  const triggerVariant = isSidebar ? 'ghost' : 'outline'
  const contentSide = isSidebar ? 'right' : 'top'
  const contentAlign = isSidebar ? 'end' : 'start'

  return (
    <div className={containerClassName}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant={triggerVariant} className={triggerClassName}>
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-xs font-medium text-primary-foreground">
              {userName.slice(0, 1).toUpperCase()}
            </span>
            <span className="hidden min-w-0 flex-1 text-left sm:block">
              <span className="block truncate text-sm font-medium">{userName}</span>
              <span className="block truncate text-xs text-muted-foreground">{context.auth.organization.name}</span>
            </span>
            {isSidebar ? <ArrowRight size={15} className="ml-auto text-muted-foreground" /> : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={contentAlign} side={contentSide} sideOffset={10} className="w-64">
          <DropdownMenuLabel>
            <span className="block truncate text-sm font-medium text-foreground">{userName}</span>
            <span className="block truncate font-normal">{context.auth.user.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void api.logout().then(() => window.location.assign('/agents'))}>
            <LogOut size={16} />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function MobileNav() {
  const context = useConsoleContext()
  return (
    <nav className="flex gap-2 overflow-x-auto pb-1 lg:hidden" aria-label="Primary">
      <MobileNavButton
        icon={<Code2 size={16} />}
        active={context.view === 'quickstart'}
        to="/quickstart"
        label="Quickstart"
      />
      <MobileNavButton icon={<Bot size={16} />} active={context.view === 'agents'} to="/agents" label="Agents" />
      <MobileNavButton
        icon={<Server size={16} />}
        active={context.view === 'environments'}
        to="/environments"
        label="Environments"
      />
      <MobileNavButton
        icon={<MessageSquare size={16} />}
        active={context.view === 'sessions'}
        to="/sessions"
        label="Sessions"
      />
      <MobileNavButton
        icon={<ShieldCheck size={16} />}
        active={context.view === 'providers'}
        to="/providers"
        label="Providers"
      />
      <MobileNavButton icon={<Vault size={16} />} active={context.view === 'vaults'} to="/vaults" label="Vaults" />
      <MobileNavButton icon={<PlugZap size={16} />} active={context.view === 'mcp'} to="/mcp" label="MCP" />
      <MobileNavButton icon={<Code2 size={16} />} active={context.view === 'usage'} to="/usage" label="Usage" />
      <MobileNavButton icon={<DatabaseZap size={16} />} active={context.view === 'audit'} to="/audit" label="Audit" />
      <MobileNavButton
        icon={<Settings size={16} />}
        active={context.view === 'settings'}
        to="/settings"
        label="Settings"
      />
    </nav>
  )
}
