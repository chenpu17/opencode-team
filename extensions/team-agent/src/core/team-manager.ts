import type { createOpencodeClient, Project } from "@opencode-ai/sdk"
import { ModuleAnalyzer } from "./module-analyzer"
import { TaskRouter } from "./task-router"
import { ArchitectAgent } from "../agent/architect"
import { ProductManagerAgent } from "../agent/product-manager"
import { StatusSync } from "../ui/status-sync"
import type { Team, Member, Module, Task, Run, Step, CreateTeamOptions, Plan, Scope, Finding } from "../types"
import { log, error as logError } from "../util/logger"
import { StateStore } from "../storage/state"

const STALE_MS = 15_000
const HEARTBEAT_MS = 2_000
type Execution = { completed: number; total: number; status: 'idle' | 'running' | 'completed' | 'error' }

export class TeamManager {
  private analyzer: ModuleAnalyzer
  private statusSync: StatusSync
  private store: StateStore
  private activeTeam?: Team
  private activeRun?: Run
  private modules: Module[] = []
  private members: Member[] = []
  private tasks: Task[] = []
  private steps: Step[] = []
  private router?: TaskRouter
  private counter = 0
  private memberTaskIds = new Map<string, string>()
  private isExecuting = false
  private timer?: ReturnType<typeof setInterval>
  private abort?: AbortSignal
  private abortStop?: () => void
  private executionProgress: Execution = { completed: 0, total: 0, status: 'idle' }

  constructor(
    private client: ReturnType<typeof createOpencodeClient>,
    private project: Project,
    private directory: string
  ) {
    this.analyzer = new ModuleAnalyzer()
    this.statusSync = new StatusSync(client)
    this.store = new StateStore(directory)
  }

  async init() {
    log('TeamManager', 'Initializing team manager')
    await this.store.init()
    await this.statusSync.start()
    const state = await this.store.load(this.directory)
    if (state) {
      this.activeTeam = state.team
      this.activeRun = state.run
      this.modules = state.modules
      this.members = state.members
      this.tasks = state.tasks
      this.steps = state.steps
      this.router = new TaskRouter(this.client, this.modules, this.members, this.directory, this.activeTeam.maxParallel)
      this.refreshAll()
      await this.bindMemberTasks()
      if (this.recover()) await this.persist()
      this.isExecuting = !!this.activeRun && this.activeRun.status === 'running'
      this.executionProgress = this.progress()
    }
    log('TeamManager', 'Status sync started')
  }

  async createTeam(options: CreateTeamOptions) {
    if (this.isExecuting) throw new Error('Team is already working on a task')
    log('TeamManager', 'Creating team', options)
    this.stopHeartbeat()

    // 清理之前的状态
    this.memberTaskIds.clear()

    const prev = options.resetMemory ? [] : this.members
    const max = options.maxParallel ?? options.maxEngineers ?? 3
    const team: Team = {
      id: options.rebuild ? this.generateId() : this.activeTeam?.id ?? this.generateId(),
      projectPath: this.directory,
      maxParallel: max,
      createdAt: options.rebuild ? Date.now() : this.activeTeam?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    }

    log('TeamManager', 'Analyzing modules', { directory: this.directory })
    this.modules = await this.analyzer.analyze(this.directory, team.id, {
      maxLines: options.maxLinesPerModule,
    })
    log('TeamManager', 'Modules analyzed', { count: this.modules.length })

    this.members = this.createMembers(team.id, this.modules, prev, {
      reuseIds: !options.rebuild,
      reuseTasks: !options.rebuild,
      reuseMemory: !options.resetMemory,
    })
    log('TeamManager', 'Members created', { count: this.members.length })

    this.router = new TaskRouter(this.client, this.modules, this.members, this.directory, team.maxParallel)
    this.activeTeam = team
    this.activeRun = undefined
    this.tasks = []
    this.steps = []
    this.executionProgress = this.progress()
    await this.bindMemberTasks()
    await this.persist()
    await this.statusSync.updateTeamStatus(this.members)

    log('TeamManager', 'Team created successfully', { teamId: team.id })
    return { team, modules: this.modules, members: this.members }
  }

