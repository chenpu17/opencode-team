import { describe, expect, test } from "bun:test"
import path from "path"
import { mkdir } from "fs/promises"
import { Database } from "bun:sqlite"
import { TeamStatus } from "../src/team/status"
import { tmpdir } from "./fixture/fixture"

describe("TeamStatus.current", () => {
  test("reads persisted team state from the project database", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, ".opencode", "team-agent")
    await mkdir(root, { recursive: true })

    const db = new Database(path.join(root, "teams.db"), { create: true })
    db.exec(`
      CREATE TABLE teams (id TEXT PRIMARY KEY, project_path TEXT NOT NULL, max_parallel INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE runs (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, requirement TEXT NOT NULL, scope_summary TEXT NOT NULL, status TEXT NOT NULL, phase TEXT, round INTEGER, owner_pid INTEGER NOT NULL, created_at INTEGER NOT NULL, started_at INTEGER NOT NULL, heartbeat_at INTEGER NOT NULL, completed_at INTEGER, error TEXT);
      CREATE TABLE members (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, role TEXT NOT NULL, name TEXT NOT NULL, task_id TEXT, session_id TEXT, memory TEXT, memory_updated_at INTEGER, status TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE modules (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, path TEXT NOT NULL, owner_id TEXT, line_count INTEGER NOT NULL, file_count INTEGER NOT NULL, summary TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE tasks (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, run_id TEXT, kind TEXT, round INTEGER, title TEXT NOT NULL, description TEXT NOT NULL, module_id TEXT, assigned_to TEXT, status TEXT NOT NULL, dependencies TEXT, created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER, error TEXT);
    `)
    db.query("INSERT INTO teams (id, project_path, max_parallel, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("t1", tmp.path, 2, 1, 2)
    db.query(
      "INSERT INTO runs (id, team_id, requirement, scope_summary, status, phase, round, owner_pid, created_at, started_at, heartbeat_at, completed_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("r1", "t1", "analyze api", "scope", "running", "investigating", 2, 123, 1, 1, 2, null, null)
    db.query(
      "INSERT INTO members (id, team_id, role, name, task_id, session_id, memory, memory_updated_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("m1", "t1", "architect", "Architect", "task-arch", null, "arch memory", 9, "completed", 1)
    db.query(
      "INSERT INTO members (id, team_id, role, name, task_id, session_id, memory, memory_updated_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("m2", "t1", "engineer", "Engineer_API", "task-eng", null, "eng memory", 10, "working", 1)
    db.query(
      "INSERT INTO modules (id, team_id, path, owner_id, line_count, file_count, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("mod1", "t1", "src/api", "m2", 120, 3, "api", 1)
    db.query(
      "INSERT INTO tasks (id, team_id, run_id, kind, round, title, description, module_id, assigned_to, status, dependencies, created_at, started_at, completed_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("task1", "t1", "r1", "investigation", 2, "Build API", "desc", "mod1", "m2", "in_progress", "[]", 1, 2, null, null)
    db.close()

    const status = TeamStatus.current(tmp.path)

    expect(status?.team_id).toBe("t1")
    expect(status?.execution.status).toBe("running")
    expect(status?.run?.id).toBe("r1")
    expect(status?.run?.phase).toBe("investigating")
    expect(status?.run?.round).toBe(2)
    expect(status?.resume.available).toBe(true)
    expect(status?.summary.active).toBe(1)
    expect(status?.summary.queued).toBe(0)
    expect(status?.focus).toBeNull()
    expect(status?.members[1]?.name).toBe("Engineer_API")
    expect(status?.members[1]?.has_memory).toBe(true)
    expect(status?.tasks[0]?.module_path).toBe("src/api")
    expect(status?.tasks[0]?.kind).toBe("investigation")
    expect(status?.tasks[0]?.round).toBe(2)
    expect(status?.tasks[0]?.queue_state).toBe("active")
  })

  test("derives blocked and focus from persisted steps", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, ".opencode", "team-agent")
    await mkdir(root, { recursive: true })

    const db = new Database(path.join(root, "teams.db"), { create: true })
    db.exec(`
      CREATE TABLE teams (id TEXT PRIMARY KEY, project_path TEXT NOT NULL, max_parallel INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE runs (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, requirement TEXT NOT NULL, scope_summary TEXT NOT NULL, status TEXT NOT NULL, phase TEXT, round INTEGER, owner_pid INTEGER NOT NULL, created_at INTEGER NOT NULL, started_at INTEGER NOT NULL, heartbeat_at INTEGER NOT NULL, completed_at INTEGER, error TEXT);
      CREATE TABLE members (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, role TEXT NOT NULL, name TEXT NOT NULL, task_id TEXT, session_id TEXT, memory TEXT, memory_updated_at INTEGER, status TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE modules (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, path TEXT NOT NULL, owner_id TEXT, line_count INTEGER NOT NULL, file_count INTEGER NOT NULL, summary TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE tasks (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, run_id TEXT, kind TEXT, round INTEGER, title TEXT NOT NULL, description TEXT NOT NULL, module_id TEXT, assigned_to TEXT, status TEXT NOT NULL, dependencies TEXT, created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER, error TEXT);
      CREATE TABLE steps (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, team_id TEXT NOT NULL, run_id TEXT, kind TEXT, round INTEGER, title TEXT NOT NULL, description TEXT NOT NULL, module_id TEXT, assigned_to TEXT, status TEXT NOT NULL, dependencies TEXT, files TEXT NOT NULL, created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER, error TEXT);
    `)
    db.query("INSERT INTO teams (id, project_path, max_parallel, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("t1", tmp.path, 2, 1, 2)
    db.query(
      "INSERT INTO runs (id, team_id, requirement, scope_summary, status, phase, round, owner_pid, created_at, started_at, heartbeat_at, completed_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("r1", "t1", "improve api", "scope", "running", "executing", 1, 123, 1, 1, 2, null, null)
    db.query(
      "INSERT INTO members (id, team_id, role, name, task_id, session_id, memory, memory_updated_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("m1", "t1", "engineer", "Engineer_API", "task-eng", null, "eng memory", 10, "working", 1)
    db.query(
      "INSERT INTO modules (id, team_id, path, owner_id, line_count, file_count, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("mod1", "t1", "src/api", "m1", 120, 3, "api", 1)
    db.query(
      "INSERT INTO tasks (id, team_id, run_id, kind, round, title, description, module_id, assigned_to, status, dependencies, created_at, started_at, completed_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("task1", "t1", "r1", "execution", 1, "Build API", "desc", "mod1", "m1", "in_progress", "[]", 1, 2, null, null)
    db.query(
      "INSERT INTO tasks (id, team_id, run_id, kind, round, title, description, module_id, assigned_to, status, dependencies, created_at, started_at, completed_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("task2", "t1", "r1", "execution", 1, "Review API", "desc", "mod1", "m1", "pending", "[]", 1, null, null, null)
    db.query(
      "INSERT INTO steps (id, task_id, team_id, run_id, kind, round, title, description, module_id, assigned_to, status, dependencies, files, created_at, started_at, completed_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("step1", "task1", "t1", "r1", "execution", 1, "Build API · step 1", "desc", "mod1", "m1", "in_progress", "[]", JSON.stringify(["src/api/route.ts"]), 1, 2, null, null)
    db.query(
      "INSERT INTO steps (id, task_id, team_id, run_id, kind, round, title, description, module_id, assigned_to, status, dependencies, files, created_at, started_at, completed_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("step2", "task2", "t1", "r1", "execution", 1, "Review API · step 1", "desc", "mod1", "m1", "pending", JSON.stringify(["step1"]), JSON.stringify(["src/api/review.ts"]), 1, null, null, null)
    db.close()

    const status = TeamStatus.current(tmp.path)

    expect(status?.summary.active).toBe(1)
    expect(status?.summary.queued).toBe(0)
    expect(status?.summary.blocked).toBe(1)
    expect(status?.tasks[0]?.id).toBe("task1")
    expect(status?.tasks[0]?.queue_state).toBe("active")
    expect(status?.tasks[1]?.id).toBe("task2")
    expect(status?.tasks[1]?.queue_state).toBe("blocked")
    expect(status?.tasks[1]?.waiting_on).toBe("src/api")
    expect(status?.tasks[1]?.waiting_on_member).toBe("Engineer_API")
    expect(status?.members[0]?.focus_mode).toBe("active")
    expect(status?.members[0]?.module_path).toBe("src/api")
    expect(status?.members[0]?.step_title).toBe("Build API · step 1")
    expect(status?.members[0]?.file_label).toBe("route.ts")
    expect(status?.focus?.task_id).toBe("task1")
    expect(status?.focus?.mode).toBe("active")
    expect(status?.focus?.member_name).toBe("Engineer_API")
    expect(status?.focus?.module_path).toBe("src/api")
    expect(status?.focus?.files).toEqual(["src/api/route.ts"])
    expect(status?.resume.pending).toBe(2)
  })
})
