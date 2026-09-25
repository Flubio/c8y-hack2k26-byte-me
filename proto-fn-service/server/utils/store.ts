import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export interface FnDef {
  slug: string
  code: string
  description?: string
  inputSchema?: unknown
  exampleInput?: unknown
  exampleOutput?: unknown
  allowWrite: boolean
  version: number
  updatedAt: string
}
export type FnMeta = Omit<FnDef, 'code'>

interface Row {
  slug: string
  code: string
  description: string | null
  input_schema: string | null
  example_input: string | null
  example_output: string | null
  allow_write: number
  version: number
  updated_at: string
}

const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v))
const parse = (s: string | null) => (s === null ? undefined : JSON.parse(s) as unknown)
const toDef = (r: Row): FnDef => ({
  slug: r.slug,
  code: r.code,
  description: r.description ?? undefined,
  inputSchema: parse(r.input_schema),
  exampleInput: parse(r.example_input),
  exampleOutput: parse(r.example_output),
  allowWrite: r.allow_write === 1,
  version: r.version,
  updatedAt: r.updated_at,
})

/** SQLite-backed function store. `path` may be `:memory:`. */
export function createStore(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS functions (
      slug           TEXT PRIMARY KEY,
      code           TEXT NOT NULL,
      description    TEXT,
      input_schema   TEXT,
      example_input  TEXT,
      example_output TEXT,
      allow_write    INTEGER NOT NULL DEFAULT 0,
      version        INTEGER NOT NULL,
      updated_at     TEXT NOT NULL
    ) STRICT;
  `)

  const list = db.prepare('SELECT * FROM functions ORDER BY slug')
  const get = db.prepare('SELECT * FROM functions WHERE slug = ?')
  const del = db.prepare('DELETE FROM functions WHERE slug = ?')
  // only used to refill an empty container from tenant options; never clobbers a live row
  const insertIfMissing = db.prepare(`
    INSERT OR IGNORE INTO functions (slug, code, description, input_schema, example_input, example_output, allow_write, version, updated_at)
    VALUES (:slug, :code, :description, :input_schema, :example_input, :example_output, :allow_write, :version, :updated_at)
  `)
  // the version bump happens in SQL, so a redeploy of the same slug is atomic
  const upsert = db.prepare(`
    INSERT INTO functions (slug, code, description, input_schema, example_input, example_output, allow_write, version, updated_at)
    VALUES (:slug, :code, :description, :input_schema, :example_input, :example_output, :allow_write, 1, :updated_at)
    ON CONFLICT (slug) DO UPDATE SET
      code = excluded.code,
      description = excluded.description,
      input_schema = excluded.input_schema,
      example_input = excluded.example_input,
      example_output = excluded.example_output,
      allow_write = excluded.allow_write,
      version = functions.version + 1,
      updated_at = excluded.updated_at
    RETURNING version
  `)

  return {
    list: (): FnMeta[] => (list.all() as unknown as Row[]).map(toDef).map(({ code: _code, ...meta }) => meta),
    get: (slug: string): FnDef | undefined => {
      const row = get.get(slug) as unknown as Row | undefined
      return row && toDef(row)
    },
    remove: (slug: string) => Number(del.run(slug).changes) > 0,
    /** Insert or replace by slug; returns the new version. */
    save: (fn: Omit<FnDef, 'version' | 'updatedAt'>): number => {
      const row = upsert.get({
        slug: fn.slug,
        code: fn.code,
        description: fn.description ?? null,
        input_schema: json(fn.inputSchema),
        example_input: json(fn.exampleInput),
        example_output: json(fn.exampleOutput),
        allow_write: fn.allowWrite ? 1 : 0,
        updated_at: new Date().toISOString(),
      }) as { version: number }
      return row.version
    },
    /** Insert a function exactly as given (incl. version/updatedAt) unless the slug already exists. */
    restore: (fn: FnDef) => {
      insertIfMissing.run({
        slug: fn.slug,
        code: fn.code,
        description: fn.description ?? null,
        input_schema: json(fn.inputSchema),
        example_input: json(fn.exampleInput),
        example_output: json(fn.exampleOutput),
        allow_write: fn.allowWrite ? 1 : 0,
        version: fn.version,
        updated_at: fn.updatedAt,
      })
    },
  }
}

export type Store = ReturnType<typeof createStore>

// Container filesystem is ephemeral on Cumulocity: the file survives process restarts, not redeploys.
let instance: Store | undefined
export const useStore = () => (instance ??= createStore(process.env.FN_DB_PATH ?? '.data/functions.db'))
