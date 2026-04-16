# 本机生产部署方案

这个方案适用于当前阶段的小范围内测：应用运行在你自己的电脑上，对外通过 Cloudflare Tunnel 暴露访问地址。

## 适用范围

- 只有几位内测用户
- 可以接受电脑必须保持开机
- 以低运维成本验证产品，而不是追求正式生产级可用性

## 当前项目形态

- 单体应用：Express 同时提供 API 和前端静态资源
- 数据存储：SQLite，数据库文件是 `soulmate.db`
- 媒体目录：`generated-media/`
- 生产启动入口：`server.ts`

## 一次性准备

1. 安装依赖：

   ```bash
   npm install
   ```

2. 配置环境变量：

   ```bash
   cp .env.example .env.local
   ```

   至少填写：

   - `MINIMAX_M2HER_API_KEY`
   - `MINIMAX_API_KEY`
   - `JWT_SECRET`

3. 确保电脑不会自动睡眠。

4. 确保防火墙不会拦截本机 `3000` 端口上的本地访问。

## 本机启动

1. 构建前端：

   ```bash
   npm run build
   ```

2. 直接以生产模式启动：

   ```bash
   npm run start:local-prod
   ```

3. 检查服务是否正常：

   - `http://localhost:3000`
   - `http://localhost:3000/api/health`

## 用 PM2 常驻运行

推荐用 PM2 保持进程常驻，避免终端关闭后服务退出。

1. 全局安装 PM2：

   ```bash
   npm install -g pm2
   ```

2. 首次启动：

   ```bash
   npm run pm2:start
   ```

3. 查看日志：

   ```bash
   npm run pm2:logs
   ```

4. 重启：

   ```bash
   npm run pm2:restart
   ```

5. 停止：

   ```bash
   npm run pm2:stop
   ```

6. 保存当前 PM2 进程列表：

   ```bash
   pm2 save
   ```

7. 按 PM2 提示配置开机自启。

## 对外访问

推荐通过 Cloudflare Tunnel 暴露服务，不推荐直接做家庭网络端口映射。

推荐原因：

- 不需要公网 IP
- 不需要自己处理 HTTPS 证书
- 不需要把本机直接暴露在公网

接入方式：

1. 准备一个托管在 Cloudflare 的域名。
2. 安装 `cloudflared`。
3. 在 Cloudflare 中创建 tunnel。
4. 把一个子域名，例如 `beta.example.com`，转发到：

   ```text
   http://localhost:3000
   ```

5. 将 `cloudflared` 配置为系统服务。

官方文档：

- <https://developers.cloudflare.com/tunnel/>
- <https://developers.cloudflare.com/tunnel/setup/>

如果只是临时演示，也可以用 quick tunnel，但不建议作为长期内测地址。

## 数据备份

当前最重要的本地数据：

- `soulmate.db`
- `soulmate.db-wal`
- `soulmate.db-shm`
- `generated-media/`

仓库里已提供备份脚本：

```bash
npm run backup:local-prod
```

它会在 `backups/<timestamp>/` 下生成数据库副本和 `generated-media` 压缩包。

建议：

- 至少每天备份一次
- 备份目录同步到云盘或外置硬盘
- 在升级依赖或改数据库逻辑前先手动备份一次

## 发布更新流程

每次更新代码时，按下面顺序操作：

1. 备份当前数据：

   ```bash
   npm run backup:local-prod
   ```

2. 拉取最新代码。

3. 安装依赖：

   ```bash
   npm install
   ```

4. 重新构建：

   ```bash
   npm run build
   ```

5. 重启服务：

   ```bash
   npm run pm2:restart
   ```

## 已知限制

- 电脑关机、重启、睡眠、断网时，服务会中断
- SQLite 适合当前单机小规模使用，不适合未来多机扩容
- 你在本机执行重负载任务时，可能影响内测稳定性
- 这是内测方案，不是正式生产方案

## 建议的下一步升级路径

当出现下面任一情况时，建议迁移到云服务器：

- 需要 24 小时稳定在线
- 内测用户增多
- 你不希望个人电脑长期开机
- 需要更稳定的公网访问
- 需要更规范的日志、备份和恢复能力
