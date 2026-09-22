import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildLitWidget } from '../server/utils/widget.ts'

test('encodes metadata that contains template literals and non-ASCII text', () => {
  const dangerousValue = 'uses `backticks`, ${interpolation}, "quotes", and Grüß Gott'
  const source = buildLitWidget({
    slug: 'dangerous-widget',
    description: dangerousValue,
    inputSchema: { properties: { [dangerousValue]: { type: 'string' } } },
    exampleInput: { [dangerousValue]: dangerousValue },
    url: `https://example.test/${dangerousValue}`,
  })

  assert.doesNotMatch(source, new RegExp(dangerousValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.doesNotMatch(source, /`/)
  assert.match(source, /import \{ LitElement \} from 'lit';/)
  assert.doesNotMatch(source, /html|css|styleImports/)
  const encodedDescription = Buffer.from(JSON.stringify(dangerousValue), 'utf8').toString('base64')
  assert.match(source, new RegExp(`const DESCRIPTION = decodeJson\\('${encodedDescription}'\\);`))

  const directory = mkdtempSync(join(tmpdir(), 'widget-source-'))
  try {
    const path = join(directory, 'widget.mjs')
    writeFileSync(path, source)
    execFileSync(process.execPath, ['--check', path])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
