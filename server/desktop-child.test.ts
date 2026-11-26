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
