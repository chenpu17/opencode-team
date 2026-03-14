import { BaseAgent } from "./base-agent"
import type { Plan, Task, Step, Module, Member, Scope, Finding } from "../types"
import type { createOpencodeClient } from "@opencode-ai/sdk"
import { log, error as logError } from "../util/logger"

type Input = {
  requirement: string
  scope: Scope
  mode: 'investigation' | 'execution'
  round?: number
}

type Review = {
  mode: 'investigation' | 'execution'
  scope: Scope
}

export class ArchitectAgent extends BaseAgent<Input, Plan> {
  constructor(
    client: ReturnType<typeof createOpencodeClient>,
    member: Member,
    private modules: Module[]
  ) {
    super(client, member)
  }
  async execute(input: Input): Promise<Plan> {
    log('ArchitectAgent', 'Starting task decomposition', { requirement: input.requirement })
    this.updateStatus('working')

    try {
      const plan = input.mode === 'investigation'
        ? await this.investigate(input)
        : await this.decompose(input)
      log('ArchitectAgent', 'Task decomposition completed', { taskCount: plan.tasks.length, stepCount: plan.steps.length })
      this.updateStatus('completed')
      return plan
    } catch (error) {
      logError('ArchitectAgent', 'Task decomposition failed', error)
      this.updateStatus('error')
      throw error
    }
  }

  needsInvestigation(requirement: string) {
    return /bug|issue|error|failure|failing|broken|regression|root cause|why|fix|异常|报错|故障|问题|修复|定位|原因/i.test(requirement)
  }

  review(requirement: string, scope: Scope, findings: Finding[], round: number): Review {
    const mods = this.modules.filter((mod) => scope.moduleIds.includes(mod.id))
    const memory = this.member.memory?.toLowerCase() ?? ""
    const ids = [...new Set(findings.flatMap((item) => {
      const text = item.summary.toLowerCase()
      return mods.flatMap((mod) => {
        const files = mod.files.some((file) => text.includes(file.toLowerCase()))
        if (files || text.includes(mod.path.toLowerCase()) || memory.includes(mod.path.toLowerCase())) return [mod.id]
        return []
      })
    }))]
    const open = findings.some((item) => /need help|unknown|unclear|待确认|不确定|需要协助|blocked|依赖/.test(item.summary.toLowerCase()))
    const limit = Math.max(2, Math.min(scope.moduleIds.length, 4))

    if (open && ids.length > 0 && ids.length < scope.moduleIds.length && round < limit) {
      return {
        mode: 'investigation',
        scope: {
          summary: `基于第 ${round} 轮调查，继续聚焦 ${ids.length} 个模块`,
          moduleIds: ids,
        },
      }
    }

    return {
      mode: 'execution',
      scope: {
        summary: ids.length > 0 ? `基于调查证据，收敛到 ${ids.length} 个模块` : scope.summary,
        moduleIds: ids.length > 0 ? ids : scope.moduleIds,
      },
    }
  }

  private async decompose(input: Input): Promise<Plan> {
    const mods = this.modules.filter((mod) => input.scope.moduleIds.includes(mod.id))
    const ids = new Map<string, string>()
    const now = Date.now()

    mods.forEach((mod, i) => {
      ids.set(mod.id, `task_${now}_${i}`)
    })

    const tasks: Task[] = mods.map((mod) => ({
      id: ids.get(mod.id)!,
      teamId: this.member.teamId,
      kind: 'execution',
      round: input.round ?? 1,
      title: mod.path,
      description: [`范围: ${input.scope.summary}`, `目标: ${input.requirement}`].join("\n"),
      moduleId: mod.id,
      assignedTo: mod.ownerId,
      status: 'pending' as const,
      dependencies: [
        ...new Set(
          mod.imports
            .map((dep) => mods.find((item) => item.path === dep)?.id)
            .filter((id): id is string => Boolean(id))
            .map((id) => ids.get(id)!)
            .filter((id) => id !== ids.get(mod.id)!),
        ),
      ],
      createdAt: Date.now(),
      stepCount: 0,
    }))

    const steps = this.steps(tasks, mods, input.requirement)
    tasks.forEach((task) => {
      task.stepCount = steps.filter((step) => step.taskId === task.id).length
    })

    return { kind: 'execution', scopeSummary: input.scope.summary, tasks, steps }
  }