  private async createMemberTask(member: Member): Promise<string> {
    try {
      log('TeamManager', 'Creating task for member', { member: member.name })
      const response = await (this.client as any).task?.create?.({
        body: {
          subject: `${member.name} (${member.role})`,
          description: `虚拟团队成员 - ${member.name}`,
          status: 'pending',
        }
      })
      const taskId = response?.data?.id || member.id
      member.taskId = taskId
      log('TeamManager', 'Task created', { member: member.name, taskId })
      return taskId
    } catch (error) {
      logError('TeamManager', 'Failed to create member task', error)
      return member.id
    }
  }

  async assignTask(requirement: string, abort?: AbortSignal): Promise<Task[]> {
    if (!this.activeTeam) throw new Error('No active team')
    if (!requirement.trim()) throw new Error('Requirement cannot be empty')
    if (this.isExecuting) throw new Error('Team is already working on a task')

    log('TeamManager', 'Assigning task', { requirement })
    this.bindAbort(abort)
    this.check()
    this.members.forEach((member) => {
      member.status = 'idle'
    })
    const run = this.beginRun(requirement)
    this.tasks = []
    this.steps = []
    this.executionProgress = this.progress('running')
    this.isExecuting = true
    this.startHeartbeat()
    await this.sync()

    try {
      this.check()
      const pm = this.members.find(m => m.role === 'pm')
      const architect = this.members.find(m => m.role === 'architect')
      if (!architect) throw new Error('No architect found')

      const scope = pm
        ? await new ProductManagerAgent(this.client, pm, this.modules).execute(requirement)
        : { summary: "默认覆盖全部模块", moduleIds: this.modules.map(m => m.id) }
      run.scopeSummary = scope.summary
      run.moduleIds = scope.moduleIds
      run.phase = 'planning'
      this.touchRun()
      await this.sync()
      this.check()

      log('TeamManager', 'Architect executing task decomposition', { architect: architect.name })
      const agent = new ArchitectAgent(this.client, architect, this.modules)
      const mode = agent.needsInvestigation(requirement) ? 'investigation' : 'execution'
      const plan = await agent.execute({ requirement, scope, mode, round: run.round })
      this.tasks = []
      this.steps = []
      this.merge(run, plan, pm?.id, architect.id)
      log('TeamManager', 'Tasks decomposed', { taskCount: plan.tasks.length, stepCount: plan.steps.length, kind: plan.kind })

      run.phase = plan.kind === 'investigation' ? 'investigating' : 'executing'
      run.scopeSummary = plan.scopeSummary
      this.refreshAll()
      this.executionProgress = this.progress('running')
      await this.sync()
      this.check()

      // 异步执行任务，不阻塞返回
      this.executeRunAsync(agent, requirement, {
        summary: run.scopeSummary,
        moduleIds: run.moduleIds,
      }, pm?.id, architect.id).catch(error => {
        logError('TeamManager', 'Async task execution failed', error)
        this.failRun(error)
        this.executionProgress = this.progress('error')
        void this.sync()
      }).finally(() => {
        this.stopHeartbeat()
        this.isExecuting = false
      })

      return plan.tasks
    } catch (error) {
      this.failRun(error)
      this.stopHeartbeat()
      this.isExecuting = false
      await this.sync()
      throw error
    }
  }

  async resumeRun(abort?: AbortSignal) {
    if (!this.activeTeam || !this.activeRun) throw new Error('No active run')
    if (this.isExecuting) throw new Error('Team is already working on a task')
    if (this.activeRun.status === 'completed') throw new Error('Run is already completed')
    if (!this.tasks.some((task) => task.status !== 'completed')) throw new Error('No unfinished work to resume')

    const architect = this.members.find((member) => member.role === 'architect')
    if (!architect) throw new Error('No architect found')
    const pm = this.members.find((member) => member.role === 'pm')

    this.bindAbort(abort)
    this.revive()
    this.isExecuting = true
    this.startHeartbeat()
    await this.sync()

    this.executeRunAsync(new ArchitectAgent(this.client, architect, this.modules), this.activeRun.requirement, {
      summary: this.activeRun.scopeSummary,
      moduleIds: this.activeRun.moduleIds,
    }, pm?.id, architect.id).catch(error => {
      logError('TeamManager', 'Async resume failed', error)
      this.failRun(error)
      this.executionProgress = this.progress('error')
      void this.sync()
    }).finally(() => {
      this.stopHeartbeat()
      this.isExecuting = false
    })

    return this.tasks.filter((task) => task.status === 'pending' || task.status === 'in_progress')
  }

