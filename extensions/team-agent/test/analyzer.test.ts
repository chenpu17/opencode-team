import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { ModuleAnalyzer } from "../src/core/module-analyzer"

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "team-agent-"))
  dirs.push(dir)
  await mkdir(path.join(dir, "src", "auth"), { recursive: true })
  await mkdir(path.join(dir, "src", "api"), { recursive: true })
  await writeFile(
    path.join(dir, "src", "auth", "index.ts"),
    ["export function login(user: string) { return user }", "export const token = true", ""].join("\n"),
  )
  await writeFile(
    path.join(dir, "src", "api", "route.ts"),
    ['import { login } from "../auth"', "export function route() { return login() }", ""].join("\n"),
  )
  return dir
}

describe("ModuleAnalyzer", () => {
  test("finds module links and exports", async () => {
    const dir = await fixture()
    const analyzer = new ModuleAnalyzer()
    const modules = await analyzer.analyze(dir, "team", { minLines: 1, maxLines: 100 })
    const auth = modules.find((mod) => mod.path === path.join("src", "auth"))
    const api = modules.find((mod) => mod.path === path.join("src", "api"))

    expect(auth?.exports).toContain("index.ts: export function login(user: string) { return user }")
    expect(auth?.exports).toContain("index.ts: export const token = true")
    expect(api?.imports).toContain(path.join("src", "auth"))
  })

  test("splits oversized modules by file chunks", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "team-agent-"))
    dirs.push(dir)
    await mkdir(path.join(dir, "src", "ui"), { recursive: true })
    await writeFile(path.join(dir, "src", "ui", "a.ts"), new Array(8).fill("export const a = 1").join("\n"))
    await writeFile(path.join(dir, "src", "ui", "b.ts"), new Array(8).fill("export const b = 1").join("\n"))

    const analyzer = new ModuleAnalyzer()
    const modules = await analyzer.analyze(dir, "team", { minLines: 1, maxLines: 10 })

    expect(modules.filter((mod) => mod.path.startsWith(path.join("src", "ui"))).length).toBe(2)
  })
})
