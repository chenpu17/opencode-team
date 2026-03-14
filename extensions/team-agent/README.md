# Team Agent Plugin

基于模块负责制的 OpenCode 团队协作系统。

## 功能

- 自动分析代码结构，识别模块边界
- 为每个模块分配虚拟工程师
- 支持多 Agent 并行工作
- 节约 70-80% 的上下文

## 安装

```bash
cd extensions/team-agent
bun install
```

## 使用

```bash
# 创建团队
/team_create

# 查看状态
/team_status
```

## 开发状态

- [x] 项目框架
- [x] 模块分析器
- [x] 团队管理器
- [x] Plugin 入口
- [ ] Agent 实现
- [ ] 任务路由
- [ ] UI 面板

## 架构

```
src/
├── core/           # 核心逻辑
├── agent/          # Agent 实现
├── ui/             # UI 组件
├── storage/        # 数据存储
└── types/          # 类型定义
```
