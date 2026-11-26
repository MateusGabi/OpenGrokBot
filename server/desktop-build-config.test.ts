import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  main?: string
  scripts?: Record<string, string>
  build?: { appId?: string; productName?: string; files?: string[]; win?: { target?: string; icon?: string } }
  devDependencies?: Record<string, string>
}
const gitignore = readFileSync(path.join(root, '.gitignore'), 'utf8')

test('package is configured to build a Windows installer', () => {
  assert.equal(pkg.main, 'desktop/main.cjs')
  assert.match(pkg.scripts?.['build:desktop'] ?? '', /node desktop\/build\.cjs/)
  assert.ok(existsSync(path.join(root, 'desktop/build.cjs')), 'staged build wrapper must exist')
  assert.equal(pkg.build?.appId, 'com.opengrokbot.desktop')
  assert.equal(pkg.build?.productName, 'OpenGrokBot')
  assert.equal(pkg.build?.win?.target, 'nsis')
  assert.equal(pkg.build?.win?.icon, 'build/icon.png')
  assert.ok(pkg.build?.files?.includes('dist/**/*'), 'built client/server must be packaged')
  assert.ok(pkg.build?.files?.includes('team.example.json'), 'first-run seed must be at package root')
  assert.match(pkg.devDependencies?.['electron-builder'] ?? '', /^\^?26/)
  assert.match(gitignore, /^release\/$/m)
})
