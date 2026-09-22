import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createStore } from '../server/utils/store.ts'

const fn = { slug: 'a-fn', code: 'return 1', allowWrite: false, exampleInput: { n: 1 }, inputSchema: { type: 'object' } }

test('save bumps version per slug, get round-trips JSON columns', () => {
  const s = createStore(':memory:')
  assert.equal(s.save(fn), 1)
  assert.equal(s.save({ ...fn, code: 'return 2', allowWrite: true }), 2)
  assert.equal(s.save({ ...fn, slug: 'b-fn' }), 1)
  const got = s.get('a-fn')!
  assert.deepEqual([got.code, got.version, got.allowWrite, got.exampleInput, got.inputSchema, got.description], ['return 2', 2, true, { n: 1 }, { type: 'object' }, undefined])
})

test('list omits code and is sorted; remove reports whether a row existed', () => {
  const s = createStore(':memory:')
  s.save({ ...fn, slug: 'b-fn' }); s.save(fn)
  assert.deepEqual(s.list().map(f => f.slug), ['a-fn', 'b-fn'])
  assert.ok(!('code' in s.list()[0]!))
  assert.equal(s.remove('a-fn'), true)
  assert.equal(s.remove('a-fn'), false)
  assert.equal(s.get('a-fn'), undefined)
})

test('data survives reopening the file', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'fn-')), 'nested', 'f.db')
  createStore(path).save(fn)
  assert.equal(createStore(path).get('a-fn')?.code, 'return 1')
})