  async syncTeam(options: CreateTeamOptions = {}) {
    return this.createTeam({ ...options, rebuild: false })
  }

  async rebuildTeam(options: CreateTeamOptions = {}) {
    return this.createTeam({ ...options, rebuild: true })
  }

  private createMembers(
    teamId: string,
    modules: Module[],
    prev: Member[],
    opts: { reuseIds: boolean; reuseTasks: boolean; reuseMemory: boolean },
  ) {
    const old = {
      pm: prev.find((member) => member.role === 'pm'),
      architect: prev.find((member) => member.role === 'architect'),
      engineers: new Map(
        prev
          .filter((member) => member.role === 'engineer' && member.modulePath)
          .map((member) => [member.modulePath!, member]),
      ),
    }
    const members: Member[] = [
      {
        id: opts.reuseIds ? old.pm?.id ?? this.generateId() : this.generateId(),
        teamId,
        role: 'pm',
        scope: 'global',
        name: 'ProductManager',
        taskId: opts.reuseTasks ? old.pm?.taskId : undefined,
        memory: opts.reuseMemory ? old.pm?.memory : undefined,
        memoryUpdatedAt: opts.reuseMemory ? old.pm?.memoryUpdatedAt : undefined,
        status: 'idle',
      },
      {
        id: opts.reuseIds ? old.architect?.id ?? this.generateId() : this.generateId(),
        teamId,
        role: 'architect',
        scope: 'global',
        name: 'Architect',
        taskId: opts.reuseTasks ? old.architect?.taskId : undefined,
        memory: opts.reuseMemory ? old.architect?.memory : undefined,
        memoryUpdatedAt: opts.reuseMemory ? old.architect?.memoryUpdatedAt : undefined,
        status: 'idle',
      }
    ]

    if (modules.length === 0) return members

    ;[...modules]
      .sort((a, b) => a.path.localeCompare(b.path))
      .forEach((mod, i) => {
        const item = old.engineers.get(mod.path)
        const id = opts.reuseIds ? item?.id ?? this.generateId() : this.generateId()
        members.push({
          id,
          teamId,
          role: 'engineer',
          scope: 'module',
          name: `Engineer_${mod.path.replace(/[\/\\]/g, '_') || i + 1}`,
          taskId: opts.reuseTasks ? item?.taskId : undefined,
          moduleId: mod.id,
          modulePath: mod.path,
          memory: opts.reuseMemory ? item?.memory : undefined,
          memoryUpdatedAt: opts.reuseMemory ? item?.memoryUpdatedAt : undefined,
          status: 'idle',
        })
        mod.ownerId = id
      })

    return members
  }

  async getActiveTeam() {
    return this.activeTeam
  }

  private async executeSteps(steps: Step[]) {
    if (!this.router || steps.length === 0) return
    await this.router.route(steps, async (member, step, stage) => {
      const task = this.refresh(step.taskId)
      this.touchRun()
      if (stage === 'start') {
        await this.updateMemberTaskStatus(member.id, 'in_progress')
      }
      if (stage === 'finish') {
        this.remember(member, step)
        await this.updateMemberTaskStatus(member.id, 'completed')
      }
      if (stage === 'error') {
        await this.updateMemberTaskStatus(member.id, 'cancelled')
      }

      this.executionProgress = this.progress(this.executionProgress.status)
      await this.statusSync.updateMemberStatus(member, task)
      await this.persist()
    }, this.abort)
  }

