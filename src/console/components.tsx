import { Bot } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

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

export function Banner({ tone, message }: { tone: 'success' | 'error'; message: string }) {
  return (
    <Alert
      variant={tone === 'error' ? 'destructive' : 'default'}
      className={tone === 'success' ? 'border-emerald-200' : undefined}
    >
      <AlertDescription>{message}</AlertDescription>
    </Alert>
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

export function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/60 px-3 py-2">
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words font-mono text-[11px] text-foreground">{value}</dd>
    </div>
  )
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Card className="grid min-h-64 place-items-center border-dashed bg-background text-center">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription className="max-w-md">{body}</CardDescription>
      </CardHeader>
    </Card>
  )
}

export function ConfirmAction({
  children,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive = false,
}: {
  children: ReactNode
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void
  destructive?: boolean
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
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
