import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

function App() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <section className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6">
        <p className="text-sm font-medium uppercase tracking-wide text-cyan-300">Any Managed Agents</p>
        <h1 className="mt-4 max-w-3xl text-5xl font-semibold leading-tight">
          Workers-native control plane for managed agents.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-neutral-300">
          Built on Cloudflare Workers, Agents SDK, D1, Durable Objects, and executable product specs.
        </p>
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
