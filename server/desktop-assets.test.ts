import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()

test('desktop icon assets exist and are usable', () => {
  const png = readFileSync(path.join(root, 'build/icon.png'))
  assert.equal(png.subarray(1, 4).toString(), 'PNG')
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  assert.ok(width >= 256 && height >= 256, `icon must be at least 256px, got ${width}x${height}`)

  const svg = readFileSync(path.join(root, 'client/public/icon.svg'), 'utf8')
  assert.equal((svg.match(/<ellipse\b/g) ?? []).length, 2, 'logo must have exactly two eyes')
  assert.ok(!svg.includes('<path'), 'logo must not keep the old smile')

  const html = readFileSync(path.join(root, 'client/index.html'), 'utf8')
  assert.match(html, /href="\/icon\.svg"/)
  assert.ok(!html.includes('data:image/svg+xml'), 'inline orange favicon must be gone')
})

test('offices bridge exposes only the needed calls and an open notification', () => {
  const preload = readFileSync(path.join(root, 'desktop', 'offices-preload.cjs'), 'utf8')
  assert.doesNotMatch(preload, /https?:\/\//)
  for (const name of ['list', 'create', 'add', 'open', 'rename', 'remove', 'close', 'onOpen']) {
    assert.match(preload, new RegExp(name))
  }
  assert.match(preload, /exposeInMainWorld\('offices', api\)/)
})

test('office manager lives inside the React app', () => {
  const component = readFileSync(path.join(root, 'client', 'src', 'components', 'Offices.tsx'), 'utf8')
  const app = readFileSync(path.join(root, 'client', 'src', 'App.tsx'), 'utf8')
  const css = readFileSync(path.join(root, 'client', 'src', 'features.css'), 'utf8')
  const bridge = readFileSync(path.join(root, 'client', 'src', 'offices.ts'), 'utf8')
  assert.match(app, /<Offices onClose=/)
  assert.match(app, /officesOpen/)
  assert.match(component, /Quick find/)
  assert.match(component, /New office/)
  assert.match(component, /Create office/)
  assert.match(component, /api\.add\(dir\.trim\(\), name\.trim\(\)\)/)
  assert.match(bridge, /onOpen\(callback: \(\) => void\): \(\) => void/)
  assert.match(css, /\.offices-modal/)
  assert.match(css, /grid-template-columns: 248px 1fr/)
})

test('desktop opens the manager inside the focused window, not in a new one', () => {
  const main = readFileSync(path.join(root, 'desktop', 'main.cjs'), 'utf8')
  assert.doesNotMatch(main, /openManager/)
  assert.doesNotMatch(main, /offices\.html/)
  assert.match(main, /preload: path\.join\(__dirname, 'offices-preload\.cjs'\)/)
  assert.match(main, /webContents\.send\('offices:open'\)/)
})

test('separate manager screen files are gone', () => {
  for (const file of ['offices.html', 'offices.css', 'offices.cjs']) {
    assert.ok(!existsSync(path.join(root, 'desktop', file)), `desktop/${file} should not exist`)
  }
})
