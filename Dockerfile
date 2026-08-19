# ============================================
# 思维导图 TODO - Docker 镜像（多阶段构建）
# ============================================

# ---------- 阶段 1：构建前端 ----------
FROM node:22-alpine AS frontend
WORKDIR /app/web

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./
RUN npm run build

# ---------- 阶段 2：运行环境 ----------
FROM python:3.11-slim
WORKDIR /app

# 安装后端依赖
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# 后端代码
COPY app.py ./

# 已构建的前端静态文件
COPY --from=frontend /app/web/dist ./web/dist

# 数据目录（通过卷持久化）
RUN mkdir -p /app/data

ENV PYTHONUNBUFFERED=1 \
    PORT=5000 \
    FLASK_DEBUG=0

EXPOSE 5000

CMD ["python", "app.py"]
