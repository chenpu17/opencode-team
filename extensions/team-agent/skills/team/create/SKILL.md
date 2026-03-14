---
name: team_create
description: 创建开发团队，自动分析代码结构并分配工程师
---

# 团队创建

此命令用于首次初始化虚拟工程师团队。

## 使用方法

```bash
/team_create
```

如果团队已经存在，请改用：

- `/team_sync`
- `/team_rebuild`

## 功能

1. 扫描项目代码文件
2. 按目录结构识别模块
3. 统计每个模块的代码量
4. 创建产品经理和架构师
5. 为每个模块分配工程师

## 示例

```bash
/team_create

# 输出：
# 正在分析项目...
# 识别到 4 个模块：
#   - src/auth (8,500行)
#   - src/api (12,300行)
#   - src/ui (15,600行)
#   - src/database (6,200行)
#
# 创建团队成功！
#   - ProductManager
#   - Architect
#   - Engineer_src_auth
#   - Engineer_src_api
#   - Engineer_src_ui
#   - Engineer_src_database
```
