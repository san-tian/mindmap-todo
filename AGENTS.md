# AGENTS.md

本文件给 AI 编码代理（agent）使用：说明这个项目怎么改、怎么部署、怎么发布。

## 项目

- 思维导图 TODO：Flask 后端（`app.py`）+ React/React Flow 前端（`web/`）。
- GitHub：https://github.com/san-tian/mindmap-todo（`origin`，ssh）。
- 后端 API 文档：`docs/API.md`；agent 操作手册：`SKILL.md`。

## 常用开发命令

```bash
# 前端构建（改 web/ 后必须跑）
cd web && npm run build

# 后端语法检查
python3 -c "import ast; ast.parse(open('app.py').read())"
```

## 部署到 NAS（正式环境）

> 以 NAS 部署为准。NAS 上的 Docker 镜像源 `docker.fnnas.com` 拉基础镜像会返回 401，**无法在 NAS 上 `docker build`**。因为本机与 NAS 都是 x86_64，所以流程是：**本机构建镜像 → 打包传输到 NAS → NAS 上 load + 启动**。

NAS 信息：
- 主机 `MEmini-2380`（Debian 12，x86_64，Docker 28.5.2）
- SSH 别名（见 `~/.ssh/config`）：
  - `nas` → `106.52.237.179:10220`，用户 `pex`（公网入口，慢）
  - `nas-ts` → `100.78.161.108`，用户 `pex`（**tailscale 直连，快，部署用这个**）
- 部署目录：`/home/pex/mindmap-todo`
- 端口：宿主机 `23456` → 容器 `5000`
- 数据：`/home/pex/mindmap-todo/data`（挂载为容器内 `/app/data`）

### 部署命令（在本机项目根目录执行）

```bash
cd /home/dev/mindmap-todo

# 1. 构建镜像
docker build -t mindmap-todo:latest .

# 2. 打包
docker save mindmap-todo:latest | gzip -1 > /tmp/mindmap-todo.tar.gz

# 3. 传输到 NAS（走 tailscale，scp 大文件用后台任务避免超时）
scp -o BatchMode=yes /tmp/mindmap-todo.tar.gz nas-ts:/home/pex/mindmap-todo/mindmap-todo.tar.gz

# 4. NAS 上 load 并重启
ssh -o BatchMode=yes nas-ts 'cd /home/pex/mindmap-todo && gunzip -c mindmap-todo.tar.gz | docker load && docker compose up -d'

# 5. 健康检查
ssh -o BatchMode=yes nas-ts 'sleep 2; curl -s http://localhost:23456/api/health'
```

### 访问地址

- 局域网：`http://192.168.31.232:23456`
- Tailscale：`http://100.78.161.108:23456`
- API（无鉴权）：`http://100.78.161.108:23456`（可用环境变量 `MINDMAP_TODO_URL` 覆盖）

### NAS 运维命令

```bash
ssh nas-ts 'docker compose -f /home/pex/mindmap-todo/docker-compose.yml logs --tail 50 mindmap-todo'
ssh nas-ts 'cd /home/pex/mindmap-todo && docker compose restart'
ssh nas-ts 'cd /home/pex/mindmap-todo && docker compose down'   # 停止（数据仍在 data/）
```

注意：NAS 上的 `docker-compose.yml` 已去掉 `build:`（镜像靠 load 传入）；仓库里的 `docker-compose.yml` 保留 `build:` 供其它环境用。

## 提交与发布

```bash
cd /home/dev/mindmap-todo
git add -A
git -c user.name="san-tian" -c user.email="admin@macaron.xin" commit -m "feat: ..."
git push origin main
```

提交前确认：`data/`、`venv/`、`node_modules/`、`web/dist/`、测试文件、根 `package.json` 都在 `.gitignore` 里，**不要提交任何真实任务数据**。
