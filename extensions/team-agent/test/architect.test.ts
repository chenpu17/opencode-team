import { describe, expect, test } from "bun:test"
import { ArchitectAgent } from "../src/agent/architect"
import type { Member, Module } from "../src/types"

describe("ArchitectAgent", () => {
  test("turns module imports into task dependencies", async () => {
    const member: Member = {
      id: "arch",
      teamId: "team",
      role: "architect",
      scope: "global",
      name: "Architect",
      status: "idle",
    }
    const modules: Module[] = [
      {
        id: "auth",
        teamId: "team",
        path: "src/auth",
        files: ["src/auth/index.ts"],
        lineCount: 10,
        ownerId: "eng-1",
        imports: [],
        exports: ["export login"],
      },
      {
        id: "api",
        teamId: "team",
        path: "src/api",
        files: ["src/api/index.ts"],
        lineCount: 10,
        ownerId: "eng-2",
        imports: ["src/auth"],
        exports: ["export route"],
      },
    ]

    const agent = new ArchitectAgent({} as never, member, modules)
    const plan = await agent.execute({
      requirement: "add login",
      scope: {
        summary: "聚焦登录链路",
        moduleIds: modules.map((mod) => mod.id),
      },
      mode: "execution",
    })
    const auth = plan.tasks.find((task) => task.moduleId === "auth")
    const api = plan.tasks.find((task) => task.moduleId === "api")
    const authStep = plan.steps.filter((step) => step.taskId === auth?.id)
    const apiStep = plan.steps.filter((step) => step.taskId === api?.id)

    expect(auth?.dependencies).toEqual([])
    expect(auth?.kind).toBe("execution")
    expect(api?.dependencies).toEqual([auth!.id])
    expect(auth?.title).toBe("src/auth")
    expect(api?.title).toBe("src/api")
    expect(api?.description).toContain("目标: add login")
    expect(auth?.stepCount).toBe(authStep.length)
    expect(api?.stepCount).toBe(apiStep.length)
    expect(apiStep[0]?.kind).toBe("execution")
    expect(apiStep[0]?.dependencies).toContain(authStep.at(-1)?.id)
  })

  test("builds investigation plan for issue-like requirements and can narrow follow-up scope", async () => {
    const member: Member = {
      id: "arch",
      teamId: "team",
      role: "architect",
      scope: "global",
      name: "Architect",
      status: "idle",
    }
    const modules: Module[] = [
      {
        id: "shell",
        teamId: "team",
        path: "src/shell",
        files: ["src/shell/index.ts"],
        lineCount: 10,
        ownerId: "eng-1",
        imports: [],
        exports: ["export shell"],
      },
      {
        id: "auth",
        teamId: "team",
        path: "src/auth",
        files: ["src/auth/index.ts"],
        lineCount: 10,
        ownerId: "eng-2",
        imports: [],
        exports: ["export auth"],
      },
      {
        id: "api",
        teamId: "team",
        path: "src/api",
        files: ["src/api/index.ts"],
        lineCount: 10,
        ownerId: "eng-3",
        imports: [],
        exports: ["export api"],
      },
    ]

    const agent = new ArchitectAgent({} as never, member, modules)
    expect(agent.needsInvestigation("fix login bug in api")).toBe(true)

    const plan = await agent.execute({
      requirement: "fix login bug in api",
      scope: {
        summary: "登录问题",
        moduleIds: modules.map((mod) => mod.id),
      },
      mode: "investigation",
      round: 1,
    })

    expect(plan.kind).toBe("investigation")
    expect(plan.tasks.every((task) => task.kind === "investigation")).toBe(true)
    expect(plan.steps.every((step) => step.kind === "investigation")).toBe(true)

    const next = agent.review(
      "fix login bug in api",
      {
        summary: "登录问题",
        moduleIds: modules.map((mod) => mod.id),
      },
      [
        {
          moduleId: "api",
          stepId: "s1",
          taskId: "t1",
          summary: "需要协助 src/auth，登录 token 校验链路异常",
        },
      ],
      1,
    )

    expect(next.mode).toBe("investigation")
    expect(next.scope.moduleIds).toEqual(["auth"])
  })
})