  private async executeRunAsync(agent: ArchitectAgent, requirement: string, scope: Scope, pmId?: string, architectId?: string) {
    if (!this.activeRun) return

    log('TeamManager', 'Starting async task execution')
    while (this.activeRun?.status === 'running') {
      const todo = this.steps.filter((step) => step.runId === this.activeRun?.id && step.status === 'pending')
      if (todo.length === 0) break
      await this.executeSteps(todo)
      this.refreshAll()
      this.executionProgress = this.progress(this.executionProgress.status)
      await this.sync()
      if (!this.activeRun || this.activeRun.status !== 'running') return
      const run = this.activeRun

      const last = this.tasks.filter((task) => task.runId === run.id).at(-1)
      if (!last || last.kind !== 'investigation') break

      const findings = this.findings(run.id, run.round)
      const next = agent.review(requirement, scope, findings, run.round)
      run.round += 1
      run.phase = next.mode === 'investigation' ? 'investigating' : 'planning'
      run.scopeSummary = next.scope.summary
      this.touchRun()
      const plan = await agent.execute({
        requirement,
        scope: next.scope,
        mode: next.mode,
        round: run.round,
      })
      this.merge(run, plan, pmId, architectId)
      run.phase = plan.kind === 'investigation' ? 'investigating' : 'executing'
      scope = next.scope
      this.refreshAll()
      this.executionProgress = this.progress('running')
      await this.sync()
      if (plan.kind !== 'investigation') continue
    }

    this.refreshAll()
    this.finishRun()
    this.executionProgress = this.progress('completed')
    await this.sync()
    log('TeamManager', 'All tasks completed')
  }

  async cancel(error = "Interrupted by user") {
    if (!this.activeRun || this.activeRun.status !== 'running') return

    log('TeamManager', 'Cancelling active run', { runId: this.activeRun.id, error })
    this.activeRun.status = 'interrupted'
    this.activeRun.phase = 'error'
    this.activeRun.completedAt = Date.now()
    this.activeRun.heartbeatAt = Date.now()
    this.activeRun.error = error
    this.stopHeartbeat()
    await this.router?.cancel(error)
    this.stop(error)
    this.members.forEach((member) => {
      if (member.status === 'working') {
        member.status = 'error'
        return
      }
      if (member.status === 'completed') return
      member.status = 'idle'
    })
    this.clearAbort()
    this.isExecuting = false
    this.executionProgress = this.progress('error')
    await this.sync()
  }

  async getStatus() {
    if (!this.activeTeam) {
      return { error: 'No active team' }
    }

    return {
      team: {
        id: this.activeTeam.id,
        maxParallel: this.activeTeam.maxParallel,
      },
      teamId: this.activeTeam.id,
      projectPath: this.activeTeam.projectPath,
      run: this.activeRun
        ? {
            id: this.activeRun.id,
            status: this.activeRun.status,
            phase: this.activeRun.phase,
            round: this.activeRun.round,
            requirement: this.activeRun.requirement,
            scopeSummary: this.activeRun.scopeSummary,
            activatedMemberIds: this.activeRun.activatedMemberIds,
            moduleIds: this.activeRun.moduleIds,
            maxParallel: this.activeRun.maxParallel,
            startedAt: this.activeRun.startedAt,
            heartbeatAt: this.activeRun.heartbeatAt,
            completedAt: this.activeRun.completedAt,
            error: this.activeRun.error,
          }
        : undefined,
      summary: {
        active: this.tasks.filter((task) => task.status === 'in_progress').length,
        queued: this.tasks.filter((task) => task.status === 'pending').length,
        failed: this.tasks.filter((task) => task.status === 'error').length,
        members: {
          total: this.members.length,
          activated: this.activeRun?.activatedMemberIds.length ?? 0,
          working: this.members.filter((member) => member.status === 'working').length,
          idle: this.members.filter((member) => member.status === 'idle' || member.status === 'completed').length,
          error: this.members.filter((member) => member.status === 'error').length,
        },
      },
      execution: {
        status: this.executionProgress.status,
        completed: this.executionProgress.completed,
        total: this.executionProgress.total,
        progress: this.executionProgress.total > 0
          ? `${Math.round(this.executionProgress.completed / this.executionProgress.total * 100)}%`
          : '0%'
      },
      resume: {
        available: !!this.activeRun && !this.isExecuting && this.activeRun.status !== 'completed' && this.tasks.some((task) => task.status !== 'completed'),
        pending: this.steps.filter((step) => step.status !== 'completed').length,
      },
      members: this.members.map(m => ({
        name: m.name,
        role: m.role,
        scope: m.scope,
        modulePath: m.modulePath,
        active: this.activeRun?.activatedMemberIds.includes(m.id) ?? false,
        hasMemory: !!m.memory,
        memoryUpdatedAt: m.memoryUpdatedAt,
        status: m.status,
      })),
      tasks: this.tasks.map(t => ({
        id: t.id,
        kind: t.kind,
        round: t.round,
        title: t.title,
        status: t.status,
        result: t.result,
        error: t.error,
      })),
    }
  }

