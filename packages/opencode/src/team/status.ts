import { existsSync } from "fs"
import path from "path"
import { Database } from "bun:sqlite"
import z from "zod"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"

const role = z.enum(["pm", "architect", "engineer"])
const memberStatus = z.enum(["idle", "working", "completed", "error"])
const taskStatus = z.enum(["pending", "in_progress", "completed", "error"])
const queueState = z.enum(["active", "ready", "blocked"])
const focusMode = z.enum(["active", "next", "blocked"])
const executionStatus = z.enum(["idle", "running", "completed", "error"])
const runStatus = z.enum(["running", "completed", "error", "interrupted"])
const runPhase = z.enum(["scoping", "planning", "investigating", "executing", "completed", "error"])
const taskKind = z.enum(["investigation", "execution"])

export namespace TeamStatus {
  const log = Log.create({ service: "team.status" })
  const has = (db: Database, name: string) =>
    Boolean(db.query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`).get(name))
  const col = (db: Database, table: string, name: string) =>
    (db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((item) => item.name === name)

  export const Member = z.object({
    id: z.string(),
    role,
    name: z.string(),
    status: memberStatus,
    has_memory: z.boolean().optional(),
    memory_updated_at: z.number().optional(),
    focus_mode: focusMode.optional(),
    module_path: z.string().optional(),
    step_title: z.string().optional(),
    file_label: z.string().optional(),
    waiting_on: z.string().optional(),
    waiting_on_member: z.string().optional(),
  })

  export const Task = z.object({
    id: z.string(),
    kind: taskKind.optional(),
    round: z.number().optional(),
    title: z.string(),
    status: taskStatus,
    queue_state: queueState.optional(),
    waiting_on: z.string().optional(),
    waiting_on_member: z.string().optional(),
    assigned_to: z.string().optional(),
    module_path: z.string().optional(),
    started_at: z.number().optional(),
    completed_at: z.number().optional(),
  })

  export const Run = z.object({
    id: z.string(),
    requirement: z.string(),
    scope_summary: z.string(),
    status: runStatus,
    phase: runPhase.optional(),
    round: z.number().optional(),
    started_at: z.number(),
    heartbeat_at: z.number(),
    completed_at: z.number().optional(),
    error: z.string().optional(),
  })

  export const Summary = z.object({
    active: z.number(),
    queued: z.number(),
    failed: z.number(),
    blocked: z.number(),
    members: z.object({
      total: z.number(),
      working: z.number(),
      idle: z.number(),
      error: z.number(),
    }),
  })

  export const Focus = z.object({
    task_id: z.string(),
    step_id: z.string(),
    mode: z.enum(["active", "next"]),
    task_title: z.string(),
    step_title: z.string(),
    module_path: z.string().optional(),
    member_name: z.string().optional(),
    files: z.string().array(),
  })

  export const Resume = z.object({
    available: z.boolean(),
    pending: z.number(),
  })

  export const Info = z.object({
    team_id: z.string(),
    project_path: z.string(),
    updated_at: z.number(),
    execution: z.object({
      status: executionStatus,
      completed: z.number(),
      total: z.number(),
      progress: z.number(),
    }),
    run: Run.nullable(),
    resume: Resume,
    summary: Summary,
    focus: Focus.nullable(),
    members: Member.array(),
    tasks: Task.array(),
  })

  export const Event = {
    Updated: BusEvent.define("team.updated", z.object({ info: Info.nullable() })),
  }

  function file(directory: string) {
    return path.join(directory, ".opencode", "team-agent", "teams.db")
  }

  export function current(directory = Instance.directory): z.infer<typeof Info> | null {
    const dbfile = file(directory)
    if (!existsSync(dbfile)) return null

    const db = new Database(dbfile, { readonly: true, create: false })

    try {
      try {
        const teamMax = col(db, "teams", "max_parallel") ? "COALESCE(max_parallel, 3) AS max_parallel" : "3 AS max_parallel"
        const memberMemory = col(db, "members", "memory") ? "memory" : "NULL AS memory"
        const memberMemoryAt = col(db, "members", "memory_updated_at") ? "memory_updated_at" : "NULL AS memory_updated_at"
        const runPhaseCol = col(db, "runs", "phase") ? "phase" : "NULL AS phase"
        const runRoundCol = col(db, "runs", "round") ? "round" : "1 AS round"
        const taskKindCol = col(db, "tasks", "kind") ? "tasks.kind" : "'execution' AS kind"
        const taskRoundCol = col(db, "tasks", "round") ? "tasks.round" : "1 AS round"

        const team = db
          .query(
            `
              SELECT id, project_path, updated_at, ${teamMax}
              FROM teams
              WHERE project_path = ?
              ORDER BY updated_at DESC
              LIMIT 1
            `,
          )
          .get(directory) as
          | {
              id: string
              project_path: string
              updated_at: number
              max_parallel: number
            }
          | undefined

        if (!team) return null

        const members = db
          .query(
            `
              SELECT id, role, name, status, ${memberMemory}, ${memberMemoryAt}
              FROM members
              WHERE team_id = ?
              ORDER BY
                CASE role
                  WHEN 'pm' THEN 0
                  WHEN 'architect' THEN 1
                  ELSE 2
                END,
                name
            `,
          )
          .all(team.id) as z.infer<typeof Member>[]

        const run = db
          .query(
            `
              SELECT
                id,
                requirement,
                scope_summary,
                status,
                ${runPhaseCol},
                ${runRoundCol},
                started_at,
                heartbeat_at,
                completed_at,
                error
              FROM runs
              WHERE team_id = ?
              ORDER BY created_at DESC
              LIMIT 1
            `,
          )
          .get(team.id) as
          | {
              id: string
              requirement: string
              scope_summary: string
              status: z.infer<typeof runStatus>
              phase?: z.infer<typeof runPhase>
              round?: number
              started_at: number
              heartbeat_at: number
              completed_at?: number
              error?: string
            }
          | undefined

        const raw = db
          .query(
            `
              SELECT
                tasks.id,
                ${taskKindCol},
                ${taskRoundCol},
                tasks.title,
                tasks.status,
                tasks.assigned_to,
                tasks.started_at,
                tasks.completed_at,
                tasks.dependencies,
                modules.path AS module_path
              FROM tasks
              LEFT JOIN modules ON modules.id = tasks.module_id
              WHERE ${run ? "tasks.run_id = ?" : "tasks.team_id = ?"}
              ORDER BY
                CASE tasks.status
                  WHEN 'in_progress' THEN 0
                  WHEN 'pending' THEN 1
                  WHEN 'error' THEN 2
                  ELSE 3
                END,
                tasks.created_at DESC
            `,
          )
          .all(run ? run.id : team.id) as Array<
          z.infer<typeof Task> & {
            dependencies?: string | null
          }
        >
        const flow = run && has(db, "steps")
          ? db
              .query(
                `
                  SELECT
                    steps.id,
                    steps.task_id,
                    steps.title AS step_title,
                    steps.status,
                    steps.dependencies,
                    steps.files,
                    tasks.title AS task_title,
                    modules.path AS module_path,
                    members.name AS member_name
                  FROM steps
                  LEFT JOIN tasks ON tasks.id = steps.task_id
                  LEFT JOIN modules ON modules.id = COALESCE(steps.module_id, tasks.module_id)
                  LEFT JOIN members ON members.id = steps.assigned_to
                  WHERE steps.run_id = ?
                  ORDER BY
                    CASE steps.status
                      WHEN 'in_progress' THEN 0
                      WHEN 'pending' THEN 1
                      WHEN 'error' THEN 2
                      ELSE 3
                    END,
                    COALESCE(steps.started_at, steps.created_at) ASC
                `,
              )
              .all(run.id) as Array<{
              id: string
              task_id: string
              step_title: string
              task_title?: string
              status: z.infer<typeof taskStatus>
              dependencies?: string | null
              files?: string | null
              module_path?: string | null
              member_name?: string | null
            }>
          : []
        const byStep = new Map(flow.map((step) => [step.id, step]))
        const byTask = new Map(raw.map((task) => [task.id, task]))
        const fileLabel = (raw?: string | null) => {
          const files = raw ? JSON.parse(raw) as string[] : []
          if (files.length === 0) return
          if (files.length === 1) return path.basename(files[0]!)
          return `${files.length} files`
        }
        const blockedBy = (ids: string[]) => {
          const seen = new Set<string>()
          const list = ids.flatMap((id) => {
            const step = byStep.get(id)
            if (step) {
              const path = step.module_path ?? step.task_title ?? step.step_title
              const key = `${path}|${step.member_name ?? ""}`
              if (seen.has(key)) return []
              seen.add(key)
              return [{ path, member: step.member_name ?? undefined }]
            }
            const task = byTask.get(id)
            if (!task) return []
            const path = task.module_path ?? task.title
            const key = `${path}|`
            if (seen.has(key)) return []
            seen.add(key)
            return [{ path, member: undefined }]
          })
          if (list.length === 0) return {}
          if (list.length === 1) return {
            waiting_on: list[0]!.path,
            waiting_on_member: list[0]!.member,
          }
          return {
            waiting_on: `${list[0]!.path} +${list.length - 1}`,
            waiting_on_member: list[0]!.member,
          }
        }

        const done = new Set(raw.filter((task) => task.status === "completed").map((task) => task.id))
        const seen = new Set(flow.filter((step) => step.status === "completed").map((step) => step.id))
        const wait = new Set(
          flow
            .filter((step) => {
              if (step.status !== "pending") return false
              const deps = step.dependencies ? JSON.parse(step.dependencies) : []
              return deps.some((id: string) => !seen.has(id))
            })
            .map((step) => step.id),
        )
        const pending = new Map<string, string[]>()
        const push = (taskId: string, stepId: string) => {
          const list = pending.get(taskId)
          if (list) {
            list.push(stepId)
            return
          }
          pending.set(taskId, [stepId])
        }
        flow
          .filter((step) => step.status === "pending")
          .forEach((step) => push(step.task_id, step.id))
        const blockedIds = new Set(
          flow.length > 0
            ? [...pending.entries()]
                .filter(([_, list]) => list.length > 0 && list.every((id) => wait.has(id)))
                .map(([taskId]) => taskId)
            : raw
                .filter((task) => {
                  if (task.status !== "pending") return false
                  const deps = task.dependencies ? JSON.parse(task.dependencies) : []
                  return deps.some((id: string) => !done.has(id))
                })
                .map((task) => task.id),
        )
        const tasks = raw.map((task, idx) => ({
          deps: task.dependencies ? JSON.parse(task.dependencies) : [],
          id: task.id,
          kind: task.kind,
          round: task.round,
          title: task.title,
          status: task.status,
          queue_state:
            task.status === "in_progress"
              ? "active" as const
              : task.status === "pending"
                ? blockedIds.has(task.id)
                  ? "blocked" as const
                  : "ready" as const
                : undefined,
          waiting_on:
            task.status === "pending" && blockedIds.has(task.id)
              ? flow.length > 0
                ? blockedBy(
                    flow
                      .filter((step) => step.task_id === task.id && step.status === "pending")
                      .flatMap((step) => {
                        const deps = step.dependencies ? JSON.parse(step.dependencies) : []
                        return deps.filter((id: string) => !seen.has(id))
                      }),
                  ).waiting_on
                : blockedBy((task.dependencies ? JSON.parse(task.dependencies) : []).filter((id: string) => !done.has(id))).waiting_on
              : undefined,
          waiting_on_member:
            task.status === "pending" && blockedIds.has(task.id)
              ? flow.length > 0
                ? blockedBy(
                    flow
                      .filter((step) => step.task_id === task.id && step.status === "pending")
                      .flatMap((step) => {
                        const deps = step.dependencies ? JSON.parse(step.dependencies) : []
                        return deps.filter((id: string) => !seen.has(id))
                      }),
                  ).waiting_on_member
                : blockedBy((task.dependencies ? JSON.parse(task.dependencies) : []).filter((id: string) => !done.has(id))).waiting_on_member
              : undefined,
          assigned_to: task.assigned_to,
          module_path: task.module_path,
          started_at: task.started_at,
          completed_at: task.completed_at,
          idx,
        }))
        const completed = tasks.filter((task) => task.status === "completed").length
        const total = tasks.length
        const failed = tasks.filter((task) => task.status === "error").length
        const blocked = tasks.filter((task) => task.queue_state === "blocked").length
        const active = tasks.filter((task) => task.status === "in_progress").length
        const queued = Math.max(0, tasks.filter((task) => task.status === "pending").length - blocked)
        const pick = flow.find((step) => step.status === "in_progress") ?? flow.find((step) => step.status === "pending" && !wait.has(step.id))
        const byName = new Map(members.map((member) => [member.name, member]))
        const extra = new Map<string, Pick<z.infer<typeof Member>, "focus_mode" | "module_path" | "step_title" | "file_label" | "waiting_on" | "waiting_on_member">>()
        const note = (step: typeof flow[number], mode: z.infer<typeof focusMode>) => {
          if (!step.member_name) return
          const member = byName.get(step.member_name)
          if (!member || extra.has(member.id)) return
          const deps = step.dependencies ? JSON.parse(step.dependencies) : []
          const wait = mode === "blocked" ? blockedBy(deps.filter((id: string) => !seen.has(id))) : {}
          extra.set(member.id, {
            focus_mode: mode,
            module_path: step.module_path ?? undefined,
            step_title: step.step_title,
            file_label: fileLabel(step.files),
            waiting_on: wait.waiting_on,
            waiting_on_member: wait.waiting_on_member,
          })
        }
        flow
          .filter((step) => step.status === "in_progress")
          .forEach((step) => note(step, "active"))
        flow
          .filter((step) => step.status === "pending" && !wait.has(step.id))
          .forEach((step) => note(step, "next"))
        flow
          .filter((step) => step.status === "pending" && wait.has(step.id))
          .forEach((step) => note(step, "blocked"))
        const focusTaskId = pick?.task_id
        tasks.sort((a, b) => {
          const rank = (task: typeof tasks[number]) => {
            if (task.id === focusTaskId) return 0
            if (task.queue_state === "active") return 1
            if (task.queue_state === "ready") return 2
            if (task.queue_state === "blocked") return 3
            if (task.status === "error") return 4
            if (task.status === "completed") return 5
            return 6
          }
          return rank(a) - rank(b) || a.idx - b.idx
        })
        const status = (() => {
          if (total === 0) return "idle" as const
          if (run?.status === "interrupted") return "error" as const
          if (run?.status === "error") return "error" as const
          if (run?.status === "completed") return "completed" as const
          if (run?.status === "running") return "running" as const
          if (tasks.some((task) => task.status === "error")) return "error" as const
          if (completed === total) return "completed" as const
          return "running" as const
        })()

        return {
          team_id: team.id,
          project_path: team.project_path,
          updated_at: team.updated_at,
          execution: {
            status,
            completed,
            total,
            progress: total === 0 ? 0 : Math.round((completed / total) * 100),
          },
          run: run
            ? {
                id: run.id,
                requirement: run.requirement,
                scope_summary: run.scope_summary,
                status: run.status,
                phase: run.phase,
                round: run.round,
                started_at: run.started_at,
                heartbeat_at: run.heartbeat_at,
                completed_at: run.completed_at,
                error: run.error,
              }
            : null,
          resume: {
            available: !!run && run.status !== "completed" && tasks.some((task) => task.status !== "completed"),
            pending: flow.length > 0
              ? flow.filter((step) => step.status !== "completed").length
              : tasks.filter((task) => task.status !== "completed").length,
          },
          summary: {
            active,
            queued,
            failed,
            blocked,
            members: {
              total: members.length,
              working: members.filter((member) => member.status === "working").length,
              idle: members.filter((member) => member.status === "idle" || member.status === "completed").length,
              error: members.filter((member) => member.status === "error").length,
            },
          },
          focus: pick
            ? {
                task_id: pick.task_id,
                step_id: pick.id,
                mode: pick.status === "in_progress" ? "active" : "next",
                task_title: pick.task_title ?? pick.step_title,
                step_title: pick.step_title,
                module_path: pick.module_path ?? undefined,
                member_name: pick.member_name ?? undefined,
                files: pick.files ? JSON.parse(pick.files) : [],
              }
            : null,
          members: members.map((member) => ({
            ...member,
            has_memory: Boolean((member as { memory?: string | null }).memory),
            memory_updated_at: (member as { memory_updated_at?: number | null }).memory_updated_at ?? undefined,
            ...extra.get(member.id),
          })),
          tasks: tasks.map(({ idx: _, deps: __, ...task }) => task),
        }
      } catch (error) {
        log.error("failed to read team status", {
          directory,
          dbfile,
          error,
        })
        return null
      }
    } finally {
      db.close()
    }
  }

  export async function publish(info = current()) {
    await Bus.publish(Event.Updated, { info })
  }
}
