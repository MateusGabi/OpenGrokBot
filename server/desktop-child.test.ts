import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const root = process.cwd()
const require = createRequire(path.join(root, 'package.json'))
const { childOptions } = require(path.join(root, 'desktop/child.cjs')) as {
  childOptions: (port: number, stateDir: string, baseEnv?: Record<string, string>) => { cwd: string; env: Record<string, string> }
}

test('packaged server gets a real cwd and writable state paths', () => {
  const stateDir = path.join(root, 'data', 'desktop-test')
  const opts = childOptions(4310, stateDir, { KEEP_ME: 'yes', ELECTRON_RUN_AS_NODE: '1' })
  assert.equal(opts.cwd, stateDir)
  assert.equal(opts.env.PORT, '4310')
  assert.equal(opts.env.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(opts.env.KEEP_ME, 'yes')
  assert.equal(opts.env.OPENGROKBOT_TEAM, path.join(stateDir, 'team.json'))
  assert.equal(opts.env.OPENGROKBOT_DATA, path.join(stateDir, 'data'))
})

test('electron shell surfaces spawn errors instead of only timing out', () => {
  const source = readFileSync(path.join(root, 'desktop/main.cjs'), 'utf8')
  assert.match(source, /server\.on\('error'/)
  assert.match(source, /childOptions\(/)
})

test('electron shell manages one server per office', () => {
  const source = readFileSync(path.join(root, 'desktop/main.cjs'), 'utf8')
  assert.match(source, /loadOffices\(/)
  assert.match(source, /startupId\(/)
  assert.match(source, /offices-preload\.cjs/)
  assert.match(source, /setApplicationMenu\(/)
  assert.match(source, /page-title-updated/)
})

test('bulk shutdown keeps lastId and remove validates before teardown', () => {
  const source = readFileSync(path.join(root, 'desktop/main.cjs'), 'utf8')
  assert.match(source, /function stopOffice\(id, closeWindow = true, resetLastId = true\)/)
  assert.match(source, /if \(resetLastId && registry\.lastId === id\)/)
  assert.match(source, /stopOffice\(id, true, true\)/)
  assert.match(source, /stopOffice\(id, false, false\)/)
  const handler = source.slice(source.indexOf("handle('remove'"))
  assert.ok(handler.indexOf('registryLib.removeOffice(') >= 0)
  assert.ok(handler.indexOf('registryLib.removeOffice(') < handler.indexOf('stopOffice('))
})

test('startup and open failures are shown to the user', () => {
  const source = readFileSync(path.join(root, 'desktop/main.cjs'), 'utf8')
  assert.match(source, /dialog\.showErrorBox\('OpenGrokBot', err instanceof Error/)
  assert.match(source, /registryLib\.assertOfficeDir\(office\)/)
})
