# 阿里云部署指南

## 前提条件
- 已购买阿里云ECS服务器（推荐Ubuntu 20.04/22.04）
- 已有域名 `wzq.wuxiela.fun`
- 代码已推送到GitHub

## 部署步骤

### 步骤1：登录阿里云服务器
```bash
ssh root@你的服务器IP
# 输入密码登录
```

### 步骤2：安装必要软件
```bash
# 更新系统
apt update && apt upgrade -y

# 安装 Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 安装 PM2（进程管理器）
npm install -g pm2

# 安装 Nginx
apt install -y nginx

# 安装 Git
apt install -y git
```

### 步骤3：从GitHub拉取代码
```bash
cd /root
git clone https://github.com/Neverwhateve/wuziqi.git
cd wuziqi

# 安装依赖
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..

# 构建项目
npm run build
```

### 步骤4：配置SSL证书（阿里云免费证书）

#### 方式A：阿里云控制台申请免费证书（推荐）
1. 登录 [阿里云SSL证书控制台](https://yundun.console.aliyun.com/?p=cas#/certExt)
2. 点击 **申请证书** → 选择 **DigiCert 免费版**
3. 填写域名 `wzq.wuxiela.fun`
4. 完成DNS验证
5. 下载证书（选择Nginx格式）
6. 你会得到两个文件：`xxxx.pem` 和 `xxxx.key`

#### 方式B：使用Certbot自动申请（免费）
```bash
# 安装Certbot
apt install -y certbot python3-certbot-nginx

# 申请证书（会自动配置Nginx）
certbot --nginx -d wzq.wuxiela.fun
# 按提示操作，输入邮箱，同意条款
```

### 步骤5：上传证书文件（如果用方式A）
在你的本地电脑执行：
```bash
# 上传证书文件到服务器
scp /path/to/your/cert.pem root@你的服务器IP:/etc/nginx/ssl/wuziqi.pem
scp /path/to/your/key.pem root@你的服务器IP:/etc/nginx/ssl/wuziqi.key
```

在服务器上创建目录：
```bash
mkdir -p /etc/nginx/ssl
```

### 步骤6：配置Nginx
在服务器上编辑Nginx配置：
```bash
# 创建网站配置文件
nano /etc/nginx/sites-available/wuziqi
```

将以下内容复制进去（注意修改域名和证书路径）：
```nginx
# HTTP 80端口 - 重定向到 HTTPS
server {
    listen 80;
    server_name wzq.wuxiela.fun;
    return 301 https://$server_name$request_uri;
}

# HTTPS 443端口 - 主配置
server {
    listen 443 ssl http2;
    server_name wzq.wuxiela.fun;

    # SSL 证书配置 - 根据你的证书路径修改
    ssl_certificate /etc/nginx/ssl/wuziqi.pem;
    ssl_certificate_key /etc/nginx/ssl/wuziqi.key;

    # SSL 安全配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # 前端静态文件
    location / {
        # 检查是否是 WebSocket 升级请求
        if ($http_upgrade = "websocket") {
            proxy_pass http://localhost:8080;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            # WebSocket 超时设置
            proxy_connect_timeout 7d;
            proxy_send_timeout 7d;
            proxy_read_timeout 7d;
            break;
        }

        # 普通 HTTP 请求 - 前端静态文件
        root /root/wuziqi/server/public;
        try_files $uri $uri/ /index.html;
        index index.html;
    }
}
```

保存并退出（按 `Ctrl+X`，然后 `Y`，然后 `Enter`）

### 步骤7：启用Nginx配置
```bash
# 创建软链接
ln -s /etc/nginx/sites-available/wuziqi /etc/nginx/sites-enabled/

# 测试配置是否正确
nginx -t

# 如果看到 "syntax is ok" 和 "test is successful"，重启Nginx
systemctl restart nginx

# 设置Nginx开机自启
systemctl enable nginx
```

### 步骤8：启动应用服务
```bash
cd /root/wuziqi

# 使用PM2启动服务
pm2 start ecosystem.config.js --name wuziqi

# 保存PM2配置
pm2 save

# 设置PM2开机自启
pm2 startup
# 按提示执行输出的命令
```

### 步骤9：配置阿里云安全组
1. 登录 [阿里云ECS控制台](https://ecs.console.aliyun.com)
2. 找到你的实例 → 点击 **安全组** → **配置规则**
3. 添加入方向规则：
   - **端口范围**：`80/80`
   - **授权对象**：`0.0.0.0/0`
   - **端口范围**：`443/443`
   - **授权对象**：`0.0.0.0/0`

### 步骤10：测试访问
在浏览器访问 `https://wzq.wuxiela.fun`，应该可以看到五子棋游戏了！

## 常用维护命令

### 查看应用日志
```bash
pm2 logs wuziqi
```

### 重启应用
```bash
pm2 restart wuziqi
```

### 更新代码
```bash
cd /root/wuziqi
git pull
npm run build
pm2 restart wuziqi
```

## 故障排查

### Nginx错误
```bash
# 查看Nginx错误日志
tail -f /var/log/nginx/error.log
```

### 应用无法启动
```bash
# 检查端口是否被占用
netstat -tlnp | grep 8080

# 查看PM2日志
pm2 logs wuziqi --lines 100
```

祝你部署顺利！🎉
