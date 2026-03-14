import type { Plugin, Hooks } from "@opencode-ai/plugin"
import { TeamManager } from "./core/team-manager"
import z from "zod"
import { log, error as logError } from "./util/logger"

export default (async ({ client, project, directory }) => {
  log('Plugin', 'Initializing team-agent plugin', { directory })
  const manager = new TeamManager(client, project, directory)

  await manager.init()
  log('Plugin', 'Team manager initialized')

  const run = async (requirement: string, abort?: AbortSignal) => {
    const tasks = await manager.assignTask(requirement, abort)
    return JSON.stringify({
      success: true,
      status: 'executing',
      message: `任务已启动，共 ${tasks.length} 个子任务正在后台执行中`,
      tasks: tasks.length,
    })
  }

  return {
    tool: {
      TeamCreate: {
        description: "初始化开发团队；如果团队已存在，请改用 TeamSync 或 TeamRebuild",
        args: {
          max: z.number().min(1).max(20).default(5),
          maxLines: z.number().min(100).max(1000000).default(30000),
        },
        execute: async (args) => {
          try {
            log('Plugin', 'TeamCreate called', args)
            if (await manager.getActiveTeam()) {
              return JSON.stringify({
                success: false,
                error: "Team already exists. Use TeamSync or TeamRebuild.",
              })
            }
            const result = await manager.createTeam({
              maxParallel: args.max as number,
              maxLinesPerModule: args.maxLines as number,
            })

            log('Plugin', 'TeamCreate completed', { teamId: result.team.id })
            return JSON.stringify({
              success: true,
              teamId: result.team.id,
              members: result.members.map(m => ({
                name: m.name,
                role: m.role,
                scope: m.scope,
                modulePath: m.modulePath,
                status: m.status
              })),
              modules: result.modules.length,
              maxParallel: result.team.maxParallel,
              summary: `团队已创建：${result.members.length}个成员，${result.modules.length}个模块，最大并发 ${result.team.maxParallel}`
            })
          } catch (error) {
            logError('Plugin', 'TeamCreate failed', error)
            return JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            })
          }
        },
      },

      TeamSync: {
        description: "增量同步团队结构；保留 owner、任务卡片和 memory",
        args: {
          max: z.number().min(1).max(20).default(5),
          maxLines: z.number().min(100).max(1000000).default(30000),
        },
        execute: async (args) => {
          try {
            log('Plugin', 'TeamSync called', args)
            const result = await manager.syncTeam({
              maxParallel: args.max as number,
              maxLinesPerModule: args.maxLines as number,
            })
            return JSON.stringify({
              success: true,
              teamId: result.team.id,
              modules: result.modules.length,
              members: result.members.length,
              summary: `团队已同步：${result.members.length} 个成员，${result.modules.length} 个模块`,
            })
          } catch (error) {
            logError('Plugin', 'TeamSync failed', error)
            return JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            })
          }
        },
      },

      TeamRebuild: {
        description: "重建团队结构；重新分配成员身份，可选清空 memory",
        args: {
          max: z.number().min(1).max(20).default(5),
          maxLines: z.number().min(100).max(1000000).default(30000),
          resetMemory: z.boolean().default(false),
        },
        execute: async (args) => {
          try {
            log('Plugin', 'TeamRebuild called', args)
            const result = await manager.rebuildTeam({
              maxParallel: args.max as number,
              maxLinesPerModule: args.maxLines as number,
              resetMemory: args.resetMemory as boolean,
            })
            return JSON.stringify({
              success: true,
              teamId: result.team.id,
              modules: result.modules.length,
              members: result.members.length,
              resetMemory: args.resetMemory as boolean,
              summary: `团队已重建：${result.members.length} 个成员，${result.modules.length} 个模块`,
            })
          } catch (error) {
            logError('Plugin', 'TeamRebuild failed', error)
            return JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            })
          }
        },
      },

      TeamAssign: {
        description: "已废弃的兼容入口；请改用 TeamRun",
        args: {
          requirement: z.string(),
        },
        execute: async (args, ctx) => {
          try {
            log('Plugin', 'TeamAssign called', { requirement: args.requirement })
            const result = await run(args.requirement as string, ctx.abort)
            log('Plugin', 'TeamAssign completed')
            return result
          } catch (error) {
            logError('Plugin', 'TeamAssign failed', error)
            return JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            })
          }
        },
      },

      TeamRun: {
        description: "显式启动一次团队任务执行",
        args: {
          requirement: z.string(),
        },
        execute: async (args, ctx) => {
          try {
            log('Plugin', 'TeamRun called', { requirement: args.requirement })
            return await run(args.requirement as string, ctx.abort)
          } catch (error) {
            logError('Plugin', 'TeamRun failed', error)
            return JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            })
          }
        },
      },

      TeamResume: {
        description: "恢复上一次中断的团队任务",
        args: {},
        execute: async (_args, ctx) => {
          try {
            log('Plugin', 'TeamResume called')
            const tasks = await manager.resumeRun(ctx.abort)
            return JSON.stringify({
              success: true,
              status: 'executing',
              message: `已恢复团队任务，待继续处理 ${tasks.length} 个子任务`,
              tasks: tasks.length,
            })
          } catch (error) {
            logError('Plugin', 'TeamResume failed', error)
            return JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            })
          }
        },
      },

      TeamStatus: {
        description: "低频查看团队状态（建议仅在用户明确要求时或至少30秒后调用一次）",
        args: {},
        execute: async () => {
          log('Plugin', 'TeamStatus called')
          const status = await manager.getStatus()
          return JSON.stringify({
            ...status,
            guidance: {
              sidebar: "侧边栏会自动刷新",
              poll: "若运行中且没有新问题，建议至少 30 秒后再手动查询一次 TeamStatus",
            },
          })
        },
      },
    },
  } satisfies Hooks
}) satisfies Plugin
