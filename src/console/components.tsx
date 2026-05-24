import { Bot } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge as UiBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Table } from '@/components/ui/table'
import { cn } from '@/lib/utils'

export function FullscreenMessage({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-muted/40 px-6 text-foreground">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="mx-auto grid size-12 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Bot size={24} />
          </div>
          <CardTitle className="mt-2 text-xl">{title}</CardTitle>
          <CardDescription>{body}</CardDescription>
        </CardHeader>
        {action ? <CardFooter className="justify-center bg-transparent pt-0">{action}</CardFooter> : null}
      </Card>
    </main>
  )
}

export function NavButton({ icon, active, to, label }: NavProps) {
  return (
    <Button
      className="w-full justify-start"
      asChild
      variant={active ? 'default' : 'ghost'}
      aria-current={active ? 'page' : undefined}
    >
      <Link to={to}>
        {icon}
        {label}
      </Link>
    </Button>
  )
}

export function MobileNavButton({ icon, active, to, label }: NavProps) {
  return (
    <Button
      className="shrink-0"
      asChild
      variant={active ? 'default' : 'outline'}
      aria-current={active ? 'page' : undefined}
    >
      <Link to={to}>
        {icon}
        <span>{label}</span>
      </Link>
    </Button>
  )
}

export function DisabledNav({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm text-muted-foreground/70">
      {icon}
      {label}
    </div>
  )
}

export function StatusBadge({ value }: { value: string }) {
  const variant =
    value === 'error' || value === 'missing' || value === 'blocked'
      ? 'destructive'
      : value === 'archived' ||
          value === 'stopped' ||
          value === 'disabled' ||
          value === 'deleted' ||
          value === 'disconnected'
        ? 'secondary'
        : 'outline'
  return <UiBadge variant={variant}>{value}</UiBadge>
}

export function PageHeader({
  eyebrow,
  title,
  titleAccessory,
  description,
  actions,
}: {
  eyebrow?: string
  title: string
  titleAccessory?: ReactNode
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 border-b pb-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="truncate text-xs font-medium uppercase text-muted-foreground">{eyebrow}</p> : null}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-normal text-foreground">{title}</h1>
          {titleAccessory}
        </div>
        {description ? <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function TableSurface({
  children,
  className,
  tableClassName,
}: {
  children: ReactNode
  className?: string
  tableClassName?: string
}) {
  return (
    <div className={cn('overflow-hidden rounded-lg border bg-background', className)}>
      <div className="overflow-x-auto">
        <Table className={cn('min-w-[760px] table-fixed', tableClassName)}>{children}</Table>
      </div>
    </div>
  )
}

export function TableEmpty({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="h-24 px-4 text-center text-sm text-muted-foreground">
        {children}
      </td>
    </tr>
  )
}

export function DetailSection({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string | undefined
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {actions ? <CardAction className="flex flex-wrap gap-2">{actions}</CardAction> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export function MetaGrid({ children, columns = 2 }: { children: ReactNode; columns?: 2 | 4 }) {
  return <dl className={cn('grid gap-2 text-xs', columns === 4 ? 'md:grid-cols-4' : 'md:grid-cols-2')}>{children}</dl>
}

export function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/60 px-3 py-2">
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words font-mono text-[11px] text-foreground">{value}</dd>
    </div>
  )
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <Card className="min-h-64 justify-center border-dashed bg-background">
      <CardContent className="mx-auto flex max-w-md flex-col items-center gap-4 py-10 text-center">
        <div className="flex flex-col gap-2">
          <CardTitle className="text-lg">{title}</CardTitle>
          <CardDescription className="text-balance leading-6">{body}</CardDescription>
        </div>
        {action ? <div className="flex flex-wrap justify-center gap-2">{action}</div> : null}
      </CardContent>
    </Card>
  )
}

export function ConfirmAction({
  children,
  title,
  description,
  confirmLabel,
  onConfirm,
  open,
  onOpenChange,
  destructive = false,
}: {
  children?: ReactNode
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  destructive?: boolean
}) {
  return (
    <AlertDialog {...(open === undefined ? {} : { open })} {...(onOpenChange === undefined ? {} : { onOpenChange })}>
      {children ? <AlertDialogTrigger asChild>{children}</AlertDialogTrigger> : null}
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant={destructive ? 'destructive' : 'default'} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

interface NavProps {
  icon: ReactNode
  active: boolean
  to: string
  label: string
}
