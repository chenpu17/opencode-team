# 第二轮代码审核和修复

## ✅ 修复的关键问题

### 1. BaseAgent 类型系统 (Critical)
**问题**: 子类返回类型不一致
**修复**: 改为泛型 `BaseAgent<TInput, TOutput>`
```typescript
- BaseAgent (抽象)
- EngineerAgent extends BaseAgent<Task, string>
- ArchitectAgent extends BaseAgent<string, Task[]>
```

### 2. TaskRouter 拓扑排序 bug (Critical)
**问题**: 循环依赖时静默失败
**修复**: 添加循环依赖检测并抛出错误
```typescript
if (batch.length === 0) {
  throw new Error(`Circular dependency detected`)
}
```

### 3. TaskRouter 返回类型错误 (Critical)
**问题**: `topologicalSort` 返回 `string[][]` 但需要 `Task[][]`
**修复**: 直接操作 Task 对象而非 ID
```typescript
private topologicalSort(tasks: Task[]): Task[][]
```

### 4. 错误处理改进 (High)
**问题**: `Promise.all` 一个失败全部失败
**修复**: 使用 `Promise.allSettled` 记录所有失败
```typescript
const results = await Promise.allSettled(...)
const failed = results.filter(r => r.status === 'rejected')
```

### 5. 类型安全 (High)
**问题**: 使用 `any` 类型
**修复**: 使用正确的类型 `ReturnType<typeof createOpencodeClient>`

### 6. 代码规范 (Medium)
**问题**: 不必要的中间变量
**修复**: 内联 `id` 变量

## 📊 修复统计

- **Critical 问题**: 3 个 ✅
- **High 问题**: 2 个 ✅
- **Medium 问题**: 1 个 ✅
- **代码行数变化**: +15 / -20

## ✅ 验证

所有修复已完成，代码现在：
- ✅ 类型安全
- ✅ 循环依赖检测
- ✅ 错误处理完善
- ✅ 符合代码规范