  private async updateMemberTaskStatus(memberId: string, status: 'pending' | 'in_progress' | 'completed' | 'cancelled') {
    const taskId = this.memberTaskIds.get(memberId)
    if (!taskId) return

    try {
      log('TeamManager', 'Updating member task status', { memberId, taskId, status })
      await (this.client as any).task?.update?.({
        path: { id: taskId },
        body: { status }
      })
    } catch (error) {
      logError('TeamManager', 'Failed to update member task status', error)
    }
  }

  private async bindMemberTasks() {
    const ids = await Promise.all(this.members.map(async (member) => ({
      member,
      taskId: member.taskId ?? await this.createMemberTask(member),
    })))
    ids.forEach((item) => {
      this.memberTaskIds.set(item.member.id, item.taskId)
    })
  }

  private progress(status?: Execution["status"]): Execution {
    const total = this.tasks.length
    const completed = this.tasks.filter(task => task.status === 'completed').length
    const run = this.activeRun?.status === 'interrupted' ? 'error' : this.activeRun?.status

    if (status) return { completed, total, status }
    if (run === 'error') return { completed, total, status: 'error' as const }
    if (run === 'completed') return { completed, total, status: 'completed' as const }
    if (run === 'running') return { completed, total, status: 'running' as const }
    if (total === 0) return { completed, total, status: 'idle' as const }
    if (this.tasks.some((task) => task.status === 'error')) {
      return { completed, total, status: 'error' as const }
    }
    if (completed === total) return { completed, total, status: 'completed' as const }

    return {
      completed,
      total,
      status: 'running',
    }
  }

  private recover() {
    const stale = this.activeRun
      ? this.activeRun.status === 'running' && (!this.alive(this.activeRun.ownerPid) || Date.now() - this.activeRun.heartbeatAt > STALE_MS)
      : this.steps.some((step) => step.status === 'pending' || step.status === 'in_progress') ||
        this.tasks.some((task) => task.status === 'pending' || task.status === 'in_progress')
    if (!stale) return false

    log('TeamManager', 'Recovering interrupted execution', {
      teamId: this.activeTeam?.id,
      tasks: this.tasks.length,
    })

    if (this.activeRun) {
      this.activeRun.status = 'interrupted'
      this.activeRun.phase = 'error'
      this.activeRun.completedAt = Date.now()
      this.activeRun.error = this.activeRun.error ?? 'Interrupted: team-agent process exited before run completion'
      this.activeRun.heartbeatAt = Date.now()
    }

    this.stop('Interrupted: team-agent process exited before run completion')

    this.members.forEach((member) => {
      if (member.status !== 'working') return
      member.status = 'error'
    })

    this.executionProgress = this.progress('error')
    return true
  }

  private async persist() {
    if (!this.activeTeam) return
    await this.store.save(this.activeTeam, {
      run: this.activeRun,
      members: this.members,
      modules: this.modules,
      tasks: this.tasks,
      steps: this.steps,
    })
  }

  private async sync() {
    await this.persist()
    await this.statusSync.updateTeamStatus(this.members, this.tasks)
  }

  private bindAbort(abort?: AbortSignal) {
    this.clearAbort()
    if (!abort) return
    this.abort = abort
    this.abortStop = () => {
      void this.cancel("Interrupted by user")
    }
    abort.addEventListener("abort", this.abortStop, { once: true })
    if (abort.aborted) this.abortStop()
  }

