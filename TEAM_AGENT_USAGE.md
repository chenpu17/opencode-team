# Team Agent 使用说明

## 创建团队

使用 `TeamCreate`：

- `max`: 最大并发执行数
- `maxLines`: 模块切分的最大行数

结果：

- 建立长期团队
- 为每个模块创建唯一工程师 owner
- 保留已有成员 identity 与 memory

## 启动任务

使用 `TeamRun`：

- 普通需求会直接进入执行
- 问题类需求会先进入调查，再收敛到执行
- `TeamAssign` 仍可兼容旧调用，但已经不再推荐

状态含义：

- `scoping`: PM 正在识别范围
- `planning`: Architect 正在做计划
- `investigating`: 模块工程师在调查根因
- `executing`: 模块工程师在实施
- `completed`: 本次 run 完成
- `error`: 本次 run 出错或已中断

## 恢复任务

使用 `TeamResume`：

- 当 run 被中断且仍有未完成工作时可恢复
- 已完成步骤不会重跑
- 未完成步骤会继续进入调度

## Memory

每个成员都有独立 memory：

- PM：产品目标与范围判断
- Architect：架构调查与决策摘要
- Engineer：调查结论与实施记录

memory 会在：

- 后续团队重建时保留
- 工程师执行时注入上下文
- 后续相似问题拆解时参与范围判断

## 侧边栏状态

侧边栏会展示：

- run phase
- 当前 round
- resume 是否可用
- 成员是否已有 memory
- 任务属于 `investigation` 还是 `execution`
