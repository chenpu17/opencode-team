import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { TaskRouter } from "../src/core/task-router"
import type { Member, Module, Step } from "../src/types"

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("TaskRouter", () => {
  test("runs tasks for the same engineer in sequence", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "team-agent-"))
    dirs.push(dir)
    await mkdir(path.join(dir, "src", "a"), { recursive: true })
    await mkdir(path.join(dir, "src", "b"), { recursive: true })
    await writeFile(path.join(dir, "src", "a", "index.ts"), "export const a = 1\n")
    await writeFile(path.join(dir, "src", "b", "index.ts"), "export const b = 1\n")

    const order: string[] = []
    let active = 0
    let max = 0
    const client = {
      session: {
        create: async () => ({ data: { id: `s${Date.now()}` } }),
        prompt: async (opts: { body: { noReply?: boolean; parts: { text: string }[] } }) => {
          if (opts.body.noReply) return { data: { parts: [] } }
          const text = opts.body.parts[0]!.text
          active++
          max = Math.max(max, active)
          order.push(`start:${text}`)
          await Bun.sleep(20)
          order.push(`end:${text}`)
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

    const member: Member = {
      id: "eng",
      teamId: "team",
      role: "engineer",
      scope: "module",
      name: "Engineer_Core",
      moduleId: "a",
      modulePath: "src/a",
      status: "idle",
    }
    const members: Member[] = [
      {
        id: "arch",
        teamId: "team",
        role: "architect",
        scope: "global",
        name: "Architect",
        status: "idle",
      },
      member,
    ]
    const modules: Module[] = [
      {
        id: "a",
        teamId: "team",
        path: "src/a",
        files: ["src/a/index.ts"],
        lineCount: 2,
        ownerId: "eng",
        imports: [],
        exports: ["export a"],
      },
      {
        id: "b",
        teamId: "team",
        path: "src/b",
        files: ["src/b/index.ts"],
        lineCount: 2,
        ownerId: "eng",
        imports: [],
        exports: ["export b"],
      },
    ]
    const tasks: Step[] = [
      {
        id: "t1_s1",
        taskId: "t1",
        teamId: "team",
        kind: "execution",
        round: 1,
        title: "a",
        description: "task a",
        moduleId: "a",
        status: "pending",
        dependencies: [],
        files: ["src/a/index.ts"],
        createdAt: Date.now(),
      },
      {
        id: "t2_s1",
        taskId: "t2",
        teamId: "team",
        kind: "execution",
        round: 1,
        title: "b",
        description: "task b",
        moduleId: "b",
        status: "pending",
        dependencies: [],
        files: ["src/b/index.ts"],
        createdAt: Date.now(),
      },
    ]

    const router = new TaskRouter(client, modules, members, dir, 2)
    await router.route(tasks)

    expect(max).toBe(1)
    expect(order[0]).toContain("task a")
    expect(order[1]).toContain("task a")
    expect(order[2]).toContain("task b")
    expect(order[3]).toContain("task b")
  })

  test("keeps running when module dependencies form a cycle", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "team-agent-"))
    dirs.push(dir)
    await mkdir(path.join(dir, "src", "a"), { recursive: true })
    await mkdir(path.join(dir, "src", "b"), { recursive: true })
    await writeFile(path.join(dir, "src", "a", "index.ts"), "export const a = 1\n")
    await writeFile(path.join(dir, "src", "b", "index.ts"), "export const b = 1\n")

    const client = {
      session: {
        create: async () => ({ data: { id: `s${Date.now()}` } }),
        prompt: async (opts: { body: { noReply?: boolean } }) => ({
          data: {
            parts: opts.body.noReply ? [] : [{ type: "text", text: "ok" }],
          },
        }),
        delete: async () => ({ data: true }),
      },
    } as never

    const members: Member[] = [
      {
        id: "eng-a",
        teamId: "team",
        role: "engineer",
        scope: "module",
        name: "Engineer_A",
        moduleId: "a",
        modulePath: "src/a",
        status: "idle",
      },
      {
        id: "eng-b",
        teamId: "team",
        role: "engineer",
        scope: "module",
        name: "Engineer_B",
        moduleId: "b",
        modulePath: "src/b",
        status: "idle",
      },
    ]
    const modules: Module[] = [
      {
        id: "a",
        teamId: "team",
        path: "src/a",
        files: ["src/a/index.ts"],
        lineCount: 2,
        ownerId: "eng-a",
        imports: ["src/b"],
        exports: ["export a"],
      },
      {
        id: "b",
        teamId: "team",
        path: "src/b",
        files: ["src/b/index.ts"],
        lineCount: 2,
        ownerId: "eng-b",
        imports: ["src/a"],
        exports: ["export b"],
      },
    ]
    const tasks: Step[] = [
      {
        id: "t1_s1",
        taskId: "t1",
        teamId: "team",
        kind: "execution",
        round: 1,
        title: "a",
        description: "task a",
        moduleId: "a",
        status: "pending",
        dependencies: ["t2_s1"],
        files: ["src/a/index.ts"],
        createdAt: Date.now(),
      },
      {
        id: "t2_s1",
        taskId: "t2",
        teamId: "team",
        kind: "execution",
        round: 1,
        title: "b",
        description: "task b",
        moduleId: "b",
        status: "pending",
        dependencies: ["t1_s1"],
        files: ["src/b/index.ts"],
        createdAt: Date.now(),
      },
    ]

    const router = new TaskRouter(client, modules, members, dir, 2)
    await router.route(tasks)

    expect(tasks.every((task) => task.status === "completed")).toBe(true)
  })

  test("marks the engineer as error when a step fails", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "team-agent-"))
    dirs.push(dir)
    await mkdir(path.join(dir, "src", "a"), { recursive: true })
    await writeFile(path.join(dir, "src", "a", "index.ts"), "export const a = 1\n")

    const client = {
      session: {
        create: async () => ({ data: { id: "s1" } }),
        prompt: async (opts: { body: { noReply?: boolean } }) => {
          if (opts.body.noReply) return { data: { parts: [] } }
          throw new Error("step failed")
        },
        delete: async () => ({ data: true }),
      },
    } as never

    const member: Member = {
      id: "eng-a",
      teamId: "team",
      role: "engineer",
      scope: "module",
      name: "Engineer_A",
      moduleId: "a",
      modulePath: "src/a",
      status: "idle",
    }
    const modules: Module[] = [
      {
        id: "a",
        teamId: "team",
        path: "src/a",
        files: ["src/a/index.ts"],
        lineCount: 2,
        ownerId: "eng-a",
        imports: [],
        exports: ["export a"],
      },
    ]
    const tasks: Step[] = [
      {
        id: "t1_s1",
        taskId: "t1",
        teamId: "team",
        kind: "execution",
        round: 1,
        title: "a",
        description: "task a",
        moduleId: "a",
        status: "pending",
        dependencies: [],
        files: ["src/a/index.ts"],
        createdAt: Date.now(),
      },
    ]

    const router = new TaskRouter(client, modules, [member], dir, 1)
    await expect(router.route(tasks)).rejects.toThrow("step failed")
    expect(member.status).toBe("error")
    expect(tasks[0]?.status).toBe("error")
  })

  test("serializes steps that touch the same file even across different engineers", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "team-agent-"))
    dirs.push(dir)
    await mkdir(path.join(dir, "src", "a"), { recursive: true })
    await mkdir(path.join(dir, "src", "b"), { recursive: true })
    await writeFile(path.join(dir, "src", "a", "shared.ts"), "export const a = 1\n")
    await writeFile(path.join(dir, "src", "b", "index.ts"), "export const b = 1\n")

    const order: string[] = []
    let active = 0
    let max = 0
    const client = {
      session: {
        create: async () => ({ data: { id: `s${Date.now()}` } }),
        prompt: async (opts: { body: { noReply?: boolean; parts: { text: string }[] } }) => {
          if (opts.body.noReply) return { data: { parts: [] } }
          active++
          max = Math.max(max, active)
          order.push(opts.body.parts[0]!.text)
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

    const members: Member[] = [
      { id: "eng-a", teamId: "team", role: "engineer", scope: "module", name: "Engineer_A", moduleId: "a", modulePath: "src/a", status: "idle" },
      { id: "eng-b", teamId: "team", role: "engineer", scope: "module", name: "Engineer_B", moduleId: "b", modulePath: "src/b", status: "idle" },
    ]
    const modules: Module[] = [
      { id: "a", teamId: "team", path: "src/a", files: ["src/a/shared.ts"], lineCount: 2, ownerId: "eng-a", imports: [], exports: ["export a"] },
      { id: "b", teamId: "team", path: "src/b", files: ["src/b/index.ts"], lineCount: 2, ownerId: "eng-b", imports: [], exports: ["export b"] },
    ]
    const tasks: Step[] = [
      {
        id: "t1_s1",
        taskId: "t1",
        teamId: "team",
        kind: "execution",
        round: 1,
        title: "a",
        description: "task a",
        moduleId: "a",
        status: "pending",
        dependencies: [],
        files: ["src/shared.ts"],
        createdAt: Date.now(),
      },
      {
        id: "t2_s1",
        taskId: "t2",
        teamId: "team",
        kind: "execution",
        round: 1,
        title: "b",
        description: "task b",
        moduleId: "b",
        status: "pending",
        dependencies: [],
        files: ["src/shared.ts"],
        createdAt: Date.now(),
      },
    ]

    const router = new TaskRouter(client, modules, members, dir, 2)
    await router.route(tasks)

    expect(max).toBe(1)
    expect(tasks[1]?.dependencies).toContain("t1_s1")
    expect(order).toHaveLength(2)
  })
})
