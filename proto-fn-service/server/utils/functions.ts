import { useRuntimeConfig } from 'nitro/runtime-config'
import { syncPersistedFn } from './persistence.ts'
import { type Creds, execute } from './sandbox.ts'
import { type FnDef, useStore } from './store.ts'

export type DeployInput = Pick<FnDef, 'slug' | 'code'> & Partial<Pick<FnDef, 'description' | 'inputSchema' | 'exampleInput' | 'allowWrite'>>
export type DeployResult =
  | { ok: true, slug: string, version: number, url: string, exampleOutput: unknown, logs: string[] }
  | { ok: false, phase: 'validate' | 'dry-run' | 'persist', errors: string[], logs: string[] }

export const functionUrl = (slug: string) => `/service/${useRuntimeConfig().serviceContext as string}/run/${slug}`

const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/

export async function deployFunction(input: DeployInput, creds: Creds): Promise<DeployResult> {
  const errors: string[] = []
  if (typeof input.slug !== 'string' || !SLUG.test(input.slug)) errors.push('slug must be kebab-case: 2-63 chars of a-z, 0-9, "-"')
  if (typeof input.code !== 'string' || !input.code.trim()) errors.push('code must be a non-empty string')
  if (/^\s*(import|export)\s/m.test(input.code ?? '')) errors.push('code is a function body: no import/export, use `return`')
  if (errors.length) return { ok: false, phase: 'validate', errors, logs: [] }

  const allowWrite = input.allowWrite === true
  const dry = await execute(input.code, input.exampleInput ?? {}, { creds, allowWrite, dryRun: true })
  if (!dry.ok) return { ok: false, phase: 'dry-run', errors: [`${dry.error.name}: ${dry.error.message}`], logs: dry.logs }

  const version = useStore().save({
    slug: input.slug,
    code: input.code,
    description: input.description,
    inputSchema: input.inputSchema,
    exampleInput: input.exampleInput,
    exampleOutput: dry.value,
    allowWrite,
  })
  try {
    await syncPersistedFn(input.slug)
  } catch (err) {
    // The local store is ephemeral, so without the tenant-option mirror this deploy would
    // vanish on the next redeploy - don't report it as a success.
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[proto-fn] could not persist '${input.slug}' to tenant options:`, message)
    return {
      ok: false,
      phase: 'persist',
      errors: [`Saved locally as version ${version} but could not persist it to tenant options (${message}); it would be lost on the next service redeploy. Retry the deploy unchanged.`],
      logs: dry.logs,
    }
  }
  return { ok: true, slug: input.slug, version, url: functionUrl(input.slug), exampleOutput: dry.value, logs: dry.logs }
}
