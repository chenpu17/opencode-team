import type { createOpencodeClient } from "@opencode-ai/sdk"
import type { Member, Task } from "../types"
import { error as logError } from "../util/logger"

const TEAM_DELAY = 200

export class StatusSync {
  private timer?: ReturnType<typeof setTimeout>
  private pending = false
  private last?: string
  private error = new Map<string, string>()

  constructor(private client: ReturnType<typeof createOpencodeClient>) {}

  async start() {
    return
  }

  async updateMemberStatus(member: Member, task?: Task) {
    if (member.status !== "error") return
    const key = [task?.id ?? "", task?.error ?? "", task?.title ?? ""].join("|")
    if (this.error.get(member.id) === key) return
    this.error.set(member.id, key)

    try {
      await this.client.tui.publish({
        body: {
          type: "tui.toast.show",
          properties: {
            title: "Team Agent",
            message: task ? `${member.name} 执行失败: ${task.title}` : `${member.name} 执行失败`,
            variant: "error",
          },
        },
      })
    } catch (err) {
      logError("StatusSync", "Failed to publish status", err)
    }
  }

  async updateTeamStatus(members: Member[], tasks: Task[] = []) {
    for (const member of members) {
      await this.updateMemberStatus(member, tasks.find((task) => task.assignedTo === member.id))
    }

    this.pending = true
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush()
    }, TEAM_DELAY)
    this.timer.unref?.()
  }

  private async flush() {
    if (!this.pending) return
    this.pending = false

    try {
      const info = (await (this.client as any)._client.get({
        url: "/team",
        responseStyle: "data",
        throwOnError: true,
      })) ?? null
      const next = this.hash(info)
      if (this.last === next) return
      this.last = next
      await (this.client as any).tui?.publish?.({
        body: {
          type: "team.updated",
          properties: { info },
        },
      })
    } catch (err) {
      logError("StatusSync", "Failed to publish team update", err)
    } finally {
      if (this.pending && !this.timer) {
        this.timer = setTimeout(() => {
          this.timer = undefined
          void this.flush()
        }, TEAM_DELAY)
        this.timer.unref?.()
      }
    }
  }

  private hash(info: any) {
    if (!info) return "null"
    return JSON.stringify({
      execution: info.execution,
      run: info.run
        ? {
            id: info.run.id,
            requirement: info.run.requirement,
            scope_summary: info.run.scope_summary,
            status: info.run.status,
            phase: info.run.phase,
            round: info.run.round,
            started_at: info.run.started_at,
            completed_at: info.run.completed_at,
            error: info.run.error,
          }
        : null,
      resume: info.resume,
      summary: info.summary,
      focus: info.focus,
      members: info.members,
      tasks: info.tasks,
    })
  }
}
