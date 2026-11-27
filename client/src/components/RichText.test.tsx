/// <reference types="node" />
import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Team } from '../../../shared/types'
import { RichText } from './RichText'

const team = { agents: [], owner: { name: 'X' } } as unknown as Team
const render = (text: string) => renderToStaticMarkup(createElement(RichText, { text, team }))

type Chip = ReactElement<{ className?: string; onClick?: (event: { stopPropagation(): void }) => void }>

/** The renderer's components are pure, so its element tree can be walked without a DOM. */
function elements(node: ReactNode): ReactNode[] {
  if (node === null || node === undefined || typeof node === 'boolean') return []
  if (Array.isArray(node)) return node.flatMap(elements)
  if (typeof node === 'object' && 'props' in node) {
    const el = node as ReactElement<{ children?: ReactNode }>
    if (typeof el.type === 'function') {
      return elements((el.type as (props: typeof el.props) => ReactNode)(el.props))
    }
    return [el, ...elements(el.props.children)]
  }
  return [node]
}

function findChip(node: ReactNode): Chip | null {
  return (
    elements(node).find(
      (el): el is Chip => typeof el === 'object' && el !== null && 'props' in el && (el as Chip).props.className === 'link-chip',
    ) ?? null
  )
}

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

test('a URL in a bullet list is still a chip', () => {
  const html = render('- Veja https://example.com/docs')
  assert.match(html, /<ul class="chat-list">/)
  assert.match(html, /class="link-chip"/)
  assert.match(html, /href="https:\/\/example\.com\/docs"/)
})

test('clicking a chip does not bubble to a surrounding preview toggle', () => {
  const chip = findChip(createElement(RichText, { text: 'https://example.com/docs', team }))
  assert.ok(chip, 'expected a link chip')
  assert.equal(typeof chip.props.onClick, 'function')
  let stopped = 0
  chip.props.onClick?.({ stopPropagation: () => { stopped++ } })
  assert.equal(stopped, 1)
})
