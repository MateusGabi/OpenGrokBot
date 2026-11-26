// Registry of isolated offices. CommonJS so the CLI, the Electron shell and
// node:test can all share the same implementation without a build step.
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')

const INSTALL_ROOT = path.resolve(__dirname, '..')

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

async function createOffice(stateRoot, name) {
  const human = cleanName(name)
  const registry = loadOffices(stateRoot)
  uniqueName(registry, human)
  const id = slugify(human, new Set(registry.offices.map((o) => o.id)))
  const dir = path.resolve(stateRoot, 'offices', id)
  if (fs.existsSync(dir)) throw new OfficesError(`offices: ${dir} already exists`)
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true })
  fs.copyFileSync(path.join(INSTALL_ROOT, 'team.example.json'), path.join(dir, 'team.json'))
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
  startupId,
  officeEnv,
  officeUrl,
}
