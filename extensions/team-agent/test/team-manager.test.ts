import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { TeamManager } from "../src/core/team-manager"
import { StateStore } from "../src/storage/state"
import type { Member, Module, Task, Team, Run, Step } from "../src/types"

const dirs: string[] = []

async function poll(check: () => Promise<boolean>, timeout = 1000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await check()) return
    await Bun.sleep(10)
  }
  throw new Error("timed out")
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const lines = (count: number) => Array.from({ length: count }, (_, i) => `export const v${i} = ${i}`).join("\n") + "\n"

describe("TeamManager", () => {
  test("recovers stale tasks as interrupted errors on init", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "team-agent-"))
    dirs.push(dir)

    const store = new StateStore(dir)
    await store.init()

    const team: Team = {
      id: "team",
      projectPath: dir,
      maxParallel: 2,
      createdAt: 1,
      updatedAt: 1,
    }
    const members: Member[] = [
      { id: "pm", teamId: "team", role: "pm", scope: "global", name: "ProductManager", status: "completed" },
      { id: "arch", teamId: "team", role: "architect", scope: "global", name: "Architect", status: "completed" },
      { id: "eng", teamId: "team", role: "engineer", scope: "module", name: "Engineer_Core", taskId: "task-eng", moduleId: "mod", modulePath: "src/core", status: "working" },
    ]
    const run: Run = {
      id: "run",
      teamId: "team",
      requirement: "analyze core",
      scopeSummary: "scope",
      status: "running",
      phase: "executing",
      round: 1,
      activatedMemberIds: ["pm", "arch", "eng"],
      moduleIds: ["mod"],
      maxParallel: 2,
      ownerPid: 999999,
      createdAt: 1,
      startedAt: 1,
      heartbeatAt: 1,
    }
    const modules: Module[] = [
      {
        id: "mod",
        teamId: "team",
        path: "src/core",
        files: ["src/core/index.ts"],
        lineCount: 10,
        ownerId: "eng",
        imports: [],
        exports: ["export core"],
      },
    ]
    const tasks: Task[] = [
      {
        id: "pending",
        teamId: "team",
        runId: "run",
        kind: "execution",
        round: 1,
        title: "src/core",
        description: "goal",
        moduleId: "mod",
        assignedTo: "eng",
        status: "pending",
        dependencies: [],
        createdAt: 1,
      },
      {
        id: "active",
        teamId: "team",
        runId: "run",
        kind: "execution",
        round: 1,
        title: "src/core#2",
        description: "goal",
        moduleId: "mod",
        assignedTo: "eng",
        status: "in_progress",
        dependencies: [],
        createdAt: 2,
        startedAt: 3,
      },
    ]
    const steps: Step[] = [
      {
        id: "pending_step",
        taskId: "pending",
        teamId: "team",
        runId: "run",
        kind: "execution",
        round: 1,
        title: "src/core · step 1",
        description: "goal",
        moduleId: "mod",
        assignedTo: "eng",
        status: "pending",
        dependencies: [],
        files: ["src/core/index.ts"],
        createdAt: 1,
      },
      {
        id: "active_step",
        taskId: "active",
        teamId: "team",
        runId: "run",
        kind: "execution",
        round: 1,
        title: "src/core#2 · step 1",
        description: "goal",
        moduleId: "mod",
        assignedTo: "eng",
        status: "in_progress",
        dependencies: [],
        files: ["src/core/index.ts"],
        createdAt: 2,
        startedAt: 3,
      },
    ]

    await store.save(team, { run, members, modules, tasks, steps })
    store.close()

    const manager = new TeamManager({} as never, {} as never, dir)
    await manager.init()
    const status = await manager.getStatus()

    expect("error" in status).toBe(false)
    expect(status.run?.status).toBe("interrupted")
    expect(status.execution.status).toBe("error")
    expect(status.tasks.every((task) => task.status === "error")).toBe(true)
    expect(status.tasks[0]?.error).toContain("Interrupted")
  })

  test("rejects team recreation while tasks are still executing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "team-agent-"))
    dirs.push(dir)
    await mkdir(path.join(dir, "src", "core"), { recursive: true })
    await writeFile(path.join(dir, "src", "core", "index.ts"), lines(10))

    let done!: () => void
    const wait = new Promise<void>((resolve) => {
      done = resolve
    })
    const client = {
      session: {
        create: async () => ({ data: { id: "s1" } }),
        prompt: async (opts: { body: { noReply?: boolean } }) => {
          if (!opts.body.noReply) await wait
          return {
            data: {
              parts: opts.body.noReply ? [] : [{ type: "text", text: "ok" }],
            },
          }
        },
        delete: async () => ({ data: true }),
      },
    } as never

    const manager = new TeamManager(client, {} as never, dir)
    await manager.init()
    await manager.createTeam({ maxParallel: 1, maxLinesPerModule: 1000 })
    await manager.assignTask("analyze code quality")

    await expect(manager.createTeam({ maxParallel: 1, maxLinesPerModule: 1000 })).rejects.toThrow(
      "Team is already working on a task",
    )

    done()
    await poll(async () => {
      const status = await manager.getStatus()
      return status.execution.status === "completed"
    })
  })

  test("creates one module engineer per analyzed module", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "team-agent-"))
    dirs.push(dir)
    await mkdir(path.join(dir, "src", "a"), { recursive: true })
    await mkdir(path.join(dir, "src", "b"), { recursive: true })
    await mkdir(path.join(dir, "src", "c"), { recursive: true })
    await writeFile(path.join(dir, "src", "a", "index.ts"), lines(100))
    await writeFile(path.join(dir, "src", "b", "index.ts"), lines(90))
    await writeFile(path.join(dir, "src", "c", "index.ts"), lines(10))

    const manager = new TeamManager({} as never, {} as never, dir)
    await manager.init()
    const result = await manager.createTeam({ maxParallel: 2, maxLinesPerModule: 1000 })

    const engineers = result.members.filter((member) => member.role === "engineer")
    expect(result.team.maxParallel).toBe(2)
    expect(engineers).toHaveLength(3)
    expect(new Set(result.modules.map((mod) => mod.ownerId)).size).toBe(3)
    expect(engineers.every((member) => member.moduleId && member.modulePath && member.scope === "module")).toBe(true)
  })

  test("preserves member memory and identity across team recreation", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "team-agent-"))
    dirs.push(dir)
    await mkdir(path.join(dir, "src", "auth"), { recursive: true })
    await writeFile(path.join(dir, "src", "auth", "index.ts"), lines(10))

    const client = {
      session: {
        create: async () => ({ data: { id: "s1" } }),
        prompt: async () => ({
          data: {
            parts: [{ type: "text", text: "调查发现 token 生成存在竞态" }],
          },
        }),
        delete: async () => ({ data: true }),
      },
    } as never

    const manager = new TeamManager(client, {} as never, dir)
    await manager.init()
    const first = await manager.createTeam({ maxParallel: 1, maxLinesPerModule: 1000 })
    await manager.assignTask("fix auth bug")

    await poll(async () => {
      const status = await manager.getStatus()
      return status.run?.status === "completed"
    })

    const before = await manager.getStatus()
    const old = before.members.find((member) => member.modulePath === "src/auth")
    const second = await manager.createTeam({ maxParallel: 2, maxLinesPerModule: 1000 })
    const next = second.members.find((member) => member.modulePath === "src/auth")

    expect(old?.hasMemory).toBe(true)
    expect(second.team.id).toBe(first.team.id)
    expect(next?.id).toBe(first.modules[0]?.ownerId)
    expect(next?.memory).toContain("token 生成")
  })

  test("activates only members related to the scoped modules", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "team-agent-"))
    dirs.push(dir)
    await mkdir(path.join(dir, "src", "auth"), { recursive: true })
    await mkdir(path.join(dir, "src", "api"), { recursive: true })
    await mkdir(path.join(dir, "src", "ui"), { recursive: true })
    await writeFile(path.join(dir, "src", "auth", "index.ts"), lines(10))
    await writeFile(path.join(dir, "src", "api", "index.ts"), lines(10))
    await writeFile(path.join(dir, "src", "ui", "index.ts"), lines(10))

    const client = {
      session: {
        create: async () => ({ data: { id: "s1" } }),
        prompt: async () => ({
          data: {
            parts: [{ type: "text", text: "ok" }],
          },
        }),
        delete: async () => ({ data: true }),
      },
    } as never

    const manager = new TeamManager(client, {} as never, dir)
    await manager.init()
    const result = await manager.createTeam({ maxParallel: 2, maxLinesPerModule: 1000 })
    await manager.assignTask("auth login")

    await poll(async () => {
      const status = await manager.getStatus()
      return status.run?.status === "completed"
    })

    const status = await manager.getStatus()
    const active = new Set(status.run?.activatedMemberIds ?? [])
    const auth = result.modules.find((mod) => mod.path === "src/auth")
    const api = result.modules.find((mod) => mod.path === "src/api")
    const ui = result.modules.find((mod) => mod.path === "src/ui")

    expect(status.run?.moduleIds).toEqual([auth!.id])
    expect(active.size).toBe(3)
    expect(active.has(auth!.ownerId!)).toBe(true)
    expect(active.has(api!.ownerId!)).toBe(false)
    expect(active.has(ui!.ownerId!)).toBe(false)
  })

  test("runs investigation before execution for issue-like requirements", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "team-agent-"))
    dirs.push(dir)
    await mkdir(path.join(dir, "src", "auth"), { recursive: true })
    await mkdir(path.join(dir, "src", "api"), { recursive: true })
    await writeFile(path.join(dir, "src", "auth", "index.ts"), lines(10))
    await writeFile(path.join(dir, "src", "api", "index.ts"), lines(10))

    let n = 0
    const client = {
      session: {
        create: async () => ({ data: { id: `s${++n}` } }),
        prompt: async (opts: { body: { noReply?: boolean; parts?: Array<{ text: string }> } }) => {
          if (opts.body.noReply) return { data: { parts: [] } }
          const text = opts.body.parts?.[0]?.text ?? ""
          return {
            data: {
              parts: [{
                type: "text",
                text: text.includes("调查标题")
                  ? "需要协助 src/auth，登录链路异常，待确认 token 生成"
                  : "执行修复方案",
              }],
            },
          }
        },
        delete: async () => ({ data: true }),
      },
    } as never

    const manager = new TeamManager(client, {} as never, dir)
    await manager.init()
    await manager.createTeam({ maxParallel: 2, maxLinesPerModule: 1000 })
    const list = await manager.assignTask("fix login bug in api")

    expect(list.every((task) => task.kind === "investigation")).toBe(true)

    await poll(async () => {
      const status = await manager.getStatus()
      return status.run?.status === "completed"
    })

    const status = await manager.getStatus()
    expect(status.tasks.some((task) => task.kind === "investigation")).toBe(true)
    expect(status.tasks.some((task) => task.kind === "execution")).toBe(true)
  })

  test("caps execution concurrency even when multiple engineers are activated", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "team-agent-"))
    dirs.push(dir)
    await mkdir(path.join(dir, "src", "a"), { recursive: true })
    await mkdir(path.join(dir, "src", "b"), { recursive: true })
    await mkdir(path.join(dir, "src", "c"), { recursive: true })
    await writeFile(path.join(dir, "src", "a", "index.ts"), lines(10))
    await writeFile(path.join(dir, "src", "b", "index.ts"), lines(10))
    await writeFile(path.join(dir, "src", "c", "index.ts"), lines(10))

    let active = 0
    let max = 0
    let sid = 0
    const client = {
      session: {
        create: async () => ({ data: { id: `s${++sid}` } }),
        prompt: async (opts: { body: { noReply?: boolean } }) => {
          if (opts.body.noReply) return { data: { parts: [] } }
          active++
          max = Math.max(max, active)
          await Bun.sleep(20)
          active--
          return {
            data: {
              parts: [{ type: "text", text: "ok" }],
            },
          }
        },
        delete: async () => ({ data: true }),
      },
    } as never

    const manager = new TeamManager(client, {} as never, dir)
    await manager.init()
    await manager.createTeam({ maxParallel: 1, maxLinesPerModule: 1000 })
    await manager.assignTask("analyze overall system quality")

    await poll(async () => {
      const status = await manager.getStatus()
      return status.run?.status === "completed"
    })

    expect(max).toBe(1)
  })

  test("interrupts background execution when the session aborts", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "team-agent-"))
    dirs.push(dir)
    await mkdir(path.join(dir, "src", "core"), { recursive: true })
    await writeFile(path.join(dir, "src", "core", "index.ts"), lines(10))

    let done!: () => void
    let stop = false
    let aborts = 0
    const gate = new Promise<void>((resolve) => {
      done = resolve
    })
    let sid = 0
    const client = {
      session: {
        create: async () => ({ data: { id: `s${++sid}` } }),
        prompt: async (opts: { body: { noReply?: boolean } }) => {
          if (opts.body.noReply) return { data: { parts: [] } }
          await gate
          if (stop) throw new Error("Interrupted by user")
          return {
            data: {
              parts: [{ type: "text", text: "ok" }],
            },
          }
        },
        abort: async () => {
          aborts++
          stop = true
          done()
          return { data: true }
        },
        delete: async () => ({ data: true }),
      },
    } as never

    const ctl = new AbortController()
    const manager = new TeamManager(client, {} as never, dir)
    await manager.init()
    await manager.createTeam({ maxParallel: 1, maxLinesPerModule: 1000 })
    await manager.assignTask("analyze code quality", ctl.signal)

    await poll(async () => {
      const status = await manager.getStatus()
      return status.tasks.some((task) => task.status === "in_progress")
    })

    ctl.abort()

    await poll(async () => {
      const status = await manager.getStatus()
      return status.run?.status === "interrupted" && status.tasks.every((task) => task.status === "error")
    })

    const status = await manager.getStatus()
    expect(status.run?.status).toBe("interrupted")
    expect(status.execution.status).toBe("error")
    expect(status.tasks.every((task) => task.error?.includes("Interrupted") ?? false)).toBe(true)
    expect(aborts).toBeGreaterThan(0)
  })

  test("resumes interrupted runs from unfinished work", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "team-agent-"))
    dirs.push(dir)
    await mkdir(path.join(dir, "src", "core"), { recursive: true })
    await writeFile(path.join(dir, "src", "core", "index.ts"), lines(10))

    let done!: () => void
    let block = true
    let stop = false
    const gate = () => new Promise<void>((resolve) => {
      done = resolve
    })
    let sid = 0
    const client = {
      session: {
        create: async () => ({ data: { id: `s${++sid}` } }),
        prompt: async (opts: { body: { noReply?: boolean } }) => {
          if (opts.body.noReply) return { data: { parts: [] } }
          if (block) await gate()
          if (stop) throw new Error("Interrupted by user")
          return {
            data: {
              parts: [{ type: "text", text: "ok" }],
            },
          }
        },
        abort: async () => {
          stop = true
          done()
          return { data: true }
        },
        delete: async () => ({ data: true }),
      },
    } as never

    const ctl = new AbortController()
    const manager = new TeamManager(client, {} as never, dir)
    await manager.init()
    await manager.createTeam({ maxParallel: 1, maxLinesPerModule: 1000 })
    await manager.assignTask("analyze code quality", ctl.signal)

    await poll(async () => {
      const status = await manager.getStatus()
      return status.tasks.some((task) => task.status === "in_progress")
    })

    ctl.abort()

    await poll(async () => {
      const status = await manager.getStatus()
      return status.resume.available === true
    })

    stop = false
    block = false
    await manager.resumeRun()

    await poll(async () => {
      const status = await manager.getStatus()
      return status.run?.status === "completed"
    })

    const status = await manager.getStatus()
    expect(status.resume.available).toBe(false)
    expect(status.execution.status).toBe("completed")
  })
})
