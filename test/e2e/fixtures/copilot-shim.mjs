import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const chunks = []
for await (const chunk of process.stdin) {
  chunks.push(chunk)
}

const prompt = Buffer.concat(chunks).toString()
const receipt = {
  prompt,
  workspace: process.cwd(),
  sessionId: process.env.AMA_SESSION_ID,
  runtime: process.env.AMA_RUNTIME,
  provider: process.env.AMA_PROVIDER,
  model: process.env.AMA_MODEL,
  runtimeConfig: JSON.parse(process.env.AMA_RUNTIME_CONFIG ?? '{}'),
  amaWorkspace: process.env.AMA_WORKSPACE,
  hasAmaToken: Boolean(process.env.AMA_TOKEN),
  leakedToken: process.env.AMA_TOKEN ?? null,
  leakedOperatorSecret: process.env.AMA_RUNNER_OPERATOR_SECRET ?? null,
  home: process.env.HOME,
  tmpdir: process.env.TMPDIR,
}

writeFileSync(join(process.cwd(), 'copilot-shim-receipt.json'), JSON.stringify(receipt, null, 2))

const base = {
  sessionId: process.env.AMA_SESSION_ID,
  runtime: process.env.AMA_RUNTIME,
  runtimeDriver: process.env.AMA_RUNTIME_DRIVER,
  provider: process.env.AMA_PROVIDER,
  model: process.env.AMA_MODEL,
  workspace: process.env.AMA_WORKSPACE,
  runtimeConfig: { mode: receipt.runtimeConfig.mode },
}

console.log(JSON.stringify({ type: 'copilot.lifecycle', payload: { ...base, status: 'copilot-shim-started' } }))
console.log(
  JSON.stringify({
    type: 'copilot.message',
    payload: { message: { role: 'assistant', content: `received:${prompt}` } },
  }),
)
console.log(
  JSON.stringify({
    type: 'copilot.tool.started',
    payload: { toolCallId: 'copilot_tool_1', toolName: 'sandbox.exec', input: { command: 'printf copilot-tool' } },
  }),
)
console.log(
  JSON.stringify({
    type: 'copilot.tool.completed',
    payload: {
      toolCallId: 'copilot_tool_1',
      toolName: 'sandbox.exec',
      output: { stdout: 'copilot-tool', stderr: '', exitCode: 0 },
      durationMs: 4,
    },
  }),
)
console.log(
  JSON.stringify({
    type: 'copilot.usage',
    payload: { provider: process.env.AMA_PROVIDER, model: process.env.AMA_MODEL, promptTokens: 2, completionTokens: 3, totalTokens: 5 },
  }),
)
console.log('copilot stdout diagnostic')
console.log(
  JSON.stringify({
    type: 'copilot.error',
    payload: { error: { message: 'copilot shim safe error' }, code: 'shim_safe_error' },
  }),
)
console.error('copilot stderr diagnostic')
console.log(JSON.stringify({ type: 'copilot.lifecycle', payload: { ...base, status: 'copilot-shim-completed' } }))
