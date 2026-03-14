import type { createOpencodeClient } from "@opencode-ai/sdk"
import { BaseAgent } from "./base-agent"
import type { Member, Module, Scope } from "../types"
import { log, error as logError } from "../util/logger"

const tags: Record<string, string[]> = {
  auth: ["auth", "login", "oauth", "signin", "signup", "session", "token"],
  api: ["api", "route", "endpoint", "server", "http", "rpc"],
  ui: ["ui", "page", "view", "component", "screen", "layout", "form"],
  data: ["db", "database", "sql", "store", "model", "schema", "cache"],
  test: ["test", "spec", "coverage"],
}

export class ProductManagerAgent extends BaseAgent<string, Scope> {
  constructor(
    client: ReturnType<typeof createOpencodeClient>,
    member: Member,
    private modules: Module[],
  ) {
    super(client, member)
  }

  async execute(requirement: string): Promise<Scope> {
    log("ProductManager", "Starting requirement analysis", { requirement })
    this.updateStatus("working")

    try {
      const scope = this.pick(requirement)
      this.updateStatus("completed")
      log("ProductManager", "Requirement analysis completed", {
        modules: scope.moduleIds.length,
      })
      return scope
    } catch (err) {
      this.updateStatus("error")
      logError("ProductManager", "Requirement analysis failed", err)
      throw err
    }
  }

  private pick(requirement: string): Scope {
    const words = new Set(
      requirement
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter(Boolean),
    )
    const memory = this.member.memory?.toLowerCase() ?? ""

    const ranked = this.modules
      .map((mod) => {
        const text = `${mod.path} ${mod.files.join(" ")} ${mod.summary ?? ""}`.toLowerCase()
        const score = [...words].reduce((sum, word) => {
          if (text.includes(word)) return sum + 3
          const hit = Object.values(tags).some((list) => list.includes(word) && list.some((tag) => text.includes(tag)))
          return hit ? sum + 1 : sum
        }, 0) + (memory.includes(mod.path.toLowerCase()) ? 2 : 0)

        return { id: mod.id, score }
      })
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))

    const picked = ranked.filter((item) => item.score > 0).map((item) => item.id)
    return {
      summary: picked.length > 0 ? `聚焦 ${picked.length} 个相关模块` : "未识别出明确模块，默认覆盖全部模块",
      moduleIds: picked.length > 0 ? picked : this.modules.map((mod) => mod.id),
    }
  }
}