  private async investigate(input: Input): Promise<Plan> {
    const mods = this.pick(input.scope.moduleIds, input.requirement)
    const now = Date.now()
    const tasks: Task[] = mods.map((mod, i) => ({
      id: `task_${now}_${i}`,
      teamId: this.member.teamId,
      kind: 'investigation',
      round: input.round ?? 1,
      title: `${mod.path} · investigation`,
      description: [
        `范围: ${input.scope.summary}`,
        `目标: 调查问题根因，暂不实施修改`,
        `问题: ${input.requirement}`,
      ].join("\n"),
      moduleId: mod.id,
      assignedTo: mod.ownerId,
      status: 'pending',
      dependencies: [],
      createdAt: now,
      stepCount: 1,
    }))
    const steps: Step[] = tasks.map((task) => {
      const mod = mods.find((item) => item.id === task.moduleId)!
      return {
        id: `${task.id}_step_1`,
        taskId: task.id,
        teamId: task.teamId,
        kind: 'investigation',
        round: task.round,
        title: `${mod.path} · investigate`,
        description: [
          `问题: ${input.requirement}`,
          "请调查可能根因、关键证据、涉及文件和建议协同模块，不要直接修改代码。",
        ].join("\n"),
        moduleId: mod.id,
        assignedTo: task.assignedTo,
        status: 'pending',
        dependencies: [],
        files: mod.files.slice(0, Math.min(3, mod.files.length)),
        createdAt: task.createdAt,
      }
    })

    return {
      kind: 'investigation',
      scopeSummary: `第 ${input.round ?? 1} 轮调查，聚焦 ${mods.length} 个模块`,
      tasks,
      steps,
    }
  }

  private steps(tasks: Task[], mods: Module[], requirement: string) {
    const last = new Map<string, string>()
    const taskByModule = new Map(tasks.map((task) => [task.moduleId, task]))
    const steps: Step[] = []

    tasks.forEach((task) => {
      const mod = mods.find((item) => item.id === task.moduleId)
      if (!mod) return

      const groups = this.groups(mod.files)
      groups.forEach((files, i) => {
        const id = `${task.id}_step_${i + 1}`
        const prev = i > 0 ? [`${task.id}_step_${i}`] : []
        steps.push({
          id,
          taskId: task.id,
          teamId: task.teamId,
          kind: task.kind,
          round: task.round,
          title: `${task.title} · step ${i + 1}`,
          description: [`目标: ${requirement}`, `文件: ${files.join(", ")}`].join("\n"),
          moduleId: task.moduleId,
          assignedTo: task.assignedTo,
          status: "pending",
          dependencies: prev,
          files,
          createdAt: task.createdAt,
        })
      })

      const own = steps.filter((step) => step.taskId === task.id)
      if (own.length > 0) last.set(task.id, own.at(-1)!.id)
    })

    return steps.map((step) => {
      const task = taskByModule.get(step.moduleId)
      if (!task) return step
      if (!step.id.endsWith("_step_1")) return step

      return {
        ...step,
        dependencies: [
          ...new Set([
            ...task.dependencies.map((id) => last.get(id)).filter((id): id is string => Boolean(id)),
            ...step.dependencies,
          ]),
        ],
      }
    })
  }

  private pick(ids: string[], requirement: string) {
    const words = requirement.toLowerCase().split(/[^a-z0-9_\-\u4e00-\u9fff]+/).filter(Boolean)
    const mods = this.modules
      .filter((mod) => ids.includes(mod.id))
      .map((mod) => {
        const text = `${mod.path} ${mod.files.join(" ")} ${mod.summary ?? ""}`.toLowerCase()
        const score = words.reduce((sum, word) => sum + (text.includes(word) ? 3 : 0), 0) + mod.imports.length
        return { mod, score }
      })
      .sort((a, b) => b.score - a.score || a.mod.path.localeCompare(b.mod.path))
    const top = mods.filter((item) => item.score > 0)
    const list = top.length > 0 ? top : mods
    return list.slice(0, Math.min(Math.max(1, top.length || 2), 3)).map((item) => item.mod)
  }

  private groups(files: string[]) {
    const size = files.length <= 2 ? 1 : Math.ceil(files.length / 3)
    const out: string[][] = []
    for (let i = 0; i < files.length; i += size) {
      out.push(files.slice(i, i + size))
    }
    return out
  }
}
