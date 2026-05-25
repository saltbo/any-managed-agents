import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const extraTags = readExtraTags(process.argv.slice(2))
const tagExpression = ['@implemented', 'not @planned', extraTags].filter(Boolean).join(' and ')
const nodeOptions = [process.env.NODE_OPTIONS, '--import tsx'].filter(Boolean).join(' ')

assertImplementedTagDiscipline()

const result = spawnSync(
  'node_modules/.bin/cucumber-js',
  [
    '--tags',
    tagExpression,
    '--dry-run',
    '--format',
    'summary',
    '--import',
    'test/e2e/**/*.steps.ts',
    'specs/product/**/*.feature',
  ],
  {
    cwd: process.cwd(),
    env: { ...process.env, NODE_OPTIONS: nodeOptions },
    encoding: 'utf8',
  },
)

if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)

if (result.error) {
  throw result.error
}

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

if (/^0 scenarios\b/m.test(result.stdout)) {
  console.error(`No implemented scenarios matched tag expression: ${tagExpression}`)
  process.exit(1)
}

function readExtraTags(args: string[]) {
  const tagsIndex = args.indexOf('--tags')
  if (tagsIndex === -1) return ''
  const tags = args[tagsIndex + 1]
  if (!tags) {
    throw new Error('--tags requires a Cucumber tag expression')
  }
  return `(${tags})`
}

function assertImplementedTagDiscipline() {
  const errors: string[] = []
  for (const scenario of readProductScenarios()) {
    const effectiveTags = new Set([...scenario.featureTags, ...scenario.scenarioTags])
    const isImplemented = effectiveTags.has('@implemented')
    const isPlanned = effectiveTags.has('@planned')
    const isActive = !isPlanned

    if (scenario.featureTags.has('@implemented')) {
      errors.push(
        `${scenario.path}:${scenario.line} "${scenario.name}" inherits @implemented from the feature; mark implementation status on the scenario instead`,
      )
    }

    if (scenario.featureTags.has('@planned')) {
      errors.push(
        `${scenario.path}:${scenario.line} "${scenario.name}" inherits @planned from the feature; mark implementation status on the scenario instead`,
      )
    }

    if (isImplemented && isPlanned) {
      errors.push(
        `${scenario.path}:${scenario.line} "${scenario.name}" has both @implemented and @planned through effective tags`,
      )
    }

    if (isActive && !isImplemented) {
      errors.push(`${scenario.path}:${scenario.line} "${scenario.name}" is active but is missing @implemented`)
    }
  }

  if (errors.length === 0) return

  console.error('Implemented spec tag discipline failed:')
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

function readProductScenarios() {
  const specsDir = join(process.cwd(), 'specs/product')
  const scenarios: Array<{
    path: string
    line: number
    name: string
    featureTags: Set<string>
    scenarioTags: string[]
    steps: string[]
  }> = []

  for (const file of readdirSync(specsDir).filter((name) => name.endsWith('.feature')).sort()) {
    const path = join('specs/product', file)
    const lines = readFileSync(join(specsDir, file), 'utf8').split(/\r?\n/)
    let featureTags: string[] = []
    let pendingTags: string[] = []
    let currentScenario: (typeof scenarios)[number] | undefined

    lines.forEach((line, index) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('@')) {
        pendingTags = pendingTags.concat(trimmed.split(/\s+/).filter((tag) => tag.startsWith('@')))
        return
      }
      if (trimmed.startsWith('Feature:')) {
        featureTags = pendingTags
        pendingTags = []
        return
      }
      if (/^(Scenario|Scenario Outline):/.test(trimmed)) {
        currentScenario = {
          path,
          line: index + 1,
          name: trimmed.replace(/^(Scenario|Scenario Outline):\s*/, ''),
          featureTags: new Set(featureTags),
          scenarioTags: pendingTags,
          steps: [],
        }
        scenarios.push(currentScenario)
        pendingTags = []
        return
      }
      const stepMatch = trimmed.match(/^(Given|When|Then|And|But)\s+(.+)$/)
      if (stepMatch && currentScenario) {
        currentScenario.steps.push(stepMatch[2])
        return
      }
      if (trimmed !== '' && !trimmed.startsWith('#')) {
        pendingTags = []
      }
    })
  }

  return scenarios
}
