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

test('offices manager screen is self-contained and offline', () => {
  for (const file of ['offices.html', 'offices.css', 'offices.cjs', 'offices-preload.cjs']) {
    assert.ok(existsSync(path.join(root, 'desktop', file)), `desktop/${file} must exist`)
  }
  const html = readFileSync(path.join(root, 'desktop', 'offices.html'), 'utf8')
  const css = readFileSync(path.join(root, 'desktop', 'offices.css'), 'utf8')
  const preload = readFileSync(path.join(root, 'desktop', 'offices-preload.cjs'), 'utf8')
  assert.doesNotMatch(html + css, /https?:\/\//)
  assert.doesNotMatch(html + css, /@import/)
  for (const name of ['list', 'create', 'add', 'open', 'rename', 'remove', 'close']) {
    assert.match(preload, new RegExp(name))
  }
})

test('manager asks for a name when adding an existing office', () => {
  const renderer = readFileSync(path.join(root, 'desktop', 'offices.cjs'), 'utf8')
  assert.match(renderer, /\.add\(dir\.trim\(\), name\)/)
})

test('manager puts a focused new-office form above the list', () => {
  const html = readFileSync(path.join(root, 'desktop', 'offices.html'), 'utf8')
  const renderer = readFileSync(path.join(root, 'desktop', 'offices.cjs'), 'utf8')
  const css = readFileSync(path.join(root, 'desktop', 'offices.css'), 'utf8')
  assert.ok(html.indexOf('id="new"') < html.indexOf('id="list"'), 'create form must come before the office list')
  assert.match(html, /Create office/)
  assert.match(html, /data-theme="light"/)
  assert.match(css, /\[data-theme='light'\]/)
  assert.match(renderer, /input\.focus\(\)/)
  assert.match(renderer, /Escape/)
})
