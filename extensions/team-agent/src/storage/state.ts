import { mkdirSync } from "fs"
import path from "path"
import { Database } from "bun:sqlite"
import { desc, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { members, modules, runs, steps, tasks, teams } from "./schema"
import type { Team, Member, Module, Task, Run, Step } from "../types"

type Row = {
  team: Team
  run?: Run
  members: Member[]
  modules: Module[]
  tasks: Task[]
  steps: Step[]
}

export class StateStore {
  private sqlite?: Database
  private db?: ReturnType<typeof drizzle<typeof import("./schema")>>
  private file: string

  constructor(root: string) {
    this.file = path.join(root, ".opencode", "team-agent", "teams.db")
  }

  async init() {
    mkdirSync(path.dirname(this.file), { recursive: true })
    this.sqlite = new Database(this.file, { create: true })
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        max_parallel INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        requirement TEXT NOT NULL,
        scope_summary TEXT NOT NULL,
        status TEXT NOT NULL,
        phase TEXT NOT NULL,
        round INTEGER NOT NULL,
        activated_member_ids TEXT NOT NULL,
        module_ids TEXT NOT NULL,
        max_parallel INTEGER NOT NULL,
        owner_pid INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        heartbeat_at INTEGER NOT NULL,
        completed_at INTEGER,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS members (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        role TEXT NOT NULL,
        scope TEXT NOT NULL,
        name TEXT NOT NULL,
        task_id TEXT,
        session_id TEXT,
        module_id TEXT,
        module_path TEXT,
        memory TEXT,
        memory_updated_at INTEGER,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS modules (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        path TEXT NOT NULL,
        owner_id TEXT,
        line_count INTEGER NOT NULL,
        file_count INTEGER NOT NULL,
        summary TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        run_id TEXT,
        kind TEXT NOT NULL,
        round INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        module_id TEXT,
        assigned_to TEXT,
        status TEXT NOT NULL,
        dependencies TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS steps (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        run_id TEXT,
        kind TEXT NOT NULL,
        round INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        module_id TEXT,
        assigned_to TEXT,
        status TEXT NOT NULL,
        dependencies TEXT,
        files TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS module_files (
        module_id TEXT NOT NULL,
        file TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS module_links (
        module_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        value TEXT NOT NULL
      );
    `)
    this.add("teams", "max_parallel", "INTEGER")
    this.add("runs", "phase", "TEXT")
    this.add("runs", "round", "INTEGER")
    this.add("runs", "activated_member_ids", "TEXT")
    this.add("runs", "module_ids", "TEXT")
    this.add("runs", "max_parallel", "INTEGER")
    this.add("members", "scope", "TEXT")
    this.add("members", "task_id", "TEXT")
    this.add("members", "module_id", "TEXT")
    this.add("members", "module_path", "TEXT")
    this.add("members", "memory", "TEXT")
    this.add("members", "memory_updated_at", "INTEGER")
    this.add("tasks", "run_id", "TEXT")
    this.add("tasks", "kind", "TEXT")
    this.add("tasks", "round", "INTEGER")
    this.add("tasks", "error", "TEXT")
    this.add("steps", "kind", "TEXT")
    this.add("steps", "round", "INTEGER")
    this.db = drizzle({ client: this.sqlite, schema: { teams, runs, members, modules, tasks, steps } })
  }

  async save(team: Team, list: { run?: Run; members: Member[]; modules: Module[]; tasks: Task[]; steps: Step[] }) {
    if (!this.db || !this.sqlite) return
    const now = Date.now()
    team.updatedAt = now

    this.sqlite.transaction(() => {
      this.db!.insert(teams).values({
        id: team.id,
        project_path: team.projectPath,
        max_parallel: team.maxParallel,
        created_at: team.createdAt,
        updated_at: now,
      }).onConflictDoUpdate({
        target: teams.id,
        set: {
          project_path: team.projectPath,
          max_parallel: team.maxParallel,
          updated_at: now,
        },
      }).run()

      if (list.run) {
        this.db!.insert(runs).values({
          id: list.run.id,
          team_id: list.run.teamId,
          requirement: list.run.requirement,
          scope_summary: list.run.scopeSummary,
          status: list.run.status,
          phase: list.run.phase,
          round: list.run.round,
          activated_member_ids: JSON.stringify(list.run.activatedMemberIds),
          module_ids: JSON.stringify(list.run.moduleIds),
          max_parallel: list.run.maxParallel,
          owner_pid: list.run.ownerPid,
          created_at: list.run.createdAt,
          started_at: list.run.startedAt,
          heartbeat_at: list.run.heartbeatAt,
          completed_at: list.run.completedAt,
          error: list.run.error,
        }).onConflictDoUpdate({
          target: runs.id,
          set: {
            requirement: list.run.requirement,
            scope_summary: list.run.scopeSummary,
            status: list.run.status,
            phase: list.run.phase,
            round: list.run.round,
            activated_member_ids: JSON.stringify(list.run.activatedMemberIds),
            module_ids: JSON.stringify(list.run.moduleIds),
            max_parallel: list.run.maxParallel,
            owner_pid: list.run.ownerPid,
            heartbeat_at: list.run.heartbeatAt,
            completed_at: list.run.completedAt,
            error: list.run.error,
          },
        }).run()
      }

      this.sqlite!.query("DELETE FROM module_files WHERE module_id IN (SELECT id FROM modules WHERE team_id = ?)").run(team.id)
      this.sqlite!.query("DELETE FROM module_links WHERE module_id IN (SELECT id FROM modules WHERE team_id = ?)").run(team.id)
      this.db!.delete(members).where(eq(members.team_id, team.id)).run()
      this.db!.delete(modules).where(eq(modules.team_id, team.id)).run()
      if (list.run) {
        this.db!.delete(tasks).where(eq(tasks.run_id, list.run.id)).run()
        this.db!.delete(steps).where(eq(steps.run_id, list.run.id)).run()
      }

      if (list.members.length > 0) {
        this.db!.insert(members).values(
          list.members.map((member) => ({
            id: member.id,
            team_id: member.teamId,
            role: member.role,
            scope: member.scope,
            name: member.name,
            task_id: member.taskId,
            session_id: member.sessionId,
            module_id: member.moduleId,
            module_path: member.modulePath,
            memory: member.memory,
            memory_updated_at: member.memoryUpdatedAt,
            status: member.status,
            created_at: now,
          })),
        ).run()
      }

      if (list.modules.length > 0) {
        this.db!.insert(modules).values(
          list.modules.map((mod) => ({
            id: mod.id,
            team_id: mod.teamId,
            path: mod.path,
            owner_id: mod.ownerId,
            line_count: mod.lineCount,
            file_count: mod.files.length,
            summary: mod.summary,
            created_at: now,
          })),
        ).run()

        const file = this.sqlite!.query("INSERT INTO module_files (module_id, file) VALUES (?, ?)")
        const link = this.sqlite!.query("INSERT INTO module_links (module_id, kind, value) VALUES (?, ?, ?)")
        list.modules.forEach((mod) => {
          mod.files.forEach((item) => file.run(mod.id, item))
          mod.imports.forEach((item) => link.run(mod.id, "import", item))
          mod.exports.forEach((item) => link.run(mod.id, "export", item))
        })
      }

      if (list.tasks.length > 0) {
        this.db!.insert(tasks).values(
          list.tasks.map((task) => ({
            id: task.id,
            team_id: task.teamId,
            run_id: task.runId,
            kind: task.kind,
            round: task.round,
            title: task.title,
            description: task.description,
            module_id: task.moduleId,
            assigned_to: task.assignedTo,
            status: task.status,
            dependencies: JSON.stringify(task.dependencies),
            created_at: task.createdAt,
            started_at: task.startedAt,
            completed_at: task.completedAt,
            error: task.error,
          })),
        ).run()
      }

      if (list.steps.length > 0) {
        this.db!.insert(steps).values(
          list.steps.map((step) => ({
            id: step.id,
            task_id: step.taskId,
            team_id: step.teamId,
            run_id: step.runId,
            kind: step.kind,
            round: step.round,
            title: step.title,
            description: step.description,
            module_id: step.moduleId,
            assigned_to: step.assignedTo,
            status: step.status,
            dependencies: JSON.stringify(step.dependencies),
            files: JSON.stringify(step.files),
            created_at: step.createdAt,
            started_at: step.startedAt,
            completed_at: step.completedAt,
            error: step.error,
          })),
        ).run()
      }
    })()
  }

  async load(projectPath: string): Promise<Row | undefined> {
    if (!this.db || !this.sqlite) return
    const row = this.db.select().from(teams).where(eq(teams.project_path, projectPath)).orderBy(desc(teams.updated_at)).limit(1).get()
    if (!row) return

    const team: Team = {
      id: row.id,
      projectPath: row.project_path,
      maxParallel: row.max_parallel ?? 3,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
    const run = this.db.select().from(runs).where(eq(runs.team_id, team.id)).orderBy(desc(runs.created_at)).limit(1).get()
    const list = this.db.select().from(members).where(eq(members.team_id, team.id)).all()
    const mods = this.db.select().from(modules).where(eq(modules.team_id, team.id)).all()
    const jobs = run
      ? this.db.select().from(tasks).where(eq(tasks.run_id, run.id)).all()
      : this.db.select().from(tasks).where(eq(tasks.team_id, team.id)).all()
    const flow = run
      ? this.db.select().from(steps).where(eq(steps.run_id, run.id)).all()
      : []
    const file = this.sqlite.query("SELECT file FROM module_files WHERE module_id = ?")
    const link = this.sqlite.query("SELECT kind, value FROM module_links WHERE module_id = ?")

    return {
      team,
      run: run
        ? {
            id: run.id,
            teamId: run.team_id,
            requirement: run.requirement,
            scopeSummary: run.scope_summary,
            status: run.status as Run["status"],
            phase: (run.phase ?? (run.status === "running" ? "executing" : run.status === "completed" ? "completed" : "error")) as Run["phase"],
            round: run.round ?? 1,
            activatedMemberIds: run.activated_member_ids ? JSON.parse(run.activated_member_ids) : [],
            moduleIds: run.module_ids ? JSON.parse(run.module_ids) : [],
            maxParallel: run.max_parallel ?? team.maxParallel,
            ownerPid: run.owner_pid,
            createdAt: run.created_at,
            startedAt: run.started_at,
            heartbeatAt: run.heartbeat_at,
            completedAt: run.completed_at ?? undefined,
            error: run.error ?? undefined,
          }
        : undefined,
      members: list.map((item) => ({
        id: item.id,
        teamId: item.team_id,
        role: item.role as Member["role"],
        scope: (item.scope ?? (item.role === "engineer" ? "module" : "global")) as Member["scope"],
        name: item.name,
        taskId: item.task_id ?? undefined,
        sessionId: item.session_id ?? undefined,
        moduleId: item.module_id ?? undefined,
        modulePath: item.module_path ?? undefined,
        memory: item.memory ?? undefined,
        memoryUpdatedAt: item.memory_updated_at ?? undefined,
        status: item.status as Member["status"],
      })),
      modules: mods.map((item) => {
        const links = link.all(item.id) as { kind: string; value: string }[]
        return {
          id: item.id,
          teamId: item.team_id,
          path: item.path,
          ownerId: item.owner_id ?? undefined,
          lineCount: item.line_count,
          files: (file.all(item.id) as { file: string }[]).map((row) => row.file),
          imports: links.filter((row) => row.kind === "import").map((row) => row.value),
          exports: links.filter((row) => row.kind === "export").map((row) => row.value),
          summary: item.summary ?? undefined,
        }
      }),
      tasks: jobs.map((item) => ({
        id: item.id,
        teamId: item.team_id,
        runId: item.run_id ?? undefined,
        kind: (item.kind ?? "execution") as Task["kind"],
        round: item.round ?? 1,
        title: item.title,
        description: item.description,
        moduleId: item.module_id ?? undefined,
        assignedTo: item.assigned_to ?? undefined,
        status: item.status as Task["status"],
        dependencies: item.dependencies ? JSON.parse(item.dependencies) : [],
        createdAt: item.created_at,
        startedAt: item.started_at ?? undefined,
        completedAt: item.completed_at ?? undefined,
        error: item.error ?? undefined,
      })),
      steps: flow.map((item) => ({
        id: item.id,
        taskId: item.task_id,
        teamId: item.team_id,
        runId: item.run_id ?? undefined,
        kind: (item.kind ?? "execution") as Step["kind"],
        round: item.round ?? 1,
        title: item.title,
        description: item.description,
        moduleId: item.module_id ?? undefined,
        assignedTo: item.assigned_to ?? undefined,
        status: item.status as Step["status"],
        dependencies: item.dependencies ? JSON.parse(item.dependencies) : [],
        files: item.files ? JSON.parse(item.files) : [],
        createdAt: item.created_at,
        startedAt: item.started_at ?? undefined,
        completedAt: item.completed_at ?? undefined,
        error: item.error ?? undefined,
      })),
    }
  }

  async touch(teamId: string, runId: string, now: number) {
    if (!this.db) return

    this.db
      .update(teams)
      .set({ updated_at: now })
      .where(eq(teams.id, teamId))
      .run()

    this.db
      .update(runs)
      .set({ heartbeat_at: now })
      .where(eq(runs.id, runId))
      .run()
  }

  close() {
    this.sqlite?.close()
  }

  private add(table: string, col: string, type: string) {
    try {
      this.sqlite?.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`)
    } catch {}
  }
}
