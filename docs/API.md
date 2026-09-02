# mindmap-todo API 参考

思维导图 TODO 应用的 REST API。所有请求/响应均为 JSON。

## 基础地址

| 场景 | 地址 |
|------|------|
| Tailscale（默认） | `http://100.78.161.108:23456` |
| 局域网 | `http://192.168.31.232:23456` |

> 可用环境变量 `MINDMAP_TODO_URL` 覆盖基础地址。接口无鉴权。

## 数据模型

```jsonc
// 节点
{
  "id": "5",                        // 数字字符串（在项目内唯一）
  "type": "custom",
  "position": { "x": 50, "y": 250 },
  "data": {
    "label": "任务文字",
    "status": "pending"             // running | waiting | pending | idel | done | context
    "createdAt": "2026-08-19T06:57:05Z",  // 创建时间（自动生成）
    "doneAt": "2026-08-19T07:00:00Z",      // 完成时间（status→done 时自动生成）
    "quadrant": "q1"                       // 四象限：q1/q2/q3/q4（可选）
  }
}

// 边（父子关系）
{
  "id": "e1-5",
  "source": "1",                    // 父节点 id
  "target": "5",                    // 子节点 id
  "type": "default",
  "markerEnd": { "type": "arrowclosed" }
}

// 项目
{
  "id": "e0470148",                 // 8 位 hex 字符串
  "name": "8月week3",
  "nodes": [ /* ... */ ],
  "edges": [ /* ... */ ],
  "createdAt": "...",
  "updatedAt": "..."
}
```

- **根节点**（一级节点）：没有入边的节点，其 `label` 即项目名。
- 节点 `status`：`running`（进行中）/ `waiting`（等待中）/ `pending`（待办）/ `idel`（暂缓）/ `done`（完成）/ `context`（上下文/项目描述，不计入 TODO）。
- **状态只在叶子节点**：只有叶子节点（没有子节点的节点）才有 `status` 且会在画布上显示状态图标；中间节点（有子节点，含二级 task）和根节点不显示状态。**API 对非叶子节点设置 status 会返回 400**（`只有叶子节点支持设置状态`）。

## 接口总览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/settings` | 获取全局设置 |
| POST | `/api/settings` | 保存全局设置（`{bgMode}`） |
| GET | `/api/projects` | 列出所有项目 |
| POST | `/api/projects` | 创建项目 `{name}` |
| GET | `/api/projects/<pid>` | 获取项目完整数据 |
| POST | `/api/projects/<pid>` | 保存项目 `{nodes, edges}` |
| PATCH | `/api/projects/<pid>` | 重命名项目 `{name}` |
| DELETE | `/api/projects/<pid>` | 删除项目 |
| POST | `/api/projects/<pid>/nodes` | 新增节点 `{label, parentId?, status?}` |
| PATCH | `/api/projects/<pid>/nodes/<nid>` | 更新节点 `{label?, status?}` |
| DELETE | `/api/projects/<pid>/nodes/<nid>` | 删除节点及其子树 |
| POST | `/api/projects/<pid>/nodes/<nid>/move` | 移动节点到新父级 `{parentId}` |

所有响应都带 `success: true/false`；失败时附 `error` 说明。

## 示例（curl）

```bash
BASE=http://100.78.161.108:23456

# 健康检查
curl -s $BASE/api/health

# 列出项目
curl -s $BASE/api/projects

# 创建项目
curl -s -X POST $BASE/api/projects \
  -H 'Content-Type: application/json' \
  -d '{"name":"我的项目"}'

# 获取项目（含 nodes/edges）
curl -s $BASE/api/projects/e0470148

# 新增根节点
curl -s -X POST $BASE/api/projects/e0470148/nodes \
  -H 'Content-Type: application/json' \
  -d '{"label":"新任务","status":"pending"}'

# 新增子节点（挂到节点 1 下面）
curl -s -X POST $BASE/api/projects/e0470148/nodes \
  -H 'Content-Type: application/json' \
  -d '{"label":"子任务","parentId":"1","status":"running"}'

# 更新节点状态 / 文字
curl -s -X PATCH $BASE/api/projects/e0470148/nodes/5 \
  -H 'Content-Type: application/json' \
  -d '{"status":"done","label":"已完成的任务"}'

# 移动节点 5 到节点 2 下面
curl -s -X POST $BASE/api/projects/e0470148/nodes/5/move \
  -H 'Content-Type: application/json' \
  -d '{"parentId":"2"}'

# 删除节点 5 及其子树
curl -s -X DELETE $BASE/api/projects/e0470148/nodes/5
```

## 注意事项

