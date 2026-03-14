import { Collapsible } from "@opencode-ai/ui/collapsible"
import { Progress } from "@opencode-ai/ui/progress"
import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup } from "solid-js"
import { useSDK } from "@/context/sdk"

export type Team = {
  team_id: string
  project_path: string
  updated_at: number
  execution: {
    status: "idle" | "running" | "completed" | "error"
    completed: number
    total: number
    progress: number
  }
  resume: {
    available: boolean
    pending: number
  }
  run: {
    id: string
    requirement: string
    scope_summary: string
    status: "running" | "completed" | "error" | "interrupted"
    phase?: "scoping" | "planning" | "investigating" | "executing" | "completed" | "error"
    round?: number
    started_at: number
    heartbeat_at: number
    completed_at?: number
    error?: string
  } | null
  summary: {
    active: number
    queued: number
    failed: number
    blocked: number
    members: {
      total: number
      working: number
      idle: number
      error: number
    }
  }
  focus: {
    task_id: string
    step_id: string
    mode: "active" | "next"
    task_title: string
    step_title: string
    module_path?: string
    member_name?: string
    files: string[]
  } | null
  members: {
    id: string
    role: "pm" | "architect" | "engineer"
    name: string
    status: "idle" | "working" | "completed" | "error"
    has_memory?: boolean
    memory_updated_at?: number
    focus_mode?: "active" | "next" | "blocked"
    module_path?: string
    step_title?: string
    file_label?: string
    waiting_on?: string
    waiting_on_member?: string
  }[]
  tasks: {
    id: string
    kind?: "investigation" | "execution"
    round?: number
    title: string
    status: "pending" | "in_progress" | "completed" | "error"
    queue_state?: "active" | "ready" | "blocked"
    waiting_on?: string
    waiting_on_member?: string
    assigned_to?: string
    module_path?: string
    started_at?: number
    completed_at?: number
  }[]
}

export function createSessionTeamStatus(directory: () => string | undefined) {
  const sdk = useSDK()
  const pace = (status?: Team["execution"]["status"] | null) => {
    if (status === "running" || status === "error") return 15000
    return 60000
  }
  const source = createMemo(() => {
    const dir = directory()
    if (!dir) return
    return dir
  })
  const [team, { refetch, mutate }] = createResource(source, async () => {
    return sdk.client.app
      .team({ directory: source() })
      .then((result) => (result.data ?? null) as Team | null)
      .catch(() => null)
  })

  createEffect(() => {
    if (!source()) {
      mutate(null)
      return
    }

    void refetch()
    const timer = window.setInterval(() => {
      void refetch()
    }, pace(team()?.execution.status))
    onCleanup(() => window.clearInterval(timer))
  })

  createEffect(() => {
    if (!source()) return
    const stop = sdk.event.on("team.updated", (evt) => {
      mutate(evt.properties.info as Team | null)
    })
    onCleanup(stop)
  })

  return team
}

function tone(status: Team["execution"]["status"] | Team["members"][number]["status"] | Team["tasks"][number]["status"] | "blocked") {
  if (status === "completed") return "bg-icon-success-base text-text-on-success-base"
  if (status === "working" || status === "in_progress" || status === "running") return "bg-icon-info-base text-text-strong"
  if (status === "error") return "bg-icon-critical-base text-text-on-critical-base"
  return "bg-icon-warning-base text-text-weak"
}

function label(status: Team["execution"]["status"] | Team["members"][number]["status"] | Team["tasks"][number]["status"] | "blocked") {
  if (status === "working") return "working"
  if (status === "in_progress") return "in progress"
  return status
}
function memberLabel(member: Team["members"][number]) {
  if (!member.module_path) return member.role
  return `${member.role} · ${member.focus_mode ?? "next"}`
}

function phaseLabel(phase?: NonNullable<Team["run"]>["phase"]) {
  if (!phase) return "unknown"
  if (phase === "investigating") return "investigating"
  return phase
}

