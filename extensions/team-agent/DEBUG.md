# Debug Logging

## 启用调试日志

设置环境变量来启用详细的调试日志：

```bash
export DEBUG_TEAM_AGENT=true
```

## 运行带调试日志的 OpenCode

```bash
# 在项目根目录
cd /Users/chenpu/workspace/claude-code/opencode-team

# 启用调试并运行
DEBUG_TEAM_AGENT=true bun run dev
```

## 日志内容

启用后，你将看到以下组件的详细日志：

- **Plugin**: 插件初始化和工具调用
- **TeamManager**: 团队创建、任务分配
- **TaskRouter**: 任务路由和批次执行
- **ArchitectAgent**: 任务分解
- **EngineerAgent**: 工程师任务执行
- **BaseAgent**: Session 创建、消息发送、清理

## 日志格式

```
[2026-03-10T03:10:45.673Z] [Component] Message { data }
```

## 示例输出

```
[2026-03-10T03:10:45.673Z] [Plugin] Initializing team-agent plugin { directory: '/path/to/project' }
[2026-03-10T03:10:45.673Z] [TeamManager] Initializing team manager
[2026-03-10T03:10:45.673Z] [TeamManager] Status sync started
[2026-03-10T03:10:45.673Z] [Plugin] Team manager initialized
[2026-03-10T03:10:45.673Z] [Plugin] TeamCreate called { max: 5, maxLines: 30000 }
[2026-03-10T03:10:45.673Z] [TeamManager] Creating team { maxEngineers: 5, maxLinesPerModule: 30000 }
[2026-03-10T03:10:45.673Z] [TeamManager] Analyzing modules { directory: '/path/to/project' }
[2026-03-10T03:10:45.673Z] [TeamManager] Modules analyzed { count: 3 }
[2026-03-10T03:10:45.673Z] [TeamManager] Members created { count: 5 }
[2026-03-10T03:10:45.673Z] [TeamManager] Member task created { member: 'ProductManager', taskId: '...' }
```

## 诊断问题

如果虚拟团队成员没有显示在任务列表中，日志会显示：

1. `createMemberTask` 是否被调用
2. `task?.create` API 是否成功
3. 返回的 taskId 是什么

如果任务执行没有结果，日志会显示：

1. Session 是否成功创建
2. LLM 消息是否发送
3. 响应是否收到
4. 结果长度是多少
