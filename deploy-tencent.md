# 腾讯云部署指南

## 方案一：云服务器（CVM）部署

### 步骤1：购买云服务器
1. 访问 https://cloud.tencent.com/product/cvm
2. 购买一台轻量应用服务器（推荐配置：2核2G，系统选 Ubuntu 20.04/22.04）
3. 记住你的服务器公网IP和登录密码

### 步骤2：登录服务器
```bash
ssh root@你的服务器IP
```

### 步骤3：安装 Node.js 和 PM2
```bash
# 安装 Node.js（Node 20+）
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 安装 PM2
npm install -g pm2
```

### 步骤4：上传代码到服务器
有两种方式：

#### 方式A：从 GitHub 拉取（推荐）
```bash
# 克隆你的仓库
cd /root
git clone https://github.com/Neverwhateve/wuziqi.git
cd wuziqi
```

#### 方式B：本地打包上传
```bash
# 在本地执行
cd /Users/calvinchen/Trae/wuziqi
npm run build
# 然后使用 scp 或其他工具上传到服务器
```

### 步骤5：安装依赖和启动
```bash
cd /root/wuziqi
npm run build

# 使用 PM2 启动服务
pm2 start ecosystem.config.js --name wuziqi
pm2 save
pm2 startup
```

### 步骤6：配置安全组和防火墙
1. 在腾讯云控制台 -> 安全组 -> 开放端口 8080（或者你修改的端口）
2. 如果需要用域名，需要配置 Nginx 反向代理

## 方案二：云开发（CloudBase）部署

### 步骤1：开通云开发
1. 访问 https://cloud.tencent.com/product/tcb
2. 开通云开发服务，创建环境

### 步骤2：创建云函数和静态网站托管
1. 使用云函数部署后端
2. 使用静态网站托管部署前端

## 方案三：使用 Zeabur（最简单，免费）

### 步骤
1. 访问 https://zeabur.com
2. 使用 GitHub 账号登录
3. 导入你的仓库
4. 一键部署

Zeabur 在国内访问很快，而且有免费额度！