export function SessionTeamPanel(props: {
  team: () => Team | null | undefined
  sidebar?: boolean
}) {
  const [open, setOpen] = createSignal(true)

  createEffect(() => {
    const status = props.team()?.execution.status
    if (!status) return
    setOpen(status === "running" || status === "error")
  })

  const members = createMemo(() =>
    [...(props.team()?.members ?? [])].sort((a, b) => {
      const rank = (role: Team["members"][number]["role"]) => (role === "pm" ? 0 : role === "architect" ? 1 : 2)
      return rank(a.role) - rank(b.role) || a.name.localeCompare(b.name)
    }),
  )
  const tasks = createMemo(() =>
    (props.team()?.tasks ?? [])
      .filter((task) => task.status !== "completed")
      .filter((task) => task.id !== props.team()?.focus?.task_id)
      .slice(0, props.sidebar ? 6 : 8),
  )
  const queued = createMemo(() => props.team()?.summary.queued ?? 0)
  const active = createMemo(() => props.team()?.summary.active ?? 0)
  const blocked = createMemo(() => props.team()?.summary.blocked ?? 0)
  const taskTone = (task: Team["tasks"][number]) => tone(task.queue_state === "blocked" ? "blocked" : task.status)
  const taskLabel = (task: Team["tasks"][number]) => label(task.queue_state === "blocked" ? "blocked" : task.status)

  return (
    <Show when={props.team()}>
      {(team) => (
        <section classList={{ "px-4 pt-3 md:px-5 md:pt-4": !props.sidebar }}>
          <div
            classList={{
              "rounded-2xl border border-border-weaker-base bg-background-base px-4 py-3 shadow-xs": !props.sidebar,
              "border-b border-border-weaker-base bg-background-base px-3 py-3": !!props.sidebar,
            }}
          >
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <div class="text-12-medium uppercase tracking-[0.12em] text-text-weak">Team</div>
                <div class="mt-1 flex items-center gap-2">
                  <div class="text-15-medium text-text-strong">Virtual workspace team</div>
                  <div class={`inline-flex items-center rounded-full px-2 py-0.5 text-11-medium ${tone(team().execution.status)}`}>
                    {label(team().execution.status)}
                  </div>
                </div>
                <div class="mt-1 text-12-regular text-text-weak">
                  {team().execution.completed} of {team().execution.total} tasks completed
                  <Show when={active() > 0}> · {active()} active</Show>
                  <Show when={queued() > 0}> · {queued()} queued</Show>
                  <Show when={blocked() > 0}> · {blocked()} blocked</Show>
                </div>
                <Show when={team().run}>
                  <div class="mt-1 text-12-regular text-text-weak">
                    phase {phaseLabel(team().run!.phase)} · round {team().run!.round ?? 1}
                  </div>
                </Show>
                <Show when={team().resume.available}>
                  <div class="mt-1 text-12-regular text-text-weak">
                    Resume available · {team().resume.pending} steps pending
                  </div>
                </Show>
              </div>
              <div class="text-right text-12-regular text-text-weak">
                <div>{members().length} members</div>
                <div>{new Date(team().updated_at).toLocaleTimeString()}</div>
              </div>
            </div>

            <div class="mt-3">
              <Progress value={team().execution.progress} maxValue={100} showValueLabel>
                Progress
              </Progress>
            </div>

            <Show when={team().focus}>
              <div class="mt-3 rounded-xl border border-border-weaker-base bg-background-stronger px-3 py-2">
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-11-medium uppercase tracking-[0.08em] text-text-weak">
                      {team().focus!.mode === "active" ? "Active step" : "Next step"}
                    </div>
                    <div class="truncate text-13-medium text-text-strong">
                      {team().focus!.module_path ?? team().focus!.task_title}
                    </div>
                    <div class="truncate text-12-regular text-text-weak">{team().focus!.step_title}</div>
                  </div>
                  <div class="shrink-0 text-right text-11-regular text-text-weak">
                    <Show when={team().focus!.member_name}>
                      <div>{team().focus!.member_name}</div>
                    </Show>
                    <div>
                      {team().focus!.files.length === 1
                        ? team().focus!.files[0]!.split("/").at(-1)
                        : `${team().focus!.files.length} files`}
                    </div>
                  </div>
                </div>
              </div>
            </Show>

            <div classList={{ "mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3": !props.sidebar, "mt-4 grid gap-2": !!props.sidebar }}>
              <For each={members()}>
                {(member) => (
                  <div class="rounded-xl border border-border-weaker-base bg-background-stronger px-3 py-2">
                    <div class="flex items-center justify-between gap-3">
                      <div class="min-w-0">
                        <div class="truncate text-13-medium text-text-strong">{member.name}</div>
                        <div class="text-11-regular uppercase tracking-[0.08em] text-text-weak">{memberLabel(member)}</div>
                        <Show when={member.module_path}>
                          <div class="truncate text-12-regular text-text-weak">{member.module_path}</div>
                        </Show>
                        <Show when={member.file_label}>
                          <div class="truncate text-12-regular text-text-weak">{member.file_label}</div>
                        </Show>
                        <Show when={member.waiting_on}>
                          <div class="truncate text-12-regular text-text-weak">
                            Waiting for {member.waiting_on_member ? `${member.waiting_on_member} on ` : ""}{member.waiting_on}
                          </div>
                        </Show>
                        <Show when={member.has_memory}>
                          <div class="truncate text-12-regular text-text-weak">
                            Memory · {member.memory_updated_at ? new Date(member.memory_updated_at).toLocaleTimeString() : "available"}
                          </div>
                        </Show>
                      </div>
                      <div class="flex items-center gap-2 text-11-medium text-text-weak">
                        <div class={`size-2 rounded-full ${tone(member.status).split(" ")[0]}`} />
                        <span>{label(member.status)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </div>

            <Show when={team().tasks.length > 0}>
              <div class="mt-4 border-t border-border-weaker-base pt-3">
                <Collapsible open={open()} onOpenChange={setOpen} variant="ghost" class="w-full">
                  <Collapsible.Trigger class="w-full">
                    <div class="flex w-full items-center justify-between gap-4 text-left">
                      <div>
                        <div class="text-13-medium text-text-strong">Task queue</div>
                        <div class="text-12-regular text-text-weak">
                          Showing {Math.min(tasks().length, team().tasks.length)} of {team().tasks.length} tasks
                        </div>
                      </div>
                      <Collapsible.Arrow />
                    </div>
                  </Collapsible.Trigger>
                  <Collapsible.Content>
                    <div class="mt-3 grid gap-2">
                      <For each={tasks()}>
                        {(task) => (
                          <div class="rounded-xl border border-border-weaker-base bg-background-stronger px-3 py-2">
                            <div class="flex items-start justify-between gap-3">
                              <div class="min-w-0">
                                <div class="truncate text-13-medium text-text-strong">{task.title}</div>
                                <Show when={task.module_path}>
                                  <div class="truncate text-12-regular text-text-weak">{task.module_path}</div>
                                </Show>
                                <div class="truncate text-12-regular text-text-weak">
                                  {(task.kind ?? "execution")} · round {task.round ?? 1}
                                </div>
                                <Show when={task.waiting_on}>
                                  <div class="truncate text-12-regular text-text-weak">
                                    Waiting for {task.waiting_on_member ? `${task.waiting_on_member} on ` : ""}{task.waiting_on}
                                  </div>
                                </Show>
                              </div>
                              <div class="flex shrink-0 items-center gap-2 text-11-medium text-text-weak">
                                <div class={`size-2 rounded-full ${taskTone(task).split(" ")[0]}`} />
                                <span>{taskLabel(task)}</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </Collapsible.Content>
                </Collapsible>
              </div>
            </Show>
          </div>
        </section>
      )}
    </Show>
  )
}
