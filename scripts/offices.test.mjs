import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const offices = require('../shared/offices.cjs')

function makeRoot(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ogb-offices-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('loadOffices cria o entry default a partir do team.json existente', (t) => {
  const root = makeRoot(t)
  const teamFile = path.join(root, 'team.json')
  const original = '{"company":"Acme"}\n'
  writeFileSync(teamFile, original)
  const previousPort = process.env.PORT
  delete process.env.PORT
  t.after(() => {
    if (previousPort === undefined) delete process.env.PORT
    else process.env.PORT = previousPort
  })
  const registry = offices.loadOffices(root)
  assert.equal(registry.offices.length, 1)
  assert.equal(registry.offices[0].id, 'default')
  assert.equal(registry.offices[0].name, 'Acme')
  assert.equal(registry.offices[0].dir, root)
  assert.equal(registry.offices[0].port, 4310)
  assert.equal(readFileSync(teamFile, 'utf8'), original)
})

test('createOffice gera slug, um único Bot e a mensagem de apresentação', async (t) => {
  const root = makeRoot(t)
  const a = await offices.createOffice(root, 'Clientê ACME')
  assert.equal(a.id, 'cliente-acme')
  assert.ok(existsSync(path.join(a.dir, 'team.json')))
  assert.ok(existsSync(path.join(a.dir, 'data')))
  assert.ok(a.port >= 4311)

  const team = JSON.parse(readFileSync(path.join(a.dir, 'team.json'), 'utf8'))
  assert.equal(team.agents.length, 1)
  assert.equal(team.agents[0].id, 'bot')
  assert.equal(team.agents[0].name, 'Bot')

  const groupFile = path.join(a.dir, 'data', 'conversations', 'group.json')
  assert.ok(existsSync(groupFile))
  const group = JSON.parse(readFileSync(groupFile, 'utf8'))
  assert.deepEqual(group.memberIds, ['user', 'bot'])
  assert.equal(group.messages.length, 1)
  assert.equal(group.messages[0].authorId, 'bot')
  assert.equal(group.messages[0].status, 'done')
  assert.match(group.messages[0].text, /primeiro Employee/i)

  const b = await offices.createOffice(root, 'Beta')
  assert.notEqual(b.port, a.port)
})

test('nomes de exibição duplicados são recusados', async (t) => {
  const root = makeRoot(t)
  await offices.createOffice(root, 'Beta')
  await assert.rejects(() => offices.createOffice(root, 'beta'), offices.OfficesError)
})

test('addOffice recupera um diretório removido sem apagar dados', async (t) => {
  const root = makeRoot(t)
  const created = await offices.createOffice(root, 'Temporário')
  const marker = path.join(created.dir, 'data', 'marker')
  writeFileSync(marker, 'keep me')
  offices.removeOffice(root, created.id)
  assert.ok(existsSync(marker))
  const back = await offices.addOffice(root, created.dir, 'Voltou')
  assert.equal(back.dir, created.dir)
  assert.ok(existsSync(marker))
  assert.equal(offices.loadOffices(root).offices.length, 2)
})

test('renameOffice preserva id e dir', async (t) => {
  const root = makeRoot(t)
  const a = await offices.createOffice(root, 'Antigo')
  const renamed = offices.renameOffice(root, a.id, 'Novo nome')
  assert.equal(renamed.id, a.id)
  assert.equal(renamed.dir, a.dir)
  assert.equal(renamed.name, 'Novo nome')
})

test('removeOffice recusa default e mantém arquivos por padrão', async (t) => {
  const root = makeRoot(t)
  assert.throws(() => offices.removeOffice(root, 'default'), offices.OfficesError)
  const a = await offices.createOffice(root, 'Descartável')
  offices.removeOffice(root, a.id)
  assert.ok(existsSync(a.dir))
})

test('deleteData recusa diretório fora de offices/', async (t) => {
  const root = makeRoot(t)
  const a = await offices.createOffice(root, 'Fora')
  const registry = offices.loadOffices(root)
  const outside = path.join(root, 'outside')
  mkdirSync(outside, { recursive: true })
  const sentinel = path.join(outside, 'keep.txt')
  writeFileSync(sentinel, 'safe')
  registry.offices.find((o) => o.id === a.id).dir = outside
  offices.saveOffices(root, registry)
  assert.throws(() => offices.removeOffice(root, a.id, { deleteData: true }), offices.OfficesError)
  assert.ok(existsSync(sentinel))
})

test('officeEnv e officeUrl apontam para o office', async (t) => {
  const root = makeRoot(t)
  const a = await offices.createOffice(root, 'Env')
  assert.equal(offices.officeEnv(a).OPENGROKBOT_TEAM, path.join(a.dir, 'team.json'))
  assert.equal(offices.officeEnv(a).OPENGROKBOT_DATA, path.join(a.dir, 'data'))
  assert.equal(offices.officeEnv(a).PORT, String(a.port))
  assert.equal(offices.officeUrl(a), `http://127.0.0.1:${a.port}/`)
})

test('startupId cai para default quando lastId é órfão', (t) => {
  const root = makeRoot(t)
  const registry = offices.loadOffices(root)
  assert.equal(offices.startupId({ ...registry, lastId: 'sumido' }), 'default')
  registry.offices.push({ id: 'fantasma', name: 'Ghost', dir: path.join(root, 'nao-existe'), port: 4399, createdAt: 1 })
  assert.equal(offices.startupId({ ...registry, lastId: 'fantasma' }), 'default')
  assert.equal(offices.startupId({ version: 1, offices: [] }), null)
})

test('registro corrompido gera OfficesError', (t) => {
  const root = makeRoot(t)
  writeFileSync(path.join(root, 'offices.json'), '{')
  assert.throws(() => offices.loadOffices(root), offices.OfficesError)
})

test('assertOfficeDir recusa um office cujo diretório desapareceu', async (t) => {
  const root = makeRoot(t)
  const office = await offices.createOffice(root, 'Sumido')
  rmSync(office.dir, { recursive: true, force: true })
  assert.throws(() => offices.assertOfficeDir(office), offices.OfficesError)
})
