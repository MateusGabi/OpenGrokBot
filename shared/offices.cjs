// Registry of isolated offices. CommonJS so the CLI, the Electron shell and
// node:test can all share the same implementation without a build step.
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const INSTALL_ROOT = path.resolve(__dirname, '..')
const INTRO = [
  "Hello! I'm Bot, the first Employee of this office. There's no one else here yet.",
  '',
  'First suggestion: check in Settings → Providers whether this office already has a provider and a model connected. Each office is isolated and does not inherit keys from the others — if no provider is active, configure a provider (Claude, Codex, Gemini, or an OpenAI-compatible one) or add an API key exclusive to this office.',
  '',
  'After that: which Employee should I create first, and what should that Employee do?',
].join('\n')

class OfficesError extends Error {}

function officesPath(stateRoot) {
  return path.join(stateRoot, 'offices.json')
}

function companyOf(dir) {
  try {
    const team = JSON.parse(fs.readFileSync(path.join(dir, 'team.json'), 'utf8'))
    if (typeof team.company === 'string' && team.company.trim()) return team.company.trim()
  } catch {
    // A missing or malformed team.json just means no human-readable name yet.
  }
  return 'Main office'
}

function saveOffices(stateRoot, data) {
  const target = officesPath(stateRoot)
  const tmp = `${target}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n')
  fs.renameSync(tmp, target)
}

function loadOffices(stateRoot) {
  const file = officesPath(stateRoot)
  if (!fs.existsSync(file)) {
    const registry = {
      version: 1,
      offices: [{ id: 'default', name: companyOf(stateRoot), dir: path.resolve(stateRoot), port: Number(process.env.PORT ?? 4310), createdAt: Date.now() }],
    }
    saveOffices(stateRoot, registry)
    return registry
  }
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    throw new OfficesError(`offices: ${file} is not valid JSON; fix it or move it aside`)
  }
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.offices)) {
    throw new OfficesError(`offices: ${file} has an unsupported registry format`)
  }
  return parsed
}

function cleanName(name) {
  if (typeof name !== 'string') throw new OfficesError('offices: name must be a string')
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 60) throw new OfficesError('offices: name must be 1–60 characters')
  return trimmed
}

function uniqueName(registry, name) {
  if (registry.offices.some((o) => o.name.toLowerCase() === name.toLowerCase())) {
    throw new OfficesError(`offices: an office named "${name}" already exists`)
  }
}

function slugify(name, taken) {
  let base = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  if (!base || base === 'default') base = 'office'
  let id = base
  let n = 2
  while (taken.has(id)) {
    const suffix = `-${n++}`
    id = `${base.slice(0, 40 - suffix.length)}${suffix}`
  }
  return id
}

function freePort(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
}

async function nextPort(registry) {
  const used = new Set(registry.offices.map((o) => o.port))
  let port = 4311
  while (used.has(port) || !(await freePort(port))) port++
  return port
}

function starterTeam(name) {
  const base = JSON.parse(fs.readFileSync(path.join(INSTALL_ROOT, 'team.example.json'), 'utf8'))
  const exampleAgents = Array.isArray(base.agents) ? base.agents : []
  const template = exampleAgents.find((a) => Array.isArray(a.tools) && a.tools.includes('Write')) ?? exampleAgents[0] ?? {}
  const bot = {
    ...template,
    id: 'bot',
    name: 'Bot',
    role: 'ASSISTANT',
    department: 'General',
    shape: 'blob',
    color: '#2f7ef5',
    provider: 'claude',
    model: 'default',
    effort: 'medium',
    tools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'],
    permissionMode: 'acceptEdits',
    mcpServers: [],
    inheritClaudeSettings: false,
    autoApproveTools: false,
    muted: false,
    approvals: 'auto',
    scope: 'onboarding: help decide which employee to create first and what that employee should do',
    personality: "You are Bot, the first employee of a brand new office. Your first suggestion is always to check whether this office has a provider and a model connected in Settings → Providers. Each office is isolated and does not inherit API keys from the others: if no provider is active, tell the owner to configure a provider or add an API key exclusive to this office before creating employees. Only then ask which employee to create next and what that employee should do. Keep replies short and friendly.",
  }
  return {
    company: name,
    owner: { id: 'user', name: 'You', title: 'CEO' },
    workspace: '.',
    agents: [bot],
    providers: base.providers ?? {},
    mcpServers: {},
    skills: {},
    settings: base.settings ?? {},
  }
}

function seedIntro(dataDir) {
  const conversations = path.join(dataDir, 'conversations')
  fs.mkdirSync(conversations, { recursive: true })
  const now = Date.now()
  const conversation = {
    id: 'group',
    kind: 'group',
    name: 'Team',
    memberIds: ['user', 'bot'],
    messages: [{ id: `intro-${randomUUID().slice(0, 8)}`, conversationId: 'group', authorId: 'bot', text: INTRO, createdAt: now, status: 'done' }],
    sessions: {},
    createdAt: now,
  }
  fs.writeFileSync(path.join(conversations, 'group.json'), JSON.stringify(conversation, null, 2) + '\n')
}

async function createOffice(stateRoot, name) {
  const human = cleanName(name)
  const registry = loadOffices(stateRoot)
  uniqueName(registry, human)
  const id = slugify(human, new Set(registry.offices.map((o) => o.id)))
  const dir = path.resolve(stateRoot, 'offices', id)
  if (fs.existsSync(dir)) throw new OfficesError(`offices: ${dir} already exists`)
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'team.json'), JSON.stringify(starterTeam(human), null, 2) + '\n')
  seedIntro(path.join(dir, 'data'))
  const entry = { id, name: human, dir, port: await nextPort(registry), createdAt: Date.now() }
  registry.offices.push(entry)
  saveOffices(stateRoot, registry)
  return entry
}

async function addOffice(stateRoot, dir, name) {
  const resolved = path.resolve(dir)
  if (!fs.existsSync(path.join(resolved, 'team.json'))) {
    throw new OfficesError(`offices: no team.json in ${resolved}`)
  }
  const human = cleanName(name ?? companyOf(resolved))
  const registry = loadOffices(stateRoot)
  uniqueName(registry, human)
  const id = slugify(human, new Set(registry.offices.map((o) => o.id)))
  const entry = { id, name: human, dir: resolved, port: await nextPort(registry), createdAt: Date.now() }
  registry.offices.push(entry)
  saveOffices(stateRoot, registry)
  return entry
}

function renameOffice(stateRoot, id, name) {
  const human = cleanName(name)
  const registry = loadOffices(stateRoot)
  const entry = registry.offices.find((o) => o.id === id)
  if (!entry) throw new OfficesError(`offices: unknown office "${id}"`)
  if (registry.offices.some((o) => o.id !== id && o.name.toLowerCase() === human.toLowerCase())) {
    throw new OfficesError(`offices: an office named "${human}" already exists`)
  }
  entry.name = human
  saveOffices(stateRoot, registry)
  return entry
}

function samePath(a, b) {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function removeOffice(stateRoot, id, opts = {}) {
  const registry = loadOffices(stateRoot)
  if (id === 'default') throw new OfficesError('offices: the default office cannot be removed')
  const index = registry.offices.findIndex((o) => o.id === id)
  if (index === -1) throw new OfficesError(`offices: unknown office "${id}"`)
  const entry = registry.offices[index]
  if (opts.deleteData === true && !samePath(path.resolve(entry.dir), path.resolve(stateRoot, 'offices', id))) {
    throw new OfficesError('offices: refusing to delete a directory outside offices/')
  }
  registry.offices.splice(index, 1)
  if (registry.lastId === id) delete registry.lastId
  saveOffices(stateRoot, registry)
  if (opts.deleteData === true) fs.rmSync(entry.dir, { recursive: true, force: true })
}

function assertOfficeDir(office) {
  if (!office || !fs.existsSync(office.dir)) {
    throw new OfficesError(`offices: directory "${office?.dir ?? ''}" is missing; restore it or remove the office`)
  }
}

function startupId(registry) {
  const exists = (entry) => !!entry && fs.existsSync(entry.dir)
  const last = registry.offices.find((o) => o.id === registry.lastId)
  if (exists(last)) return last.id
  const fallback = registry.offices.find((o) => o.id === 'default')
  return exists(fallback) ? fallback.id : null
}

function officeEnv(office) {
  return {
    PORT: String(office.port),
    OPENGROKBOT_TEAM: path.join(office.dir, 'team.json'),
    OPENGROKBOT_DATA: path.join(office.dir, 'data'),
  }
}

function officeUrl(office) {
  return `http://127.0.0.1:${office.port}/`
}

module.exports = {
  OfficesError,
  officesPath,
  loadOffices,
  saveOffices,
  nextPort,
  createOffice,
  addOffice,
  renameOffice,
  removeOffice,
  assertOfficeDir,
  startupId,
  officeEnv,
  officeUrl,
}
