import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
