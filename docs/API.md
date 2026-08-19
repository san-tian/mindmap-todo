# mindmap-todo API 参考

思维导图 TODO 应用的 REST API。所有请求/响应均为 JSON。

## 基础地址

| 场景 | 地址 |
|------|------|
| Tailscale（默认） | `http://100.71.116.107:23456` |
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
    "status": "pending"             // running | pending | done
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
- 节点 `status`：`running`（进行中）/ `pending`（待办）/ `done`（完成）。

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
BASE=http://100.71.116.107:23456

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
- 节点 `status` 只接受 `running` / `pending` / `done`。
- 前端加载项目时会自动按当前规则重新排版，因此 API 写入的坐标只是初始值，不必精确。