  private clearAbort() {
    if (this.abort && this.abortStop) this.abort.removeEventListener("abort", this.abortStop)
    this.abort = undefined
    this.abortStop = undefined
  }

  private generateId(): string {
    return `${Date.now()}_${process.pid}_${this.counter++}`
  }

  private beginRun(requirement: string) {
    const now = Date.now()
    const run: Run = {
      id: this.generateId(),
      teamId: this.activeTeam!.id,
      requirement,
      scopeSummary: "",
      status: 'running',
      phase: 'scoping',
      round: 1,
      activatedMemberIds: [],
      moduleIds: [],
      maxParallel: this.activeTeam!.maxParallel,
      ownerPid: process.pid,
      createdAt: now,
      startedAt: now,
      heartbeatAt: now,
    }
    this.activeRun = run
    return run
  }

  private finishRun() {
    if (!this.activeRun) return
    this.noteRun()
    this.activeRun.status = 'completed'
    this.activeRun.phase = 'completed'
    this.activeRun.completedAt = Date.now()
    this.activeRun.heartbeatAt = Date.now()
    this.activeRun.error = undefined
    this.clearAbort()
  }

  private failRun(err: unknown) {
    if (!this.activeRun) return
    const error = err instanceof Error ? err.message : String(err)
    this.activeRun.status = this.activeRun.status === 'interrupted' ? 'interrupted' : 'error'
    this.activeRun.phase = 'error'
    this.activeRun.completedAt = Date.now()
    this.activeRun.heartbeatAt = Date.now()
    this.activeRun.error = error
    this.stop(`Cancelled: ${error}`)
    this.clearAbort()
  }

  private startHeartbeat() {
    this.stopHeartbeat()
    if (!this.activeRun) return
    this.timer = setInterval(() => {
      this.touchRun()
      if (!this.activeTeam || !this.activeRun) return
      void this.store.touch(this.activeTeam.id, this.activeRun.id, this.activeRun.heartbeatAt)
    }, HEARTBEAT_MS)
  }

  private stopHeartbeat() {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = undefined
  }

  private touchRun() {
    if (!this.activeRun || this.activeRun.status !== 'running') return
    const now = Date.now()
    this.activeRun.heartbeatAt = now
    if (this.activeTeam) this.activeTeam.updatedAt = now
  }

