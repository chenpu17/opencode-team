import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { EngineerAgent } from "../src/agent/engineer"
import type { Member, Module, Step } from "../src/types"

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("EngineerAgent", () => {
  test("injects module context before sending the task prompt", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "team-agent-"))
    dirs.push(dir)
    await mkdir(path.join(dir, "src", "auth"), { recursive: true })
    await mkdir(path.join(dir, "src", "api"), { recursive: true })
    await writeFile(path.join(dir, "src", "auth", "index.ts"), "export function login() {}\n")
    await writeFile(path.join(dir, "src", "api", "route.ts"), 'import { login } from "../auth"\nexport function route() { return login() }\n')

    const calls: { noReply?: boolean; text: string }[] = []
    const client = {
      session: {
        create: async () => ({ data: { id: "s1" } }),
        prompt: async (opts: { body: { noReply?: boolean; parts: { text: string }[] } }) => {
          calls.push({
            noReply: opts.body.noReply,
            text: opts.body.parts[0]!.text,
          })
          return {
            data: {
              parts: [{ type: "text", text: "done" }],
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
      name: "Engineer_API",
      moduleId: "api",
      modulePath: "src/api",
      status: "idle",
    }
    const auth: Module = {
      id: "auth",
      teamId: "team",
      path: "src/auth",
      files: ["src/auth/index.ts"],
      lineCount: 2,
      imports: [],
      exports: ["index.ts: export function login() {}"],
    }
    const api: Module = {
      id: "api",
      teamId: "team",
      path: "src/api",
      files: ["src/api/route.ts"],
      lineCount: 2,
      ownerId: "eng",
      imports: ["src/auth"],
      exports: ["export route"],
    }
    const task: Step = {
      id: "step",
      taskId: "task",
      teamId: "team",
      kind: "execution",
      round: 1,
      title: "api: login",
      description: "实现登录路由",
      moduleId: "api",
      status: "pending",
      dependencies: [],
      files: ["src/api/route.ts"],
      createdAt: Date.now(),
    }

    const agent = new EngineerAgent(client, member, api, [auth, api], dir)
    await agent.execute(task)

    expect(calls[0]?.noReply).toBe(true)
    expect(calls[0]?.text).toContain("Selected Files:")
    expect(calls[0]?.text).toContain("Dependency Interfaces:")
    expect(calls[0]?.text).toContain("- index.ts: export function login() {}")
    expect(calls[1]?.noReply).toBeUndefined()
    expect(calls[1]?.text).toContain("任务标题")
  })

  test("focuses context on task-relevant files when the module is large", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "team-agent-"))
    dirs.push(dir)
    await mkdir(path.join(dir, "src", "auth"), { recursive: true })
    await writeFile(
      path.join(dir, "src", "auth", "login.ts"),
      Array.from({ length: 260 }, (_, i) =>
        i === 120 ? "export async function loginWithPassword() { return validatePassword() }" : `const a${i} = ${i}`,
      ).join("\n"),
    )
    await writeFile(
      path.join(dir, "src", "auth", "oauth.ts"),
      Array.from({ length: 260 }, (_, i) =>
        i === 80 ? "export async function loginWithGithub() { return exchangeGithubCode() }" : `const b${i} = ${i}`,
      ).join("\n"),
    )
    await writeFile(
      path.join(dir, "src", "auth", "report.ts"),
      Array.from({ length: 260 }, (_, i) =>
        i === 90 ? "export function buildMonthlyReport() { return 1 }" : `const c${i} = ${i}`,
      ).join("\n"),
    )

    const calls: { noReply?: boolean; text: string }[] = []
    const client = {
      session: {
        create: async () => ({ data: { id: "s1" } }),
        prompt: async (opts: { body: { noReply?: boolean; parts: { text: string }[] } }) => {
          calls.push({
            noReply: opts.body.noReply,
            text: opts.body.parts[0]!.text,
          })
          return {
            data: {
              parts: [{ type: "text", text: "done" }],
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
      name: "Engineer_Auth",
      moduleId: "auth",
      modulePath: "src/auth",
      status: "idle",
    }
    const auth: Module = {
      id: "auth",
      teamId: "team",
      path: "src/auth",
      files: ["src/auth/login.ts", "src/auth/oauth.ts", "src/auth/report.ts"],
      lineCount: 780,
      ownerId: "eng",
      imports: [],
      exports: ["export loginWithPassword", "export loginWithGithub"],
      summary: "authentication flows",
    }
    const task: Step = {
      id: "step",
      taskId: "task",
      teamId: "team",
      kind: "execution",
      round: 1,
      title: "src/auth",
      description: "实现 login oauth password 流程并评估风险",
      moduleId: "auth",
      status: "pending",
      dependencies: [],
      files: ["src/auth/login.ts", "src/auth/oauth.ts"],
      createdAt: Date.now(),
    }

    const agent = new EngineerAgent(client, member, auth, [auth], dir)
    await agent.execute(task)

    expect(calls[0]?.text).toContain("### src/auth/login.ts")
    expect(calls[0]?.text).toContain("### src/auth/oauth.ts")
    expect(calls[0]?.text).toContain("Selected Files: 2/3")
    expect(calls[0]?.text).not.toContain("buildMonthlyReport")
  })

  test("injects member memory into the execution context", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "team-agent-"))
    dirs.push(dir)
    await mkdir(path.join(dir, "src", "auth"), { recursive: true })
    await writeFile(path.join(dir, "src", "auth", "index.ts"), "export function login() {}\n")

    const calls: { noReply?: boolean; text: string }[] = []
    const client = {
      session: {
        create: async () => ({ data: { id: "s1" } }),
        prompt: async (opts: { body: { noReply?: boolean; parts: { text: string }[] } }) => {
          calls.push({
            noReply: opts.body.noReply,
            text: opts.body.parts[0]!.text,
          })
          return {
            data: {
              parts: [{ type: "text", text: "done" }],
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
      name: "Engineer_Auth",
      moduleId: "auth",
      modulePath: "src/auth",
      memory: "调查结论 src/auth/login.ts 中 token 生成链路容易出错",
      status: "idle",
    }
    const auth: Module = {
      id: "auth",
      teamId: "team",
      path: "src/auth",
      files: ["src/auth/index.ts"],
      lineCount: 2,
      ownerId: "eng",
      imports: [],
      exports: ["export login"],
      summary: "authentication flows",
    }
    const task: Step = {
      id: "step",
      taskId: "task",
      teamId: "team",
      kind: "execution",
      round: 1,
      title: "src/auth",
      description: "修复 token 生成",
      moduleId: "auth",
      status: "pending",
      dependencies: [],
      files: ["src/auth/index.ts"],
      createdAt: Date.now(),
    }

    const agent = new EngineerAgent(client, member, auth, [auth], dir)
    await agent.execute(task)

    expect(calls[0]?.text).toContain("Member Memory:")
    expect(calls[0]?.text).toContain("token 生成链路容易出错")
  })
})
