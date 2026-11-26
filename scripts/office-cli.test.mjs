import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const cli = path.join(process.cwd(), 'scripts', 'office.cjs')

function run(stateDir, ...args) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, OPENGROKBOT_STATE_ROOT: stateDir },
  })
}

function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ogb-cli-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(path.join(dir, 'team.json'), '{"company":"Acme"}\n')
  return dir
}

test('list imprime o office default com a empresa do team.json', (t) => {
  const dir = fixture(t)
  const result = run(dir, 'list')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /default/)
  assert.match(result.stdout, /Acme/)
})

test('create cria o office e imprime o id', (t) => {
  const dir = fixture(t)
  const result = run(dir, 'create', 'Beta')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /\bbeta\b/)
  assert.match(run(dir, 'list').stdout, /Beta/)
})

test('rename atualiza o nome do office', (t) => {
  const dir = fixture(t)
  assert.equal(run(dir, 'create', 'Beta').status, 0)
  const result = run(dir, 'rename', 'beta', 'Beta Dois')
  assert.equal(result.status, 0, result.stderr)
  assert.match(run(dir, 'list').stdout, /Beta Dois/)
})

test('remove mantém os dados e add traz o office de volta', (t) => {
  const dir = fixture(t)
  assert.equal(run(dir, 'create', 'Temporario').status, 0)
  const listed = run(dir, 'list').stdout.split('\n').find((line) => /\btemporario\b/.test(line))
  assert.ok(listed, 'office temporario should be listed')
  const officeDir = listed.trim().split(/\s{2,}/).at(-1)
  assert.ok(existsSync(path.join(officeDir, 'team.json')))
  assert.equal(run(dir, 'remove', 'temporario').status, 0)
  assert.ok(existsSync(path.join(officeDir, 'team.json')))
  const added = run(dir, 'add', officeDir, 'De volta')
  assert.equal(added.status, 0, added.stderr)
  assert.match(run(dir, 'list').stdout, /De volta/)
})

test('comando desconhecido falha com usage', (t) => {
  const dir = fixture(t)
  const result = run(dir, 'explode')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /usage:/)
})
