# Team Agent Plugin

基于模块 owner 的长期虚拟研发组织。

## 功能

- 自动分析代码结构，识别模块边界
- 为每个模块分配唯一工程师 owner
- 将激活成员与执行并发分离
- 支持调查、实施、恢复和成员记忆
- 在侧边栏同步团队与运行状态

## 安装

```bash
cd extensions/team-agent
bun install
```

## 使用

```bash
# 创建初始团队
/team_create

# 增量同步模块结构
/team_sync

# 显式启动一次团队任务
/team_run "修复登录异常"

# 恢复上次中断任务
/team_resume

# 查看状态
/team_status
```

## 命令约定

- `team_run` 是当前主入口
- `TeamAssign` 仅作为兼容别名保留
- 首次创建使用 `team_create`
- 团队已存在后，结构变更优先使用 `team_sync`
- 需要全量重算时使用 `team_rebuild`

## 架构

```
src/
├── core/           # 核心逻辑
├── agent/          # Agent 实现
├── ui/             # UI 组件
├── storage/        # 数据存储
└── types/          # 类型定义
```
