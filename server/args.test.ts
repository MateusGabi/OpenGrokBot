import test from 'node:test'
import assert from 'node:assert/strict'
import { formatArgs, parseArgs } from '../shared/args.js'

test('marketplace arguments with spaces survive an edit round-trip', () => {
  const args = ['-y', '@modelcontextprotocol/server-filesystem', 'e:/fortune projects']
  assert.deepEqual(parseArgs(formatArgs(args)), args)
  assert.deepEqual(parseArgs(formatArgs(['mcp-server-sqlite', '--db-path', 'e:/fortune projects/app.db'])), ['mcp-server-sqlite', '--db-path', 'e:/fortune projects/app.db'])
})

test('arguments can use single or double quotes', () => {
  assert.deepEqual(parseArgs(`-y pkg "two words" 'three word path'`), ['-y', 'pkg', 'two words', 'three word path'])
  assert.deepEqual(parseArgs(''), [])
})
