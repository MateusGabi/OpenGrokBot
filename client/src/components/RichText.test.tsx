/// <reference types="node" />
import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Team } from '../../../shared/types'
import { RichText } from './RichText'

const team = { agents: [], owner: { name: 'X' } } as unknown as Team
const render = (text: string) => renderToStaticMarkup(createElement(RichText, { text, team }))

test('a direct URL becomes an explicit link chip that opens a new tab', () => {
  const html = render('Veja https://example.com/docs')
  assert.match(html, /class="link-chip"/)
  assert.match(html, /href="https:\/\/example\.com\/docs"/)
  assert.match(html, /target="_blank"/)
  assert.match(html, /rel="noopener noreferrer"/)
  assert.match(html, /https:\/\/example\.com\/docs<\/span>/)
  assert.match(html, /<svg[^>]*aria-hidden="true"/)
})

test('punctuation after a URL stays visible outside the link', () => {
  const html = render('https://example.com/docs.')
  assert.match(html, /href="https:\/\/example\.com\/docs"/)
  assert.doesNotMatch(html, /href="https:\/\/example\.com\/docs\."/)
  assert.match(html, /<span>\.<\/span>/)
})

test('each direct URL in a reply gets its own chip', () => {
  const html = render('https://a.example/one e https://b.example/two')
  assert.equal(html.split('class="link-chip"').length - 1, 2)
})

test('URLs in inline and fenced code are not linked', () => {
  const inline = render('Use `https://example.com/code`')
  assert.match(inline, /<code>https:\/\/example\.com\/code<\/code>/)
  assert.doesNotMatch(inline, /link-chip/)

  const fenced = render('```\nhttps://example.com/fence\n```')
  assert.match(fenced, /<code>https:\/\/example\.com\/fence<\/code>/)
  assert.doesNotMatch(fenced, /link-chip/)
})

test('markdown links and absolute file paths keep their current rendering', () => {
  const markdown = render('[docs](https://example.com)')
  assert.doesNotMatch(markdown, /link-chip/)
  assert.match(markdown, /\[docs\]\(https:\/\/example\.com\)/)

  const file = render('/home/me/a.md')
  assert.match(file, /class="file-chip"/)
  assert.doesNotMatch(file, /link-chip/)
})

test('non-http schemes are not linked', () => {
  assert.doesNotMatch(render('ftp://example.com'), /link-chip/)
})
