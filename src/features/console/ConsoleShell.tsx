import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  Bot,
  Boxes,
  Code2,
  DatabaseZap,
  LogOut,
  MessageSquare,
  PlugZap,
  Server,
  Settings,
  Vault,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MobileNavButton, NavButton } from '@/console/components'
import { signOut } from '@/lib/oidc'
import { useConsoleContext } from './console-context'

export function ConsoleShell({ children }: { children: ReactNode }) {
  const context = useConsoleContext()
  const queryClient = useQueryClient()
  const location = useLocation()
  const fullBleed = /^\/sessions\/[^/]+/.test(location.pathname)
  function selectProject(projectId: string) {
    context.selectProject(projectId)
    void queryClient.invalidateQueries()
  }
  return (
    <main className="min-h-screen bg-muted/40 text-foreground">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r bg-background px-4 py-5 lg:flex">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Bot size={20} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">Any Managed Agents</p>
            <Select value={context.auth.project.id} onValueChange={selectProject}>
              <SelectTrigger
                size="sm"
                className="mt-1 max-w-44 border-0 px-0 text-xs text-muted-foreground shadow-none"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {context.projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
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

        <div
          data-console-content={fullBleed ? 'full-bleed' : 'contained'}
          className={fullBleed ? 'p-0' : 'p-4 pb-24 lg:p-8 lg:pb-24'}
        >
          <section
            data-console-surface={fullBleed ? 'full-bleed' : 'contained'}
            className={fullBleed ? 'min-w-0' : 'mx-auto max-w-6xl space-y-4'}
          >
            {children}
          </section>
        </div>
        <UserMenu placement="mobile" />
      </section>
    </main>
  )
}

function DesktopNav() {
  return (
    <nav className="mt-8 flex-1 space-y-1">
      <NavButton icon={<Code2 size={17} />} to="/quickstart" label="Quickstart" />
      <NavButton icon={<Bot size={17} />} to="/agents" label="Agents" />
      <NavButton icon={<Server size={17} />} to="/environments" label="Environments" />
      <NavButton icon={<MessageSquare size={17} />} to="/sessions" label="Sessions" />
      <NavButton icon={<Boxes size={17} />} to="/providers" label="Providers" />
      <NavButton icon={<Vault size={17} />} to="/vaults" label="Vaults" />
      <NavButton icon={<PlugZap size={17} />} to="/mcp" label="MCP" />
      <NavButton icon={<Code2 size={17} />} to="/usage" label="Usage" />
      <NavButton icon={<DatabaseZap size={17} />} to="/audit" label="Audit" />
      <NavButton icon={<Settings size={17} />} to="/settings" label="Settings" />
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
          <DropdownMenuItem onSelect={() => void signOut()}>
            <LogOut size={16} />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function MobileNav() {
  return (
    <nav className="flex gap-2 overflow-x-auto pb-1 lg:hidden" aria-label="Primary">
      <MobileNavButton icon={<Code2 size={16} />} to="/quickstart" label="Quickstart" />
      <MobileNavButton icon={<Bot size={16} />} to="/agents" label="Agents" />
      <MobileNavButton icon={<Server size={16} />} to="/environments" label="Environments" />
      <MobileNavButton icon={<MessageSquare size={16} />} to="/sessions" label="Sessions" />
      <MobileNavButton icon={<Boxes size={16} />} to="/providers" label="Providers" />
      <MobileNavButton icon={<Vault size={16} />} to="/vaults" label="Vaults" />
      <MobileNavButton icon={<PlugZap size={16} />} to="/mcp" label="MCP" />
      <MobileNavButton icon={<Code2 size={16} />} to="/usage" label="Usage" />
      <MobileNavButton icon={<DatabaseZap size={16} />} to="/audit" label="Audit" />
      <MobileNavButton icon={<Settings size={16} />} to="/settings" label="Settings" />
    </nav>
  )
}
