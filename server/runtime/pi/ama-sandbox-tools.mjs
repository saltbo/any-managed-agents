import { spawn } from 'node:child_process'

const sandboxExecSchema = {
  type: 'object',
  properties: {
    command: { type: 'string', description: 'Shell command to execute in the AMA Cloudflare Sandbox workspace.' },
    timeout: { type: 'number', description: 'Timeout in seconds.' },
  },
  required: ['command'],
  additionalProperties: false,
}

export default function amaSandboxTools(pi) {
  pi.registerTool({
    name: 'sandbox.exec',
    label: 'sandbox.exec',
    description:
      'Execute a shell command in the AMA Cloudflare Sandbox workspace. Returns stdout and stderr. A non-zero exit code is an error.',
    promptSnippet: 'Execute approved shell commands inside the AMA Cloudflare Sandbox',
    promptGuidelines: [
      'Use sandbox.exec when the user asks to run a shell command or inspect the sandbox environment.',
      'Use sandbox.exec instead of bash for shell command requests in AMA sessions.',
    ],
    parameters: sandboxExecSchema,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      return await execSandboxCommand(params.command, {
        cwd: ctx.cwd,
        signal,
        timeoutSeconds: params.timeout,
        onUpdate,
      })
    },
  })
}

async function execSandboxCommand(command, options) {
  const startedAt = Date.now()
  let output = ''
  const child = spawn('sh', ['-lc', command], {
    cwd: options.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let timedOut = false
  const publish = (chunk) => {
    output += chunk.toString('utf8')
    options.onUpdate?.({
      content: [{ type: 'text', text: output || '(no output)' }],
      details: { command, elapsedMs: Date.now() - startedAt },
    })
  }
  child.stdout?.on('data', publish)
  child.stderr?.on('data', publish)

  let timeout
  if (typeof options.timeoutSeconds === 'number' && options.timeoutSeconds > 0) {
    timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, options.timeoutSeconds * 1000)
  }
  const abort = () => child.kill('SIGTERM')
  options.signal?.addEventListener('abort', abort, { once: true })

  try {
    const { code, signal } = await waitForExit(child)
    const durationMs = Date.now() - startedAt
    const text = output || '(no output)'
    if (options.signal?.aborted) {
      throw new Error(`${text}\n\nCommand aborted`)
    }
    if (timedOut) {
      throw new Error(`${text}\n\nCommand timed out after ${options.timeoutSeconds} seconds`)
    }
    if (code !== 0) {
      const suffix = signal ? `signal ${signal}` : `code ${code}`
      throw new Error(`${text}\n\nCommand exited with ${suffix}`)
    }
    return {
      content: [{ type: 'text', text }],
      details: { command, exitCode: code, durationMs },
    }
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
    options.signal?.removeEventListener('abort', abort)
  }
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code, signal) => resolve({ code: code ?? (signal ? 128 : 0), signal }))
  })
}
