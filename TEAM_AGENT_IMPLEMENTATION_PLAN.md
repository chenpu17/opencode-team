# Team Agent V2 实施计划

## 目标拆分

本次改造按四层推进：

1. 组织层
2. 激活层
3. 执行层
4. 记忆与恢复层

先纠正领域模型，再扩展执行能力。不能继续在“压缩工程师池”的实现上叠功能。

## Phase 1: 组织模型纠偏

### 目标

- 团队长期存在
- 每个模块有唯一工程师 owner
- 并发配置从组织层进入执行层

### 代码改动

- `types`
  - 为 `Team` 增加 `maxParallel`
  - 为 `Member` 增加 `scope / moduleId / modulePath`
  - 为 `Run` 增加 `phase / round / moduleIds / activatedMemberIds / maxParallel`
- `storage`
  - 扩展 sqlite schema 与兼容迁移
- `TeamManager`
  - `createMembers()` 改为按模块逐个创建工程师
  - `createTeam()` 持久化并发配置
- `TaskRouter`
  - 使用团队并发配置
- `Tool`
  - `TeamCreate.max` 解释为最大并发，而不是工程师数量

### 验收标准

- 创建团队后，工程师数量等于模块数量
- 每个模块 owner 唯一且稳定
- 同一次 run 只激活涉及模块的工程师
- 即使激活人数很多，也只按 `maxParallel` 执行

## Phase 2: 激活与动态协同

### 目标

- 把“团队存在”与“本次谁参与”分开
- 支持复杂问题的动态调查轮次

### 代码改动

- 引入 run phase 迁移：
  - `scoping`
  - `planning`
  - `investigating`
  - `executing`
  - `validating`
  - `completed`
  - `error`
- Architect 支持先分配调查任务再收敛实施任务
- 增加证据记录结构：
  - 日志
  - 根因假设
  - 文件定位
  - 风险说明

### 验收标准

- bug 分析不再直接全量拆任务
- 能先激活少量相关 owner 做调查
- 调查结果可反哺后续实施计划

## Phase 3: 成员记忆

### 目标

- 每个成员有独立长期记忆
- 工程师记忆按模块归属

### 代码改动

- 新增 `memory` 存储
- 按成员维度保存：
  - 决策
  - 历史问题
  - 测试偏好
  - 风险提示
  - 未完成事项
- Engineer 执行前装载模块记忆
- 执行后沉淀增量记忆

### 验收标准

- 同一模块工程师跨 run 能继承上下文
- 不同模块工程师记忆相互隔离
- Architect 能读取跨模块共享决策，而不是模块实现细节

## Phase 4: 可恢复执行

### 目标

- 中断后可恢复
- 恢复的是 run 与成员工作状态，不是重新开始

### 代码改动

- 保存成员工作快照
- 保存执行中的 step 指针
- 保存 investigation 证据与 round 状态
- 增加 `resume` 工作流

### 验收标准

- `Esc` 或进程退出后，下次可以恢复未完成 run
- 已完成步骤不重复执行
- 相关成员可以看到自己的上次上下文

## 开发顺序

1. Phase 1 先落地
2. 补齐对应测试
3. 再推进调查轮次与成员记忆

## 本轮实际启动项

本轮直接实现：

- Phase 1 全部基础字段
- 团队创建逻辑改造
- 状态输出增加激活态
- 第一批验证测试

后续紧接着进入：

- Architect 的动态调查轮次
- 工程师 memory 存储
- run resume
