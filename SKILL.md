---
name: mindmap-todo
description: 操作思维导图 TODO 应用（mindmap-todo）。通过 REST API 管理多项目思维导图任务：列出/创建/重命名/删除项目，新增/更新/删除/移动节点，设置任务状态(running/pending/done)，获取项目树。当用户要往思维导图 TODO 里添加任务、修改任务状态、整理项目层级，或需要读取其任务数据时使用。
---

# mindmap-todo 操作 Skill

## 概述

mindmap-todo 是一个多项目、思维导图形式的任务管理应用。无需打开页面，直接通过 REST API 即可完成全部操作（本项目已提供节点级接口）。

## 基础地址

默认：`http://100.71.116.107:23456`（Tailscale）
局域网：`http://192.168.31.232:23456`

可用环境变量 `MINDMAP_TODO_URL` 覆盖。接口无鉴权。

## 关键概念

- **项目（project）**：一张独立的导图，`id` 为 8 位 hex 字符串；根节点（一级节点）的 `label` 即项目名。
- **节点（node）**：`id` 为数字字符串；`data.label` 是文字，`data.status` 是状态。
- **状态**：`running`（进行中）/ `pending`（待办）/ `done`（完成）/ `context`（上下文/项目描述，不计入 TODO）。
- **四象限**：节点可选 `quadrant` 字段，取值 `q1`（重要紧急）/ `q2`（重要不紧急）/ `q3`（不重要紧急）/ `q4`（不重要不紧急）；传空值清除。
- **时间**：节点自动记录 `createdAt`（创建）和 `doneAt`（标记完成时自动生成，取消完成时清除）。
- **父子关系**：由边 `source -> target` 表达；没有入边的节点是根节点。

## 最常用操作

```bash
BASE=${MINDMAP_TODO_URL:-http://100.71.116.107:23456}

# 列出项目
curl -s $BASE/api/projects

# 创建项目（根节点会自动用项目名）
curl -s -X POST $BASE/api/projects -H 'Content-Type: application/json' \
  -d '{"name":"8月week3"}'

# 新增节点（不指定 parentId = 根节点；指定 = 子节点）
curl -s -X POST $BASE/api/projects/<pid>/nodes -H 'Content-Type: application/json' \
  -d '{"label":"写周报","parentId":"1","status":"running"}'

# 改状态 / 改文字
curl -s -X PATCH $BASE/api/projects/<pid>/nodes/<nid> -H 'Content-Type: application/json' \
  -d '{"status":"done"}'

# 移动层级
curl -s -X POST $BASE/api/projects/<pid>/nodes/<nid>/move -H 'Content-Type: application/json' \
  -d '{"parentId":"2"}'

# 删除节点（含子树）
curl -s -X DELETE $BASE/api/projects/<pid>/nodes/<nid>'
```

## 完整 API 文档

见 [`docs/API.md`](docs/API.md)，包含全部端点、数据模型与 curl 示例。

## 常见任务指引

1. **读取某项目的任务树**：`GET /api/projects/<pid>`，从 `nodes`/`edges` 构建父子关系；根节点是「没有入边」的节点。
2. **加一个任务到某分类下**：先找到分类节点的 `id`（其 `label` 匹配），再 `POST /api/projects/<pid>/nodes` 带 `parentId`。
3. **把任务标记完成**：`PATCH /api/projects/<pid>/nodes/<nid>` 带 `{"status":"done"}`。
4. **改名**：节点改名用 `PATCH .../nodes/<nid>`；项目改名用 `PATCH /api/projects/<pid>`（根节点标题会同步）。
