#!/bin/bash

# 腾讯云一键部署脚本

echo "========================================="
echo "  五子棋游戏 腾讯云部署脚本"
echo "========================================="

# 检查 Node.js 是否安装
if ! command -v node &> /dev/null; then
    echo "正在安装 Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

# 检查 PM2 是否安装
if ! command -v pm2 &> /dev/null; then
    echo "正在安装 PM2..."
    npm install -g pm2
fi

# 安装项目依赖
echo "正在安装项目依赖..."
npm run build

# 使用 PM2 启动服务
echo "正在启动服务..."
pm2 start ecosystem.config.js --name wuziqi
pm2 save
pm2 startup

echo ""
echo "========================================="
echo "  部署成功！"
echo "  访问地址：http://你的服务器IP:8080"
echo "  记得在腾讯云安全组开放端口 8080"
echo "========================================="
echo ""
echo "常用命令："
echo "  pm2 logs wuziqi      - 查看日志"
echo "  pm2 restart wuziqi   - 重启服务"
echo "  pm2 stop wuziqi      - 停止服务"
echo "  pm2 status           - 查看状态"