  private alive(pid: number) {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  private refresh(taskId: string) {
    const task = this.tasks.find((item) => item.id === taskId)
    if (!task) return

    const steps = this.steps.filter((item) => item.taskId === taskId)
    if (steps.length === 0) return task

    const started = steps.flatMap((item) => item.startedAt ? [item.startedAt] : item.completedAt ? [item.completedAt] : [])
    const done = steps.filter((item) => item.status === 'completed')
    const error = steps.find((item) => item.status === 'error')
    const result = steps.map((item) => item.result).filter((item): item is string => Boolean(item)).join("\n\n")

    task.startedAt = started.length > 0 ? Math.min(...started) : undefined
    task.completedAt =
      done.length === steps.length && done.length > 0
        ? Math.max(...done.map((item) => item.completedAt ?? item.startedAt ?? item.createdAt))
        : undefined
    task.result = result || undefined
    task.error = error?.error

    if (error) {
      task.status = 'error'
      return task
    }

    if (done.length === steps.length) {
      task.status = 'completed'
      return task
    }

    task.status = steps.some((item) => item.status === 'in_progress' || item.status === 'completed')
      ? 'in_progress'
      : 'pending'
    return task
  }

  private refreshAll() {
    this.tasks.forEach((task) => this.refresh(task.id))
  }

  private remember(member: Member, step: Step) {
    if (!step.result) return
    const now = Date.now()
    const kind = step.kind === 'investigation' ? 'investigation' : 'execution'
    member.memory = this.append(member.memory, kind, `${step.title}\n${step.result.trim().slice(0, 600)}`)
    member.memoryUpdatedAt = now

    const architect = this.members.find((item) => item.role === 'architect')
    if (!architect || step.kind !== 'investigation') return
    architect.memory = this.append(
      architect.memory,
      'investigation',
      `${member.modulePath ?? member.name}\n${step.result.trim().slice(0, 400)}`,
    )
    architect.memoryUpdatedAt = now
  }

  private findings(runId: string, round: number): Finding[] {
    return this.steps
      .filter((step) => step.runId === runId && step.round === round && step.kind === 'investigation')
      .map((step) => ({
        moduleId: step.moduleId,
        stepId: step.id,
        taskId: step.taskId,
        summary: step.result ?? step.error ?? "",
      }))
      .filter((item) => item.summary.trim().length > 0)
  }

  private merge(run: Run, plan: Plan, pmId?: string, architectId?: string) {
    const tasks = plan.tasks.map((task) => ({ ...task, runId: run.id }))
    const steps = plan.steps.map((step) => ({ ...step, runId: run.id }))
    this.tasks.push(...tasks)
    this.steps.push(...steps)
    run.moduleIds = [...new Set(tasks.flatMap((task) => task.moduleId ? [task.moduleId] : []))]
    run.activatedMemberIds = [
      ...new Set([
        ...(pmId ? [pmId] : []),
        ...(architectId ? [architectId] : []),
        ...run.activatedMemberIds,
        ...tasks.flatMap((task) => task.assignedTo ? [task.assignedTo] : []),
      ]),
    ]
  }

  private revive() {
    if (!this.activeRun || !this.activeTeam) return
    const now = Date.now()
    this.activeRun.status = 'running'
    this.activeRun.error = undefined
    this.activeRun.completedAt = undefined
    this.activeRun.ownerPid = process.pid
    this.activeRun.heartbeatAt = now
    this.activeTeam.updatedAt = now
    this.members.forEach((member) => {
      member.status = 'idle'
    })
    this.steps.forEach((step) => {
      if (step.status === 'completed') return
      step.status = 'pending'
      step.startedAt = undefined
      step.completedAt = undefined
      step.error = undefined
      step.result = undefined
    })
    this.tasks.forEach((task) => {
      if (task.status === 'completed') return
      task.status = 'pending'
      task.startedAt = undefined
      task.completedAt = undefined
      task.error = undefined
      task.result = undefined
    })
    const next = this.steps.find((step) => step.status === 'pending')?.kind
    this.activeRun.phase = next === 'investigation' ? 'investigating' : 'executing'
    this.executionProgress = this.progress('running')
  }

  private compact(text: string) {
    const lines = text.split("\n")
    return lines.slice(Math.max(0, lines.length - 80)).join("\n")
  }

  private append(memory: string | undefined, kind: 'investigation' | 'execution' | 'product' | 'architecture', body: string) {
    const title = {
      investigation: "[investigation]",
      execution: "[execution]",
      product: "[product]",
      architecture: "[architecture]",
    }[kind]
    return this.compact([memory, `${title}\n${body}`].filter(Boolean).join("\n\n"))
  }

  private noteRun() {
    if (!this.activeRun) return
    const pm = this.members.find((member) => member.role === 'pm')
    if (pm) {
      pm.memory = this.append(
        pm.memory,
        'product',
        `${this.activeRun.requirement}\n${this.activeRun.scopeSummary}`,
      )
      pm.memoryUpdatedAt = Date.now()
    }

    const architect = this.members.find((member) => member.role === 'architect')
    if (!architect) return
    const done = this.tasks.filter((task) => task.status === 'completed').map((task) => task.title).slice(-6).join(", ")
    architect.memory = this.append(
      architect.memory,
      'architecture',
      `${this.activeRun.requirement}\nphase=${this.activeRun.phase} round=${this.activeRun.round}\ncompleted=${done || "none"}`,
    )
    architect.memoryUpdatedAt = Date.now()
  }

  private stop(error: string) {
    this.steps.forEach((step) => {
      if (step.status === 'completed' || step.status === 'error') return
      step.status = 'error'
      step.error = step.error ?? error
    })

    this.refreshAll()

    this.tasks.forEach((task) => {
      if (task.status === 'completed' || task.status === 'error') return
      task.status = 'error'
      task.error = task.error ?? error
    })
  }

  private check() {
    if (this.abort?.aborted) {
      throw new Error("Interrupted by user")
    }
  }
}
