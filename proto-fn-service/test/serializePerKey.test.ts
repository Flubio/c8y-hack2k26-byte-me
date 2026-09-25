import assert from 'node:assert/strict'
import test from 'node:test'
import { serializePerKey } from '../server/utils/serializePerKey.ts'

const tick = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

test('serializePerKey runs same-key tasks in call order, even if an earlier one is slower or fails', async () => {
  const order: string[] = []
  await Promise.allSettled([
    serializePerKey('a', async () => { await tick(20); order.push('a1'); throw new Error('boom') }),
    serializePerKey('a', async () => { order.push('a2') }),
    serializePerKey('b', async () => { order.push('b1') }),
  ])
  // b isn't blocked by a; a2 waits for a1 despite a1 being slow and rejecting
  assert.deepEqual(order, ['b1', 'a1', 'a2'])
})
