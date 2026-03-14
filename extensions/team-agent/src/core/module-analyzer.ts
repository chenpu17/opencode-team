import { glob } from "glob"
import path from "path"
import type { Module } from "../types"

type File = {
  path: string
  dir: string
  lines: number
  imports: string[]
  exports: string[]
}

type Group = {
  path: string
  files: string[]
  lineCount: number
}

export class ModuleAnalyzer {
  async analyze(
    directory: string,
    teamId: string,
    opts: { minLines?: number; maxLines?: number } = {},
  ): Promise<Module[]> {
    const min = opts.minLines ?? 1
    const max = opts.maxLines ?? 30000
    const files = await glob("**/*.{ts,tsx,js,jsx}", {
      cwd: directory,
      ignore: ["node_modules/**", "dist/**", "build/**", ".git/**"],
    })
    const meta = await Promise.all(files.map((file) => this.scan(directory, file)))
    const map = new Map(meta.map((file) => [file.path, file]))
    const raw = [...this.group(meta).entries()].flatMap(([dir, list]) => this.split(dir, list, map, max))
    const bases = raw.map((item) => item.path.split("#")[0]!)

    return raw
      .filter((item) => item.lineCount >= min)
      .map((item) => {
        const mods = item.files.map((file) => map.get(file)!)
        const imports = [...new Set(mods.flatMap((file) => file.imports.flatMap((spec) => this.link(file, spec, bases))))]
          .filter((dir) => dir !== item.path.split("#")[0])

        return {
          id: this.id(),
          teamId,
          path: item.path,
          files: item.files,
          lineCount: item.lineCount,
          imports,
          exports: [...new Set(mods.flatMap((file) => file.exports))],
          summary: `${item.files.length} files, ${item.lineCount} lines`,
        }
      })
  }

  private group(files: File[]) {
    const groups = new Map<string, string[]>()

    for (const file of files) {
      const parts = file.path.split(path.sep)
      const dir = parts.length > 2 ? path.join(parts[0]!, parts[1]!) : (parts[0] || ".")
      const list = groups.get(dir)
      if (list) {
        list.push(file.path)
        continue
      }
      groups.set(dir, [file.path])
    }

    return groups
  }

  private split(dir: string, files: string[], map: Map<string, File>, max: number): Group[] {
    const lineCount = files.reduce((sum, file) => sum + (map.get(file)?.lines ?? 0), 0)
    if (lineCount <= max) return [{ path: dir, files, lineCount }]
    if (files.length <= 1) return this.chunk(dir, files, map, max)

    const next = new Map<string, string[]>()
    for (const file of files) {
      const rel = path.relative(dir, file)
      const head = rel.split(path.sep)[0]!
      const key = rel.includes(path.sep) ? path.join(dir, head) : dir
      const list = next.get(key)
      if (list) {
        list.push(file)
        continue
      }
      next.set(key, [file])
    }

    if (next.size > 1) {
      return [...next.entries()].flatMap(([key, list]) => {
        if (key === dir && list.length === files.length) return this.chunk(dir, list, map, max)
        return this.split(key, list, map, max)
      })
    }

    return this.chunk(dir, files, map, max)
  }

  private chunk(dir: string, files: string[], map: Map<string, File>, max: number) {
    const out: Group[] = []
    let list: string[] = []
    let sum = 0
    let idx = 1

    for (const file of [...files].sort()) {
      const lines = map.get(file)?.lines ?? 0
      if (list.length > 0 && sum + lines > max) {
        out.push({
          path: out.length === 0 && list.length === files.length ? dir : `${dir}#${idx++}`,
          files: list,
          lineCount: sum,
        })
        list = []
        sum = 0
      }

      list.push(file)
      sum += lines
    }

    if (list.length > 0) {
      out.push({
        path: out.length === 0 && list.length === files.length ? dir : `${dir}#${idx}`,
        files: list,
        lineCount: sum,
      })
    }

    return out
  }

  private async scan(base: string, file: string): Promise<File> {
    const full = path.join(base, file)
    const text = await Bun.file(full).text().catch(() => "")
    return {
      path: file,
      dir: path.dirname(file),
      lines: text.length === 0 ? 0 : text.split("\n").length,
      imports: [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]!).filter((spec) => spec.startsWith(".")),
      exports: this.contracts(file, text),
    }
  }

  private contracts(file: string, text: string) {
    const lines = text.split("\n")
    const cards = new Set<string>()
    const push = (line: string) => {
      const body = line.replace(/\s+/g, " ").trim()
      if (!body.startsWith("export ")) return
      cards.add(`${path.basename(file)}: ${body}`)
    }

    lines.forEach((line) => {
      const body = line.trim()
      if (!body.startsWith("export ")) return
      if (body.startsWith("export {")) return
      if (body.startsWith("export *")) return
      push(body)
    })

    return [...cards].slice(0, 12)
  }

  private link(file: File, spec: string, mods: string[]) {
    const dir = path.normalize(path.join(file.dir, spec))
    return mods
      .filter((mod) => dir === mod || dir.startsWith(`${mod}${path.sep}`) || mod.startsWith(`${dir}${path.sep}`))
      .sort((a, b) => b.length - a.length)
      .slice(0, 1)
  }

  private id() {
    return `mod_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  }
}
