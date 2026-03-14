---
name: team_sync
description: 同步团队结构，保留 owner 和 memory
---

# 团队同步

当团队已经存在，但代码结构有变化时，使用此命令增量同步。

## 使用方法

```bash
/team_sync
```

## 功能

1. 重新分析模块边界
2. 保留已有 owner
3. 保留成员 memory
4. 更新模块与工程师映射
