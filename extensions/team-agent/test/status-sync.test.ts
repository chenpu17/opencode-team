import { describe, expect, test } from "bun:test"
import { StatusSync } from "../src/ui/status-sync"
import type { Member, Task } from "../src/types"

const info = (time: number) => ({
  team_id: "team",
  project_path: "/tmp/project",
  updated_at: time,
  execution: {
    status: "running",
    completed: 0,
    total: 1,
    progress: 0,
  },
  run: {
    id: "run",
    requirement: "req",
    scope_summary: "scope",
    status: "running",
    started_at: 1,
    heartbeat_at: time,
  },
  summary: {
    active: 1,
    queued: 0,
    failed: 0,
    blocked: 0,
    members: {
      total: 1,
      working: 1,
      idle: 0,
      error: 0,
    },
  },
  focus: null,
  members: [],
  tasks: [],
})

describe("StatusSync", () => {
  test("coalesces rapid team updates into one publish", async () => {
    let reads = 0
    const sent: any[] = []
    const sync = new StatusSync({
      _client: {
        get: async () => {
          reads++
          return info(1)
        },
      },
      tui: {
        publish: async (input: any) => {
          sent.push(input)
          return { data: true }
        },
      },
    } as never)

    await sync.updateTeamStatus([])
    await sync.updateTeamStatus([])
    await sync.updateTeamStatus([])
    await Bun.sleep(260)

    expect(reads).toBe(1)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.body.type).toBe("team.updated")
  })

  test("skips publish when only timestamps changed", async () => {
    let reads = 0
    const sent: any[] = []
    const list = [info(1), info(2)]
    const sync = new StatusSync({
      _client: {
        get: async () => {
          const item = list[Math.min(reads, list.length - 1)]!
          reads++
          return item
        },
      },
      tui: {
        publish: async (input: any) => {
          sent.push(input)
          return { data: true }
        },
      },
    } as never)

    await sync.updateTeamStatus([])
    await Bun.sleep(260)
    await sync.updateTeamStatus([])
    await Bun.sleep(260)

    expect(reads).toBe(2)
    expect(sent).toHaveLength(1)
  })

  test("does not repeat the same error toast", async () => {
    const sent: any[] = []
    const member: Member = {
      id: "eng",
      teamId: "team",
      role: "engineer",
      scope: "module",
      name: "Engineer",
      moduleId: "task",
      modulePath: "src/task",
      status: "error",
    }
    const task: Task = {
      id: "task",
      teamId: "team",
      kind: "execution",
      round: 1,
      title: "src/core",
      description: "fix",
      assignedTo: "eng",
      status: "error",
      dependencies: [],
      createdAt: 1,
      error: "boom",
    }
    const sync = new StatusSync({
      _client: {
        get: async () => null,
      },
      tui: {
        publish: async (input: any) => {
          sent.push(input)
          return { data: true }
        },
      },
    } as never)

    await sync.updateTeamStatus([member], [task])
    await sync.updateTeamStatus([member], [task])
    await Bun.sleep(260)

    const toast = sent.filter((item) => item.body.type === "tui.toast.show")
    expect(toast).toHaveLength(1)
  })
})
