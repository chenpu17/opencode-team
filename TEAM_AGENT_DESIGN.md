# Team Agent V2 设计

## 目标

`Team Agent` 的目标不是构建一个临时的 subagent 池，而是为代码仓库建立一个可长期存在的虚拟研发组织。

核心约束：

- `PM / Architect` 是固定全局角色
- `Engineer` 与模块所有权 `1:1` 对应
- 一个仓库有多少模块，就概念上有多少模块工程师
- 单次需求只激活相关工程师，不需要全员参与
- 激活人数与执行并发分离，并发需要单独限流
- 模块工程师后续需要独立记忆与可恢复工作状态

## 现存问题

当前实现仍然保留了明显的“工程师池”思路：

- `createMembers()` 会用 `maxEngineers` 把多个模块压缩到少量工程师名下
- `TeamCreate` 的 `max` 参数表达的是“工程师数量”，不是“执行并发”
- 持久化保存了团队、任务、步骤，但还没有真正的工程师级会话恢复模型

这和目标模型冲突，会导致：

- 模块所有权不稳定
- 工程师记忆无法独立沉淀
- UI 上看到的是执行器池，而不是组织结构
- 复杂问题分析难以基于明确 owner 做协同

## V2 领域模型

### 1. Organization Layer

团队是仓库级长期对象：

- `Team`
  - 仓库路径
  - 默认并发上限
  - 创建与更新时间
- `Member`
  - `pm`
  - `architect`
  - `engineer`
- `Module`
  - 模块路径
  - 文件集合
  - 依赖关系
  - 唯一 owner

关键规则：

- 每个模块必须绑定唯一 `engineer`
- `engineer.moduleId === module.id`
- `module.ownerId === engineer.id`
- 全局角色 `scope = global`
- 模块工程师 `scope = module`

### 2. Activation Layer

一次用户需求对应一次 `Run`，不是重建团队。

`Run` 至少包含：

- `requirement`
- `phase`
- `round`
- `moduleIds`
- `activatedMemberIds`
- `maxParallel`

语义区分：

- `moduleIds`: 本次需求涉及的模块范围
- `activatedMemberIds`: 本次真正参与的成员
- `maxParallel`: 执行层的限流参数

### 3. Execution Layer

执行层只负责任务调度，不决定组织结构。

规则：

- 一个工程师同一时间只执行一个步骤
- 多个工程师可以并行执行
- 实际同时运行的步骤数不得超过 `maxParallel`
- 激活工程师数可以远大于 `maxParallel`

### 4. Memory Layer

记忆要按成员归属，而不是按单次 run 归属。

后续应支持：

- `PM` 记忆：产品目标、业务约束、历史决策
- `Architect` 记忆：架构边界、依赖风险、拆解策略
- `Engineer(module)` 记忆：模块约定、历史坑点、测试关注点、未完成事项

第一阶段不实现完整 memory 执行闭环，但需要先把组织模型固定下来，否则 memory 无法正确归属。

### 5. Recovery Layer

恢复不是“重新分析一遍”，而是继续未完成 run。

最终目标：

- 持久化每个成员的工作状态
- 持久化 run 的 phase / round / activation
- 持久化未完成步骤与证据
- 中断后支持恢复而不是只标记失败

## 复杂问题的协同模型

对于 bug / 大需求，不能让架构师单点拍脑袋拆任务。建议采用动态轮次：

1. `triage`
   - Architect 先缩小影响范围，提出初始假设
2. `investigate`
   - 激活少量相关工程师做证据收集
   - 输出日志、调用链、文件定位、复现条件
3. `converge`
   - Architect 基于证据修正问题边界与实施方案
4. `execute`
   - 激活实施工程师并限流执行
5. `validate`
   - QA / Architect / 对应工程师回归验证

轮次应该是动态停止，不应该固定写死 3 轮或 5 轮。停止条件应基于：

- 根因是否收敛
- 方案是否可执行
- 风险是否可控
- 验证是否通过

## 第一阶段落地范围

本轮开发先完成基础模型纠偏：

1. 团队创建改为“每模块一个工程师”
2. `max` 从“工程师数量”转义为“最大并发执行数”
3. `Run` 保存激活成员、模块范围、阶段和轮次
4. 状态查询输出组织与激活信息
5. 存储层为后续 memory / resume 扩展预留稳定结构

## 后续阶段

第二阶段：

- 成员级 memory 存储
- 调查轮次驱动
- 恢复中断 run

第三阶段：

- 协同调查子任务
- 模块 owner 信誉与能力画像
- 更细粒度的调度与冲突控制
