import { BaseAgent } from "./base-agent"
import type { createOpencodeClient } from "@opencode-ai/sdk"
import type { Module, Step, Member } from "../types"
import { log, error as logError } from "../util/logger"
import path from "path"

const FILE_LIMIT = 4
const LINE_LIMIT = 800
const FILE_LINES = 220
const SLICE = 6

export class EngineerAgent extends BaseAgent<Step, string> {
  constructor(
    client: ReturnType<typeof createOpencodeClient>,
    member: Member,
    private module: Module,
    private modules: Module[],
    private directory: string,
    abort?: AbortSignal,
  ) {
    super(client, member, abort)
  }

  async execute(task: Step): Promise<string> {
    log('EngineerAgent', 'Starting task execution', { engineer: this.member.name, taskId: task.id })
    this.updateStatus('working')

    try {
      const context = await this.buildContext(task)
      log('EngineerAgent', 'Creating session', { engineer: this.member.name })
      await this.createSession()
      await this.sendContext(context)

      log('EngineerAgent', 'Sending message to LLM', { engineer: this.member.name, taskId: task.id })
      const result = await this.sendMessage(this.buildTask(task))
      log('EngineerAgent', 'Received LLM response', { engineer: this.member.name, resultLength: result.length })

      task.result = result
      task.status = 'completed'
      task.completedAt = Date.now()

      this.updateStatus('completed')
      log('EngineerAgent', 'Task completed successfully', { engineer: this.member.name, taskId: task.id })
      return result
    } catch (error) {
      task.error = error instanceof Error ? error.message : 'Unknown error'
      task.status = 'error'
      this.updateStatus('error')
      logError('EngineerAgent', 'Task execution failed', { engineer: this.member.name, error })
      throw error
    } finally {
      log('EngineerAgent', 'Cleaning up session', { engineer: this.member.name })
      await this.cleanup()
    }
  }

  private buildTask(task: Step) {
    if (task.kind === 'investigation') {
      return [
        "你是该模块负责人，当前处于调查阶段，不要直接修改代码。",
        `调查标题: ${task.title}`,
        `调查描述: ${task.description}`,
        `重点文件: ${task.files.join(", ") || "模块内相关文件"}`,
        "输出要求：",
        "- 怀疑点：列出最可能的根因。",
        "- 证据：列出支持判断的调用链、文件或行为。",
        "- 影响模块：如需其他模块协助，明确写出模块路径。",
        "- 下一步建议：说明应继续调查还是可以进入修复。",
      ].join("\n")
    }

    return [
      "你是该模块的负责人，只能基于当前模块和依赖接口做实现决策。",
      `任务标题: ${task.title}`,
      `任务描述: ${task.description}`,
      `目标文件: ${task.files.join(", ") || "模块内相关文件"}`,
      "要求：",
      "- 优先修改当前模块内文件。",
      "- 若需要跨模块变更，只能基于依赖接口说明提出明确建议。",
      "- 输出要包含改动计划、风险和测试建议。",
    ].join("\n")
  }

  private async buildContext(task: Step) {
    const deps = this.modules.filter((mod) => this.module.imports.includes(mod.path))
    const files = await Promise.all(this.module.files.map((file) => this.load(file, task)))
    const picked = this.pick(files)
    const api = deps
      .map((mod) => {
        return [
          `Dependency: ${mod.path}`,
          `Summary: ${mod.summary ?? "N/A"}`,
          ...(mod.exports.length > 0 ? mod.exports.map((item) => `- ${item}`) : mod.files.slice(0, 3).map((item) => `- file: ${item}`)),
        ].join("\n")
      })
      .join("\n\n")

    return [
      `Module: ${this.module.path}`,
      `Files: ${this.module.files.length}`,
      `Lines: ${this.module.lineCount}`,
      `Summary: ${this.module.summary ?? "N/A"}`,
      `Member Memory: ${this.member.memory ?? "None"}`,
      `Selected Files: ${picked.length}/${this.module.files.length}`,
      "",
      "Dependency Interfaces:",
      api || "None",
      "",
      "Relevant Code:",
      picked.map((item) => item.body).join("\n\n"),
    ].join("\n")
  }

  private async load(file: string, task: Step) {
    const text = await Bun.file(path.join(this.directory, file)).text()
    const lines = text.length === 0 ? [] : text.split("\n")
    const words = this.words(`${task.title}\n${task.description}`)
    const hits = lines.flatMap((line, i) => {
      const body = line.toLowerCase()
      return words.some((word) => body.includes(word)) ? [i] : []
    })
    const name = path.basename(file).toLowerCase()
    const score =
      hits.length * 3 +
      (task.files.includes(file) ? 20 : 0) +
      words.reduce((sum, word) => sum + (name.includes(word) ? 8 : 0), 0) +
      (/index|main|route|service|handler|controller/.test(name) ? 2 : 0)

    return {
      file,
      lines,
      score,
      hits,
      body: this.body(file, lines, hits),
    }
  }

  private pick(files: Array<{ file: string; lines: string[]; score: number; hits: number[]; body: string }>) {
    const ranked = [...files].sort((a, b) => b.score - a.score || a.lines.length - b.lines.length || a.file.localeCompare(b.file))
    const list = ranked.some((file) => file.score > 0) ? ranked.filter((file) => file.score > 0) : ranked
    const out: typeof ranked = []
    let sum = 0

    for (const file of list) {
      const size = file.body.split("\n").length
      if (out.length > 0 && out.length >= FILE_LIMIT) continue
      if (out.length > 0 && sum + size > LINE_LIMIT) continue
      out.push(file)
      sum += size
    }

    if (out.length > 0) return out
    return ranked.slice(0, 1)
  }

  private body(file: string, lines: string[], hits: number[]) {
    const text = hits.length === 0 || lines.length <= FILE_LINES ? lines.join("\n") : this.slice(lines, hits)
    return [`### ${file}`, text].join("\n")
  }

  private slice(lines: string[], hits: number[]) {
    const seen = new Set<number>()
    const out: string[] = []

    hits.slice(0, 4).forEach((hit, idx) => {
      const start = Math.max(0, hit - SLICE)
      const end = Math.min(lines.length, hit + SLICE + 1)
      if (idx > 0) out.push("...")
      for (let i = start; i < end; i++) {
        if (seen.has(i)) continue
        seen.add(i)
        out.push(lines[i]!)
      }
    })

    return out.join("\n")
  }

  private words(text: string) {
    return [...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9_\-\u4e00-\u9fff]+/)
        .filter((word) => word.length >= 2),
    )]
  }
}
