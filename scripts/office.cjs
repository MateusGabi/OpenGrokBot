// Manage isolated offices from the terminal. Each office owns a state dir and
// a server process; the registry itself never holds secrets.
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const offices = require('../shared/offices.cjs')

const stateRoot = path.resolve(process.env.OPENGROKBOT_STATE_ROOT ?? process.cwd())
const USAGE = 'usage: office <list|create <name>|open <id>|add <dir> [name]|rename <id> <new name>|remove <id> [--delete-data]>'

function line(entry, verb) {
  console.log(`${verb} ${entry.id}  ${entry.name}  ${entry.port}  ${entry.dir}`)
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  const registry = offices.loadOffices(stateRoot)
  switch (command) {
    case 'list':
      for (const office of registry.offices) console.log(`${office.id}  ${office.name}  ${office.port}  ${office.dir}`)
      break
    case 'create': {
      const entry = await offices.createOffice(stateRoot, args.join(' '))
      line(entry, 'created')
      console.log(`open it with: npm run office -- open ${entry.id}`)
      break
    }
    case 'open': {
      const id = args[0]
      const entry = registry.offices.find((o) => o.id === id)
      if (!entry) throw new offices.OfficesError(`offices: unknown office "${id}"`)
      const script = path.resolve(__dirname, '..', 'dist', 'server', 'index.js')
      if (!fs.existsSync(script)) throw new Error('build first: npm run build')
      registry.lastId = id
      offices.saveOffices(stateRoot, registry)
      const child = spawn(process.execPath, [script], { cwd: entry.dir, env: { ...process.env, ...offices.officeEnv(entry) }, stdio: 'inherit' })
      child.on('exit', (code) => process.exit(code ?? 0))
      break
    }
    case 'add': {
      const [dir, ...rest] = args
      if (!dir) throw new offices.OfficesError('offices: add needs a directory')
      line(await offices.addOffice(stateRoot, dir, rest.join(' ') || undefined), 'added')
      break
    }
    case 'rename':
      line(offices.renameOffice(stateRoot, args[0], args.slice(1).join(' ')), 'renamed')
      break
    case 'remove': {
      const id = args[0]
      offices.removeOffice(stateRoot, id, { deleteData: args.includes('--delete-data') })
      console.log(`removed ${id}`)
      break
    }
    default:
      console.error(USAGE)
      process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})
