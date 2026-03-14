import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const teams = sqliteTable("teams", {
  id: text().primaryKey(),
  project_path: text().notNull(),
  max_parallel: integer().notNull(),
  created_at: integer().notNull(),
  updated_at: integer().notNull(),
})

export const runs = sqliteTable("runs", {
  id: text().primaryKey(),
  team_id: text().notNull(),
  requirement: text().notNull(),
  scope_summary: text().notNull(),
  status: text().notNull(),
  phase: text().notNull(),
  round: integer().notNull(),
  activated_member_ids: text().notNull(),
  module_ids: text().notNull(),
  max_parallel: integer().notNull(),
  owner_pid: integer().notNull(),
  created_at: integer().notNull(),
  started_at: integer().notNull(),
  heartbeat_at: integer().notNull(),
  completed_at: integer(),
  error: text(),
})

export const members = sqliteTable("members", {
  id: text().primaryKey(),
  team_id: text().notNull(),
  role: text().notNull(),
  scope: text().notNull(),
  name: text().notNull(),
  task_id: text(),
  session_id: text(),
  module_id: text(),
  module_path: text(),
  memory: text(),
  memory_updated_at: integer(),
  status: text().notNull(),
  created_at: integer().notNull(),
})

export const modules = sqliteTable("modules", {
  id: text().primaryKey(),
  team_id: text().notNull(),
  path: text().notNull(),
  owner_id: text(),
  line_count: integer().notNull(),
  file_count: integer().notNull(),
  summary: text(),
  created_at: integer().notNull(),
})

export const tasks = sqliteTable("tasks", {
  id: text().primaryKey(),
  team_id: text().notNull(),
  run_id: text(),
  kind: text().notNull(),
  round: integer().notNull(),
  title: text().notNull(),
  description: text().notNull(),
  module_id: text(),
  assigned_to: text(),
  status: text().notNull(),
  dependencies: text(),
  created_at: integer().notNull(),
  started_at: integer(),
  completed_at: integer(),
  error: text(),
})

export const steps = sqliteTable("steps", {
  id: text().primaryKey(),
  task_id: text().notNull(),
  team_id: text().notNull(),
  run_id: text(),
  kind: text().notNull(),
  round: integer().notNull(),
  title: text().notNull(),
  description: text().notNull(),
  module_id: text(),
  assigned_to: text(),
  status: text().notNull(),
  dependencies: text(),
  files: text().notNull(),
  created_at: integer().notNull(),
  started_at: integer(),
  completed_at: integer(),
  error: text(),
})
