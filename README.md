# Soulmate AI

你的专属 AI 伴侣应用。基于 MiniMax 大模型，支持多角色对话、关系成长、朋友圈等功能。

## 技术栈

- **前端**: React 19 + TypeScript + Vite + Tailwind CSS v4
- **后端**: Express + SQLite (better-sqlite3)
- **AI**: MiniMax API (文本生成 + 图片生成)
- **认证**: 手机号 + 密码 + JWT

## 本地运行

**前置条件:** Node.js, MiniMax API Key

1. 安装依赖:
   ```bash
   npm install
   ```

2. 创建环境变量文件:
   ```bash
   cp .env.example .env.local
   ```
   编辑 `.env.local`，填入你的 `MINIMAX_API_KEY` 和 `JWT_SECRET`。

3. 启动开发服务器:
   ```bash
   npm run dev
   ```

4. 访问 http://localhost:3000，注册账号即可使用。

## 项目结构

```
├── server.ts              # Express 入口
├── server/
│   ├── db.ts              # SQLite 数据库初始化
│   ├── auth.ts            # JWT 认证
│   ├── minimax.ts         # MiniMax API 封装
│   └── routes.ts          # 业务 API 路由
├── src/
│   ├── App.tsx            # React 根组件
│   ├── components/        # UI 组件
│   └── lib/
│       ├── api.ts         # 前端 API 客户端
│       ├── auth-context.tsx # 认证上下文
│       ├── events.ts      # 关系事件
│       └── utils.ts       # 工具函数
```