- 新增节点不指定 `parentId` 时会成为新的根节点；指定则挂为子节点。
- 移动节点会自动做防环校验（不能移到自己的后代下面）。
- 删除节点会递归删除整棵子树。
- 节点 `status` 只接受 `running` / `waiting` / `pending` / `idel` / `done` / `context`。
- **状态只在叶子节点**：对非叶子节点（有子节点）设置 status 会返回 400。
- 节点 `quadrant`（四象限，可选）只接受 `q1`（重要紧急）/ `q2`（重要不紧急）/ `q3`（不重要紧急）/ `q4`（不重要不紧急）；传空值表示清除。
- 节点自动记录 `createdAt`（创建时间）和 `doneAt`（变为 done 的时间；取消 done 时自动清除）。
- 前端加载项目时会自动按当前规则重新排版，因此 API 写入的坐标只是初始值，不必精确。

## Agent 接口（面向脚本/agent，无鉴权，靠网络隔离）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/agent/projects` | 列出项目（同 `/api/projects`） |
| GET | `/api/agent/projects/<pid>` | 获取项目 JSON；`?format=markdown` 返回文字版 |
| POST | `/api/agent/projects/<pid>/edit` | 批量编辑 `{ops:[...], baseUpdatedAt?}` |

### 批量编辑 ops

字段命名直白化（旧名仍兼容）：

| 语义 | 直白名（推荐） | 兼容旧名 |
|------|--------------|---------|
| 任务内容 | `text` | `label` |
| 幂等标识（可选） | `id_key` | `key` |
| 父节点 id | `parent_id` | `parentId` |
| 父节点 key | `parent_key` | `parentKey` |

```jsonc
{
  "ops": [
    // upsert：按 id_key（或 id）查找；命中则更新，未命中则创建（挂到 parent 下）
    { "op": "upsert", "id_key": "deps", "text": "依赖安装", "status": "running", "parent_id": "2", "quadrant": "q2" },
    // 父节点也可以用 parent_key 定位；缺省 = 根节点
    { "op": "upsert", "id_key": "deploy", "text": "部署上线", "parent_key": "deps" },
    // delete：删除节点及其整棵子树
    { "op": "delete", "id_key": "deploy" }
  ],
  // 可选：乐观锁。与服务端 updatedAt 不一致时返回 {success:false, conflict:true, project:...}
  "baseUpdatedAt": "2026-08-24T07:00:00+00:00"
}
```

要点：
- `text` = 任务内容（唯一真正需要 LLM 理解的字段）；`id_key` = 稳定幂等标识，给定后按它查找更新而非新建。
- `parent_id` / `parent_key` 缺省挂根节点；`status`：`running`/`waiting`/`pending`/`idel`/`done`/`context`；`quadrant`：`q1`~`q4`。
- `status`：`running`/`waiting`/`pending`/`idel`/`done`/`context`；`quadrant`：`q1`~`q4`。
- **状态只在叶子节点**：对已有中间节点（有子节点）设置 status 会返回 400；新建节点是叶子，可带 status。
- 整批原子：任一 op 非法则整批不生效，返回 400 并附 `op[下标]` 错误。
- 会自动防环（不能挂到自身或后代下）、递归删子树、记录 `createdAt`/`doneAt`。

### 完整示例：读 → 改 → 回写（乐观锁）

```bash
BASE=http://100.78.161.108:23456
PID=e0470148

# 1. 读
P=$(curl -s $BASE/api/agent/projects/$PID)
BASE_VER=$(echo "$P" | python3 -c 'import json,sys; print(json.load(sys.stdin)["updatedAt"])')

# 2. 批量改（带版本号，防与网页端互覆盖）
curl -s -X POST $BASE/api/agent/projects/$PID/edit \
  -H 'Content-Type: application/json' \
  -d "{\"ops\":[{\"op\":\"upsert\",\"id_key\":\"report\",\"text\":\"写周报\",\"status\":\"running\"}],\"baseUpdatedAt\":\"$BASE_VER\"}"
```

## 导出（留档）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/projects/<pid>/export?format=markdown` | 文字版 Markdown（附件下载） |
| GET | `/api/projects/<pid>/export?format=json` | 项目 JSON（附件下载，默认） |
| GET | `/api/agent/projects/<pid>?format=markdown` | 同上（文字版） |

文字版格式（状态符号 + 层级缩进）：

```markdown
# 8月week3
- ▶ 部署
  - ○ 压测
    - ✓ 镜像
- ✓ 杂项
```

状态符号：`▶` 运行中 · `⏳` 等待中 · `○` 待办 · `⏸` 暂缓 · `✓` 已完成 · `ℹ` 上下文。

网页工具栏也提供「复制 MD」「复制 JSON」按钮，一键复制到剪贴板。
