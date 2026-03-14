# Team Agent Todo

## Done

- [x] 组织模型纠偏：每模块一个工程师 owner
- [x] 激活与并发分离：激活人数不等于执行并发
- [x] 问题类需求动态协同：先调查，再收敛，再执行
- [x] 成员级 memory 持久化
- [x] 团队重建时保留成员身份与模块记忆
- [x] 中断 run 恢复能力
- [x] `TeamResume` 工具入口
- [x] 状态输出补充 resume / memory 信息
- [x] 回归测试与类型检查

## Next

- [x] UI 展示 run phase / round / resume 入口
  验收：侧边栏能区分 `investigating / executing / interrupted`，中断后明确提示可恢复
- [x] UI 展示成员 memory 状态
  验收：每个虚拟员工可看到是否已有记忆、最近更新时间
- [x] Memory 压缩与分类
  验收：区分调查结论、实施记录、风险提示，避免 memory 无限制增长
- [x] Architect 使用 memory 参与后续拆解
  验收：二次处理相似问题时，调查范围和收敛结果能复用历史记忆
- [x] PM / Architect 独立记忆策略细化
  验收：PM 保留业务目标，Architect 保留架构决策，避免和模块实现记忆混杂
- [x] Resume 精细化
  验收：恢复时尽量只重跑未完成 step，不重置已完成调查证据
- [x] Investigation 停止条件优化
  验收：避免固定轮次，基于证据充分性自动停止或升级协同范围
- [x] 跨模块协同任务
  验收：某模块工程师可显式请求其他 owner 协助，协助结果进入同一 run
- [x] 冲突控制
  验收：多个工程师涉及同文件时给出冲突提示或顺序化执行
- [x] 状态恢复 UX 优化
  验收：启动时区分“历史中断”与“当前错误”，不直接把旧错误当成当前状态噪音
- [x] 端到端集成测试
  验收：覆盖 `create -> assign -> interrupt -> resume -> complete`
- [x] 文档补全
  验收：补齐用户使用说明、运行说明、恢复说明、状态字段说明

## Order

1. 已完成
