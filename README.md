# 并肩 · 双人生活打卡

这是一个固定双人的学习、工作与生活记录空间。两个人打开同一个网址，分别输入自己的密码即可进入同一份数据；页面不会显示“角色 A/B”选择，也不需要邀请流程。

## 本地体验

已有的本地预览：<http://127.0.0.1:4173/>

本地预览没有配置云端环境变量时，会自动使用浏览器 `localStorage`，体验密码是：

- 我：`solarized`
- 搭档：`bluebird`

这些密码只用于本机演示，不要用于公网。恢复演示数据可打开：<http://127.0.0.1:4173/?reset-demo=1>

```bash
npm install
npm run check
npm test
npm run verify
npm run dev
```

## 跨日与草稿行为

- 共享版以服务端配置的 `APP_TIMEZONE`（默认 `Asia/Shanghai`）为日期准线；保存记录、回应和打卡都会拒绝已经过期的日期。
- 编辑器始终绑定打开时的日期。跨日后，旧日未完成内容会留在原日期草稿中，新一天从当天已保存记录或空白内容开始。
- 页面会提示可恢复的旧草稿；“复制到今天”会合并文字、评分和图片。评分冲突或超过 6 张图片上限时，无法完整复制的旧草稿会继续保留。
- 草稿输入采用防抖自动保存，并在刷新、关闭标签页或退出前同步写入本机存储。

`npm run verify` 会执行所有 JavaScript 语法检查和跨日自动化测试。

## 让朋友真正共享使用

静态网页本身不能共享 `localStorage`。正式使用需要一个 Vercel 项目（网页 + API）和一个 Supabase 项目（数据库 + 图片存储）。本目录已经包含所需 API 与迁移脚本。

### 1. 创建 Supabase 数据库

1. 在 Supabase 新建项目。
2. 打开 SQL Editor，完整粘贴并执行 [`supabase/schema.sql`](./supabase/schema.sql)。
3. 在 Project Settings → API 复制 **Project URL** 和 **service_role key**。service role key 只能放在 Vercel 的服务端环境变量里，不能写进前端、Git 仓库或聊天消息。

### 2. 生成两个密码哈希

准备两个不同的正式密码（建议各 16 位以上），在本目录运行两次：

```bash
node scripts/hash-password.mjs
```

把输出的 bcrypt 字符串分别保存为 `APP_PASSWORD_ME_HASH` 和 `APP_PASSWORD_PARTNER_HASH`。脚本不会保存明文密码。

### 3. 部署到 Vercel

在 Vercel 导入这个目录，或使用 CLI：

```bash
npx vercel login
npx vercel --prod
```

在 Vercel 项目的 Settings → Environment Variables 添加：

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
APP_PASSWORD_ME_HASH
APP_PASSWORD_PARTNER_HASH
SESSION_SECRET
APP_TIMEZONE=Asia/Shanghai
QQ_USER
QQ_AUTH
QQ_TO_PARTNER
QQ_TO_ME
APP_PUBLIC_URL
```

邮件通知使用 QQ 邮箱 SMTP：

- `QQ_USER`：用于发信的 QQ 邮箱。
- `QQ_AUTH`：QQ 邮箱生成的 SMTP 授权码，不是邮箱登录密码。
- `QQ_TO_PARTNER`：本人点击打卡时，接收邮件的搭档邮箱。
- `QQ_TO_ME`：搭档点击打卡时，接收邮件的本人邮箱；不填时默认使用 `QQ_USER`。
- `APP_PUBLIC_URL`：邮件里“打开并肩”按钮指向的正式网址。

旧配置名 `QQ_TO` 仍可作为 `QQ_TO_PARTNER` 的兼容值。授权码与邮箱地址只放在 Vercel 服务端环境变量中；不要上传或提交 `smtp.env`。

邮件通知还需要持久化防重复记录。已有 Supabase 项目请先在 SQL Editor 执行：

```text
supabase/migrations/20260813_checkin_notifications.sql
```

新建环境则依次执行 `supabase/schema.sql` 和上述迁移。迁移会建立仅供 service role 使用的通知 outbox；浏览器既不能读取收件地址，也不能自行提交邮件正文。

`SESSION_SECRET` 至少 32 个随机字节，例如：

```bash
openssl rand -base64 48
```

配置完成后重新部署。将 Vercel 生成的网址发给朋友即可：两个人输入各自密码，记录、评分、Stars、愿望、回应和头像/背景都会通过服务端共享。页面可见时每 20 秒检查一次远端状态，回到页面时再检查一次；数据没有变化时不会更新 DOM，确有变化时也只刷新当前区域，不会重建编辑器或跳动光标。编辑中的内容先自动保存为本机草稿，点击“保存今日记录”后才同步给对方；点击“打卡并通知搭档”会先保存当前记录，再将记录与本周格言发到搭档邮箱。离线预览不会发送真实邮件。

已有表格积分可通过 `wallets.opening_lifetime_points` 与 `opening_spent_stars` 结转，不需要伪造历史日志或愿望。真实打卡内容和结转数值只保存在 Supabase，不写入公开代码仓库。

## 第一版的规则

- 学习与工作每天 `0–5` 分。
- 生活与娱乐每天 `0–5` 分。
- 累计总分每满 100 分获得 1 颗 Star；空心 `☆` 表示已使用，实心 `★` 表示仍可用。
- 发出一个愿望消耗 1 颗 Star；愿望状态为“待回应 → 已接受 → 已完成”。
- 修改记录后，Star 按当前日志总分重新计算，不会因反复编辑同一天而重复发放。

## 目录说明

- `index.html` / `styles.css` / `app.js`：舒适简约的 Solarized 前端。
- `api/`：密码登录、共享状态、原子命令、图片上传和退出接口。
- `lib/server.js`：bcrypt 密码校验、HMAC HttpOnly 会话、Supabase 访问封装。
- `supabase/schema.sql`：表、视图、事务 RPC 和 `pair-media` 存储桶初始化。
- `.env.example`：环境变量模板。

如果只用本机静态服务器，数据仍然只在当前浏览器中；只有完成 Vercel + Supabase 配置后才是双方共享版本。
