import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const chunks = []
for await (const chunk of process.stdin) {
  chunks.push(chunk)
}

const prompt = Buffer.concat(chunks).toString()
const runtimeConfig = JSON.parse(process.env.AMA_RUNTIME_CONFIG ?? '{}')
const workspace = process.cwd()

writeFileSync(
  join(workspace, 'claude-code-shim-received.json'),
  JSON.stringify(
    {
      prompt,
      workspace,
      runtimeConfig,
      provider: process.env.AMA_PROVIDER,
      model: process.env.AMA_MODEL,
      runtime: process.env.AMA_RUNTIME,
      sessionId: process.env.AMA_SESSION_ID,
      workspaceEnv: process.env.AMA_WORKSPACE,
      leakedToken: process.env.AMA_TOKEN ?? null,
      leakedOperatorSecret: process.env.AMA_RUNNER_OPERATOR_SECRET ?? null,
      home: process.env.HOME,
      tmpdir: process.env.TMPDIR,
    },
    null,
    2,
  ),
)

const emit = (type, payload) => {
  process.stdout.write(`${JSON.stringify({ type, payload })}\n`)
}

emit('claude-code.lifecycle', { stage: 'shim_started', status: 'running' })
emit('claude-code.message', {
  message: {
    id: 'claude_shim_message',
    role: 'assistant',
    content: `Claude shim received: ${prompt}`,
  },
})
emit('claude-code.tool.started', {
  toolCall: {
    id: 'claude_shim_tool',
    name: 'sandbox.exec',
    input: { command: 'printf claude-tool-ok' },
  },
})
emit('claude-code.tool.completed', {
  toolCall: {
    id: 'claude_shim_tool',
    name: 'sandbox.exec',
    output: { stdout: 'claude-tool-ok', stderr: '', exitCode: 0 },
    durationMs: 1,
  },
})
emit('claude-code.usage', {
  provider: process.env.AMA_PROVIDER,
  model: process.env.AMA_MODEL,
  inputTokens: 11,
  outputTokens: 7,
  totalTokens: 18,
})
emit('claude-code.error', {
  error: { message: 'Claude shim safe diagnostic', code: 'shim_diagnostic' },
})

process.stdout.write('claude-code-shim-output\n')
process.stderr.write('claude-code-shim-stderr\n')
