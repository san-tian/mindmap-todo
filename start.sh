#!/bin/bash

echo "======================================"
echo "  思维导图 TODO - 启动脚本"
echo "======================================"
echo ""

# 启动后端
echo "启动后端服务器..."
cd "$(dirname "$0")"
source venv/bin/activate
python app.py &
BACKEND_PID=$!
echo "后端 PID: $BACKEND_PID"

# 等待后端启动
sleep 2

# 启动前端
echo "启动前端开发服务器..."
cd web
npm run dev &
FRONTEND_PID=$!
echo "前端 PID: $FRONTEND_PID"

echo ""
echo "======================================"
echo "  服务已启动！"
echo "======================================"
echo "后端: http://localhost:5000"
echo "前端: http://localhost:3000"
echo ""
echo "按 Ctrl+C 停止所有服务"
echo "======================================"

# 捕获 Ctrl+C 并清理进程
trap "echo ''; echo '正在停止服务...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT

# 保持脚本运行
wait
