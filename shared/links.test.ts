import test from 'node:test'
import assert from 'node:assert/strict'
import { linkFromToken } from './links.js'

test('direct http and https URLs are returned unchanged', () => {
  for (const url of ['https://example.com/docs', 'http://example.com', 'HTTPS://Example.com/A']) {
    assert.equal(linkFromToken(url), url)
  }
})

test('sentence punctuation after a URL is not part of the link', () => {
  assert.equal(linkFromToken('https://example.com/docs.'), 'https://example.com/docs')
  assert.equal(linkFromToken('https://example.com/a),'), 'https://example.com/a')
  assert.equal(linkFromToken('https://en.wikipedia.org/wiki/Foo_(bar)'), 'https://en.wikipedia.org/wiki/Foo_(bar)')
})

test('non-http text and malformed URLs are not links', () => {
  for (const token of ['/home/me/a.md', 'ftp://example.com', 'javascript:alert(1)', 'mailto:a@b.co', 'https://', '']) {
    assert.equal(linkFromToken(token), null)
  }
})
