import type { createOpencodeClient } from "@opencode-ai/sdk"
import type { Step, Module, Member } from "../types"
import { EngineerAgent } from "../agent/engineer"
import { Semaphore } from "../util/semaphore"
import { log, error as logError } from "../util/logger"

export class TaskRouter {
  private semaphore: Semaphore
  private queue = new Map<string, Promise<void>>()
  private active = new Map<string, EngineerAgent>()
  private error?: string

  constructor(
    private client: ReturnType<typeof createOpencodeClient>,
    private modules: Module[],
    private members: Member[],
    private directory: string,
    private maxParallel = 3
  ) {
    this.semaphore = new Semaphore(maxParallel)
  }

  async route(
    tasks: Step[],
    update?: (member: Member, task: Step, stage: 'start' | 'finish' | 'error') => Promise<void>,
    abort?: AbortSignal,
  ): Promise<void> {
    if (tasks.length === 0) return

    this.error = undefined
    log('TaskRouter', 'Starting task routing', { taskCount: tasks.length })
    const batches = this.topologicalSort(tasks)
    log('TaskRouter', 'Tasks sorted into batches', { batchCount: batches.length })

    for (const batch of batches) {
      this.check(abort)
      log('TaskRouter', 'Executing batch', { batchSize: batch.length })
      await this.executeBatch(batch, update, abort)
    }
    log('TaskRouter', 'All tasks completed')
  }

  async cancel(error = "Interrupted by user") {
    if (this.error) return
    this.error = error
    await Promise.allSettled([...this.active.values()].map((agent) => agent.cancel()))
  }

  private async executeBatch(
    tasks: Step[],
    update?: (member: Member, task: Step, stage: 'start' | 'finish' | 'error') => Promise<void>,
    abort?: AbortSignal,
  ): Promise<void> {
    this.check(abort)
    const results = await Promise.allSettled(
      tasks.map(task => this.executeTask(task, update, abort))
    )

    const failed = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[]
    if (failed.length > 0) {
      const errors = failed.map(f => f.reason).join('; ')
      throw new Error(`${failed.length} tasks failed: ${errors}`)
    }
  }

  private async executeTask(
    task: Step,
    update?: (member: Member, task: Step, stage: 'start' | 'finish' | 'error') => Promise<void>,
    abort?: AbortSignal,
  ): Promise<void> {
    this.check(abort)
    const module = this.modules.find(m => m.id === task.moduleId)
    if (!module) {
      throw new Error(`Module not found: ${task.moduleId} for task "${task.title}" (${task.id})`)
    }

    const member = this.members.find(m => m.id === module.ownerId)
    if (!member) {
      throw new Error(`No engineer assigned to module: ${module.path} (${module.id})`)
    }

    const prev = this.queue.get(member.id) ?? Promise.resolve()
    const run = prev.catch(() => undefined).then(async () => {
      this.check(abort)
      await this.semaphore.acquire()
      try {
        this.check(abort)
        await this.runTask(task, module, member, update, abort)
      } finally {
        this.semaphore.release()
      }
    })

    this.queue.set(member.id, run)

    try {
      await run
    } finally {
      if (this.queue.get(member.id) === run) this.queue.delete(member.id)
    }
  }

  private async runTask(
    task: Step,
    module: Module,
    member: Member,
    update?: (member: Member, task: Step, stage: 'start' | 'finish' | 'error') => Promise<void>,
    abort?: AbortSignal,
  ) {
    this.check(abort)
    log('TaskRouter', 'Starting task execution', { taskId: task.id, title: task.title })
    Object.assign(task, {
      status: 'in_progress' as const,
      startedAt: Date.now()
    })
    Object.assign(member, { status: 'working' as const })
    if (update) await update(member, task, 'start')

    const engineer = new EngineerAgent(this.client, member, module, this.modules, this.directory, abort)
    this.active.set(task.id, engineer)

    try {
      await engineer.execute(task)

      Object.assign(task, {
        status: 'completed' as const,
        completedAt: Date.now()
      })
      Object.assign(member, { status: 'idle' as const })
      log('TaskRouter', 'Task completed', { taskId: task.id, engineer: member.name })
      if (update) await update(member, task, 'finish')
    } catch (error) {
      Object.assign(task, {
        status: 'error' as const,
        error: error instanceof Error ? error.message : String(error)
      })
      Object.assign(member, { status: 'error' as const })
      logError('TaskRouter', 'Task failed', { taskId: task.id, error })
      if (update) await update(member, task, 'error')
      throw error
    } finally {
      if (this.active.get(task.id) === engineer) this.active.delete(task.id)
    }
  }

  private check(abort?: AbortSignal) {
    if (this.error) throw new Error(this.error)
    if (abort?.aborted) throw new Error("Interrupted by user")
  }

  private topologicalSort(tasks: Step[]): Step[][] {
    this.conflicts(tasks)
    const batches: Step[][] = []
    const visited = new Set<string>()
    const remaining = new Map(tasks.map(t => [t.id, t]))

    while (remaining.size > 0) {
      const batch: Step[] = []

      for (const [id, task] of remaining) {
        if (task.dependencies.every(d => visited.has(d))) {
          batch.push(task)
        }
      }

      if (batch.length === 0) {
        const [id, task] = [...remaining.entries()].sort(
          (a, b) => a[1].dependencies.length - b[1].dependencies.length || a[0].localeCompare(b[0]),
        )[0]!
        logError('TaskRouter', 'Circular dependency detected, forcing task order', {
          taskId: id,
          dependencies: task.dependencies,
        })
        batch.push(task)
      }

      batch.forEach(task => {
        visited.add(task.id)
        remaining.delete(task.id)
      })

      batches.push(batch)
    }

    return batches
  }

  private conflicts(tasks: Step[]) {
    const seen = new Map<string, Step>()
    ;[...tasks]
      .sort((a, b) => a.round - b.round || a.id.localeCompare(b.id))
      .forEach((task) => {
        task.files
          .map((file) => file.toLowerCase())
          .sort()
          .forEach((file) => {
            const prev = seen.get(file)
            if (!prev) {
              seen.set(file, task)
              return
            }
            if (prev.id === task.id) return
            if (!task.dependencies.includes(prev.id)) task.dependencies.push(prev.id)
            seen.set(file, task)
          })
      })
  }
}
