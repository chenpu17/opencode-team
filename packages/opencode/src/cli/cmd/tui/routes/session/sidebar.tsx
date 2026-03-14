import { useSync } from "@tui/context/sync"
import { createMemo, createResource, createEffect, For, onCleanup, Show, Switch, Match } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../../context/theme"
import { Locale } from "@/util/locale"
import path from "path"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import { Global } from "@/global"
import { Installation } from "@/installation"
import { useKeybind } from "../../context/keybind"
import { useDirectory } from "../../context/directory"
import { useKV } from "../../context/kv"
import { TodoItem } from "../../component/todo-item"
import { useSDK } from "../../context/sdk"

type Team = {
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
    module_path?: string
  }[]
}

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const sync = useSync()
  const sdk = useSDK()
  const { theme } = useTheme()
  const session = createMemo(() => sync.session.get(props.sessionID)!)
  const diff = createMemo(() => sync.data.session_diff[props.sessionID] ?? [])
  const todo = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])

  const [expanded, setExpanded] = createStore({
    team: true,
    mcp: true,
    diff: true,
    todo: true,
    lsp: true,
  })

  const source = createMemo(() => session()?.directory)
  const [team, ctl] = createResource(source, async (dir) =>
    sdk.client.app
      .team({ directory: dir })
      .then((res) => (res.data ?? null) as Team | null)
      .catch(() => null),
  )
  const pace = (status?: Team["execution"]["status"] | null) => {
    if (status === "running" || status === "error") return 15000
    return 60000
  }

  createEffect(() => {
    if (!source()) {
      ctl.mutate(null)
      return
    }
    void ctl.refetch()
    const id = setInterval(() => {
      void ctl.refetch()
    }, pace(team()?.execution.status))
    onCleanup(() => clearInterval(id))
  })

  createEffect(() => {
    if (!source()) return
    const stop = sdk.event.on("team.updated", (evt) => {
      ctl.mutate(evt.properties.info as Team | null)
    })
    onCleanup(stop)
  })

  // Sort MCP servers alphabetically for consistent display order
  const mcpEntries = createMemo(() => Object.entries(sync.data.mcp).sort(([a], [b]) => a.localeCompare(b)))

  // Count connected and error MCP servers for collapsed header display
  const connectedMcpCount = createMemo(() => mcpEntries().filter(([_, item]) => item.status === "connected").length)
  const errorMcpCount = createMemo(
    () =>
      mcpEntries().filter(
        ([_, item]) =>
          item.status === "failed" || item.status === "needs_auth" || item.status === "needs_client_registration",
      ).length,
  )

  const cost = createMemo(() => {
    const total = messages().reduce((sum, x) => sum + (x.role === "assistant" ? x.cost : 0), 0)
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(total)
  })

  const context = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as AssistantMessage
    if (!last) return
    const total =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    return {
      tokens: total.toLocaleString(),
      percentage: model?.limit.context ? Math.round((total / model.limit.context) * 100) : null,
    }
  })

  const directory = useDirectory()
  const kv = useKV()

  const hasProviders = createMemo(() =>
    sync.data.provider.some((x) => x.id !== "opencode" || Object.values(x.models).some((y) => y.cost?.input !== 0)),
  )
  const gettingStartedDismissed = createMemo(() => kv.get("dismissed_getting_started", false))

  const teamTone = (status: Team["execution"]["status"] | Team["members"][number]["status"] | Team["tasks"][number]["status"] | "blocked") => {
    if (status === "completed") return theme.success
    if (status === "working" || status === "in_progress" || status === "running") return theme.info
    if (status === "error") return theme.error
    return theme.warning
  }

  const teamLabel = (status: Team["execution"]["status"] | Team["members"][number]["status"] | Team["tasks"][number]["status"] | "blocked") => {
    if (status === "in_progress") return "in progress"
    return status
  }
  const taskTone = (item: Team["tasks"][number]) => teamTone(item.queue_state === "blocked" ? "blocked" : item.status)
  const taskLabel = (item: Team["tasks"][number]) => teamLabel(item.queue_state === "blocked" ? "blocked" : item.status)

  const taskTitle = (item: Team["tasks"][number]) => {
    const text = item.module_path ?? item.title.split("\n")[0]?.split("：")[0]?.split(":")[0]?.trim() ?? item.title
    return Locale.truncate(text, 28)
  }
  const phase = createMemo(() => team()?.run?.phase ?? "unknown")
  const focusTitle = (item: NonNullable<Team["focus"]>) =>
    Locale.truncate(item.module_path ?? item.task_title, 28)
  const focusMeta = (item: NonNullable<Team["focus"]>) => {
    const file = item.files.length === 1 ? path.basename(item.files[0]!) : `${item.files.length} files`
    return [item.member_name, file].filter(Boolean).join(" · ")
  }

  const members = createMemo(() =>
    [...(team()?.members ?? [])].sort((a, b) => {
      const rank = (role: Team["members"][number]["role"]) => (role === "pm" ? 0 : role === "architect" ? 1 : 2)
      return rank(a.role) - rank(b.role) || a.name.localeCompare(b.name)
    }),
  )
  const memberMeta = (item: Team["members"][number]) =>
    [
      item.module_path && `${item.focus_mode ?? "next"} · ${path.basename(item.module_path)}`,
      item.has_memory && `memory${item.memory_updated_at ? ` @ ${new Date(item.memory_updated_at).toLocaleTimeString()}` : ""}`,
      item.file_label,
      item.waiting_on && `waiting for ${item.waiting_on_member ? `${item.waiting_on_member} on ` : ""}${path.basename(item.waiting_on)}`,
    ].filter(Boolean).join(" · ")
  const taskMeta = (item: Team["tasks"][number]) =>
    [
      `${item.kind ?? "execution"} r${item.round ?? 1}`,
      item.waiting_on
        ? `waiting for ${item.waiting_on_member ? `${item.waiting_on_member} on ` : ""}${path.basename(item.waiting_on)}`
        : "",
    ].filter(Boolean).join(", ")

  const queued = createMemo(() => team()?.summary.queued ?? 0)
  const active = createMemo(() => team()?.summary.active ?? 0)
  const blocked = createMemo(() => team()?.summary.blocked ?? 0)
  const tasks = createMemo(() => {
    const list = team()?.tasks ?? []
    return list
      .filter((item) => item.status !== "completed")
      .filter((item) => item.id !== team()?.focus?.task_id)
      .slice(0, 5)
  })
  const more = createMemo(() => Math.max(0, (team()?.tasks.length ?? 0) - tasks().length))

  return (
    <Show when={session()}>
      <box
        backgroundColor={theme.backgroundPanel}
        width={42}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        position={props.overlay ? "absolute" : "relative"}
      >
        <scrollbox
          flexGrow={1}
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: theme.background,
              foregroundColor: theme.borderActive,
            },
          }}
        >
          <box flexShrink={0} gap={1} paddingRight={1}>
            <box paddingRight={1}>
              <text fg={theme.text}>
                <b>{session().title}</b>
              </text>
              <Show when={session().share?.url}>
                <text fg={theme.textMuted}>{session().share!.url}</text>
              </Show>
            </box>
            <Show when={team()}>
              <box>
                <box flexDirection="row" gap={1} onMouseDown={() => setExpanded("team", !expanded.team)}>
                  <text fg={theme.text}>{expanded.team ? "▼" : "▶"}</text>
                  <text fg={theme.text}>
                    <b>Team</b>
                  </text>
                  <text fg={teamTone(team()!.execution.status)}>{teamLabel(team()!.execution.status)}</text>
                </box>
                <Show when={expanded.team}>
                  <text fg={theme.textMuted}>
                    {team()!.execution.completed}/{team()!.execution.total} tasks
                    {" · "}
                    {team()!.execution.progress}% done
                    <Show when={active() > 0}>
                      {" · "}
                      {active()} active
                    </Show>
                    <Show when={queued() > 0}>
                      {" · "}
                      {queued()} queued
                    </Show>
                    <Show when={blocked() > 0}>
                      {" · "}
                      {blocked()} blocked
                    </Show>
                  </text>
                  <Show when={team()!.run}>
                    <text fg={theme.textMuted}>
                      {phase()} · round {team()!.run!.round ?? 1}
                    </text>
                  </Show>
                  <Show when={team()!.resume.available}>
                    <text fg={theme.warning}>resume available · {team()!.resume.pending} pending</text>
                  </Show>
                  <For each={members()}>
                    {(item) => (
                      <box flexDirection="row" gap={1}>
                        <text fg={teamTone(item.status)}>•</text>
                        <text fg={theme.text}>
                          {item.name} <span style={{ fg: theme.textMuted }}>({item.role})</span>
                          <Show when={memberMeta(item)}>
                            <span style={{ fg: theme.textMuted }}> · {memberMeta(item)}</span>
                          </Show>
                        </text>
                      </box>
                    )}
                  </For>
                  <Show when={team()!.focus}>
                    <text fg={theme.text}>
                      <b>{team()!.focus!.mode === "active" ? "Focus" : "Next"}</b>
                    </text>
                    <box flexDirection="row" gap={1}>
                      <text fg={teamTone(team()!.focus!.mode === "active" ? "running" : "pending")}>•</text>
                      <text fg={theme.text} wrapMode="none">
                        {focusTitle(team()!.focus!)}
                      </text>
                    </box>
                    <Show when={focusMeta(team()!.focus!).length > 0}>
                      <text fg={theme.textMuted}>{focusMeta(team()!.focus!)}</text>
                    </Show>
                  </Show>
                  <Show when={tasks().length > 0}>
                    <text fg={theme.text}>
                      <b>Queue</b>
                    </text>
                    <For each={tasks()}>
                      {(item) => (
                        <box flexDirection="row" gap={1}>
                          <text fg={taskTone(item)}>•</text>
                          <text fg={theme.text} wrapMode="none">
                            {taskTitle(item)} <span style={{ fg: theme.textMuted }}>({taskLabel(item)}{taskMeta(item)})</span>
                          </text>
                        </box>
                      )}
                    </For>
                    <Show when={more() > 0}>
                      <text fg={theme.textMuted}>+{more()} more</text>
                    </Show>
                  </Show>
                </Show>
              </box>
            </Show>
            <box>
              <text fg={theme.text}>
                <b>Context</b>
              </text>
              <text fg={theme.textMuted}>{context()?.tokens ?? 0} tokens</text>
              <text fg={theme.textMuted}>{context()?.percentage ?? 0}% used</text>
              <text fg={theme.textMuted}>{cost()} spent</text>
            </box>
            <Show when={mcpEntries().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => mcpEntries().length > 2 && setExpanded("mcp", !expanded.mcp)}
                >
                  <Show when={mcpEntries().length > 2}>
                    <text fg={theme.text}>{expanded.mcp ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>MCP</b>
                    <Show when={!expanded.mcp}>
                      <span style={{ fg: theme.textMuted }}>
                        {" "}
                        ({connectedMcpCount()} active
                        {errorMcpCount() > 0 ? `, ${errorMcpCount()} error${errorMcpCount() > 1 ? "s" : ""}` : ""})
                      </span>
                    </Show>
                  </text>
                </box>
                <Show when={mcpEntries().length <= 2 || expanded.mcp}>
                  <For each={mcpEntries()}>
                    {([key, item]) => (
                      <box flexDirection="row" gap={1}>
                        <text
                          flexShrink={0}
                          style={{
                            fg: (
                              {
                                connected: theme.success,
                                failed: theme.error,
                                disabled: theme.textMuted,
                                needs_auth: theme.warning,
                                needs_client_registration: theme.error,
                              } as Record<string, typeof theme.success>
                            )[item.status],
                          }}
                        >
                          •
                        </text>
                        <text fg={theme.text} wrapMode="word">
                          {key}{" "}
                          <span style={{ fg: theme.textMuted }}>
                            <Switch fallback={item.status}>
                              <Match when={item.status === "connected"}>Connected</Match>
                              <Match when={item.status === "failed" && item}>{(val) => <i>{val().error}</i>}</Match>
                              <Match when={item.status === "disabled"}>Disabled</Match>
                              <Match when={(item.status as string) === "needs_auth"}>Needs auth</Match>
                              <Match when={(item.status as string) === "needs_client_registration"}>
                                Needs client ID
                              </Match>
                            </Switch>
                          </span>
                        </text>
                      </box>
                    )}
                  </For>
                </Show>
              </box>
            </Show>
            <box>
              <box
                flexDirection="row"
                gap={1}
                onMouseDown={() => sync.data.lsp.length > 2 && setExpanded("lsp", !expanded.lsp)}
              >
                <Show when={sync.data.lsp.length > 2}>
                  <text fg={theme.text}>{expanded.lsp ? "▼" : "▶"}</text>
                </Show>
                <text fg={theme.text}>
                  <b>LSP</b>
                </text>
              </box>
              <Show when={sync.data.lsp.length <= 2 || expanded.lsp}>
                <Show when={sync.data.lsp.length === 0}>
                  <text fg={theme.textMuted}>
                    {sync.data.config.lsp === false
                      ? "LSPs have been disabled in settings"
                      : "LSPs will activate as files are read"}
                  </text>
                </Show>
                <For each={sync.data.lsp}>
                  {(item) => (
                    <box flexDirection="row" gap={1}>
                      <text
                        flexShrink={0}
                        style={{
                          fg: {
                            connected: theme.success,
                            error: theme.error,
                          }[item.status],
                        }}
                      >
                        •
                      </text>
                      <text fg={theme.textMuted}>
                        {item.id} {item.root}
                      </text>
                    </box>
                  )}
                </For>
              </Show>
            </box>
            <Show when={todo().length > 0 && todo().some((t) => t.status !== "completed")}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => todo().length > 2 && setExpanded("todo", !expanded.todo)}
                >
                  <Show when={todo().length > 2}>
                    <text fg={theme.text}>{expanded.todo ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>Todo</b>
                  </text>
                </box>
                <Show when={todo().length <= 2 || expanded.todo}>
                  <For each={todo()}>{(todo) => <TodoItem status={todo.status} content={todo.content} />}</For>
                </Show>
              </box>
            </Show>
            <Show when={diff().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => diff().length > 2 && setExpanded("diff", !expanded.diff)}
                >
                  <Show when={diff().length > 2}>
                    <text fg={theme.text}>{expanded.diff ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>Modified Files</b>
                  </text>
                </box>
                <Show when={diff().length <= 2 || expanded.diff}>
                  <For each={diff() || []}>
                    {(item) => {
                      return (
                        <box flexDirection="row" gap={1} justifyContent="space-between">
                          <text fg={theme.textMuted} wrapMode="none">
                            {item.file}
                          </text>
                          <box flexDirection="row" gap={1} flexShrink={0}>
                            <Show when={item.additions}>
                              <text fg={theme.diffAdded}>+{item.additions}</text>
                            </Show>
                            <Show when={item.deletions}>
                              <text fg={theme.diffRemoved}>-{item.deletions}</text>
                            </Show>
                          </box>
                        </box>
                      )
                    }}
                  </For>
                </Show>
              </box>
            </Show>
          </box>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <Show when={!hasProviders() && !gettingStartedDismissed()}>
            <box
              backgroundColor={theme.backgroundElement}
              paddingTop={1}
              paddingBottom={1}
              paddingLeft={2}
              paddingRight={2}
              flexDirection="row"
              gap={1}
            >
              <text flexShrink={0} fg={theme.text}>
                ⬖
              </text>
              <box flexGrow={1} gap={1}>
                <box flexDirection="row" justifyContent="space-between">
                  <text fg={theme.text}>
                    <b>Getting started</b>
                  </text>
                  <text fg={theme.textMuted} onMouseDown={() => kv.set("dismissed_getting_started", true)}>
                    ✕
                  </text>
                </box>
                <text fg={theme.textMuted}>OpenCode includes free models so you can start immediately.</text>
                <text fg={theme.textMuted}>
                  Connect from 75+ providers to use other models, including Claude, GPT, Gemini etc
                </text>
                <box flexDirection="row" gap={1} justifyContent="space-between">
                  <text fg={theme.text}>Connect provider</text>
                  <text fg={theme.textMuted}>/connect</text>
                </box>
              </box>
            </box>
          </Show>
          <text>
            <span style={{ fg: theme.textMuted }}>{directory().split("/").slice(0, -1).join("/")}/</span>
            <span style={{ fg: theme.text }}>{directory().split("/").at(-1)}</span>
          </text>
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.success }}>•</span> <b>Open</b>
            <span style={{ fg: theme.text }}>
              <b>Code</b>
            </span>{" "}
            <span>{Installation.VERSION}</span>
          </text>
        </box>
      </box>
    </Show>
  )
}
