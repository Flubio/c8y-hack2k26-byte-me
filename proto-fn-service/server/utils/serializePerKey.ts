const queues = new Map<string, Promise<void>>()

/** Runs `task` after every earlier task for the same key has settled. */
export function serializePerKey(key: string, task: () => Promise<void>): Promise<void> {
  const run = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(task)
  queues.set(key, run)
  const cleanup = () => {
    if (queues.get(key) === run) queues.delete(key)
  }
  run.then(cleanup, cleanup)
  return run
}
