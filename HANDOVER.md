# 并肩双人打卡项目交接文档

更新日期：2026年10月13日。

接手人需要同时获得 GitHub 代码写入权限、Vercel 项目管理权限和 Supabase 数据库及存储管理权限。沿用现有 Vercel 和 Supabase 项目，可以保留正式网址、历史记录、积分和图片。以下配置表只列变量名称与用途，真实凭据通过私密方式交接。

## 项目入口

| 服务 | 位置 | 用途 |
| --- | --- | --- |
| 正式网站 | <https://pair-star-journal.vercel.app/> | 两人登录、记录、评分和打卡 |
| GitHub | <https://github.com/HappynessI/Together> | 公开代码仓库；当前开发分支为 `main` |
| Git HTTPS 地址 | `https://github.com/HappynessI/Together.git` | 克隆和推送 |
| Git SSH 地址 | `git@github.com:HappynessI/Together.git` | 已配置 SSH 的开发者可使用 |
| Vercel 项目 | <https://vercel.com/happynessis-projects/pair-star-journal> | 网页、API、部署记录、运行日志和环境变量 |
| Vercel Git 设置 | <https://vercel.com/happynessis-projects/pair-star-journal/settings/git> | 核对仓库连接和生产分支 |
| Supabase 历史组织入口 | <https://supabase.com/dashboard/org/ogdxxoiegwugknizgrxw> | 找到实际使用的数据库项目 |

Vercel 项目名称为 `pair-star-journal`。本机 `.vercel/project.json` 已关联该项目；这个目录没有提交到 GitHub，朋友克隆后需要重新关联。

**Supabase 具体项目名称和项目地址需要交接人补充。** 在 Vercel 项目的 Environment Variables 中查看 `SUPABASE_URL`，常规地址为 `https://<project-ref>.supabase.co`；以这个地址和 Supabase 项目设置中的 Project URL 核对，确认后记录 `https://supabase.com/dashboard/project/<project-ref>`。组织入口不能替代具体项目地址。

本地源码目录为 `/Users/yihanwang/Documents/Codex/2026-08-10/new-chat/outputs/pair-star-prototype`。GitHub 仓库根目录直接包含 `index.html`、`package.json` 和 `api/`，Vercel 导入仓库时应以仓库根目录部署，无需设置成本机的 `outputs/pair-star-prototype` 路径。

## 产品规则和架构

项目使用固定空间 `pair` 和两个角色 `me`、`partner`。用户输入各自密码后由服务端识别角色，没有注册、邀请或多人房间流程。

- 学习与工作、生活与娱乐各自每天自评 0–5 分，每天合计最多 10 分。
- 累计每 100 分获得一颗 Star，实心 `★` 表示可用，空心 `☆` 表示已使用。
- 发出愿望消耗一颗 Star，愿望状态为待回应、已接受、已完成。
- 积分由正式日志和历史结转计算，修改同一天的记录不会重复发放 Star。
- 支持 Markdown 预览、时间线、周报、两组评分热力图、昵称、头像和背景。热力图统计站内评分。
- 点击“打卡并通知搭档”先保存正式记录，再发送内容、自评分、每周轮换格言和网站链接。

前端是原生 HTML、CSS 和 JavaScript。浏览器通过同源 `/api/*` 调用 Vercel 的 Node.js 函数；函数用 Supabase service role 访问 PostgreSQL 和私有图片存储，用 Nodemailer 调用 QQ SMTP。

正式登录使用 bcrypt 密码校验和带签名的 HttpOnly 会话 Cookie。浏览器不直接使用 Supabase 密钥。业务日期以 `APP_TIMEZONE` 为准，默认 `Asia/Shanghai`。

**主题由两项独立设置组成。** 主题风格（Solarized、素笺或 Claude）保存在当前浏览器的 `pair-journal-theme-style-v1`，没有记录时使用 Solarized；明暗模式沿用 `state.theme` 和 `profiles.theme`，共享版会同步到同一身份的其他设备。CSS 中 `html[data-style]` 表示风格，`html[data-mode]` 表示明暗，组件只引用 `styles.css` 顶部的语义变量。新增风格需要四处改动：在 `styles.css` 增加明亮和深色两组变量覆盖，在 `app.js` 的 `THEME_STYLES` 中登记，在 `index.html` 设置弹窗中增加按钮，并让 `<head>` 中恢复主题的脚本接受新的取值。`tests/client-state.test.mjs` 会检查这四处是否一致。

**登录过期时不会离线保存。** 任何请求收到 401 后，页面先把编辑器内容写成本机草稿，再回到登录页；重新登录同一身份后草稿自动载入，期间不会修改本机缓存的共享数据。

**输入自动保存的是本机草稿。** 只有点击“保存今日记录”或“打卡并通知搭档”，内容才成为双方共享的正式记录。换设备、清理浏览器数据或者换网站域名，均不会自动迁移本机未提交草稿。

## 代码目录

| 文件或目录 | 作用 |
| --- | --- |
| `index.html`、`styles.css`、`app.js` | 页面结构、Solarized、素笺和 Claude 三套主题变量、编辑器、统计和同步 |
| `api/login.js`、`api/logout.js` | 密码登录和退出 |
| `api/bootstrap.js` | 读取共享状态及服务端日期 |
| `api/command.js` | 保存日志、回应、愿望、昵称、主题和背景操作 |
| `api/media.js` | 头像和背景上传 |
| `api/checkin.js` | 打卡邮件、通知状态和日期校验 |
| `lib/server.js` | 会话、日期、输入校验、数据库访问及图片签名 URL |
| `lib/checkin-email.js` | QQ SMTP、邮件模板和每周格言 |
| `supabase/schema.sql` | 当前基础表、视图、事务函数和私有存储桶 |
| `supabase/migrations/20260813_checkin_notifications.sql` | 邮件通知表及预约发送函数 |
| `tests/` | 跨日草稿、保存与会话过期、愿望防重复提交、主题偏好、服务端日期和分页读取测试；`tests/helpers/` 是在 Node 中加载 `app.js` 的测试环境 |
| `.env.example` | 环境变量模板，不包含正式配置 |
| `vercel.json` | API 执行时间限制及响应安全头 |

数据库初始化使用 `supabase/schema.sql`。仓库中的 `supabase/schema 2.sql` 不在 README 指定的初始化流程中，不应把两份基础脚本同时执行。

## 账号和权限交接

| 项目 | 接手人需要获得的权限或信息 |
| --- | --- |
| GitHub | 对 `HappynessI/Together` 的写入权限；管理 Vercel Git 集成时需要相应仓库管理权限 |
| Vercel | 能查看部署和运行日志、修改环境变量、配置 Git 连接、发布生产版本的权限 |
| Supabase | 能执行 SQL、管理数据库与 Storage、查看项目配置的权限；维护项目设置应授予适当管理员权限 |
| QQ 发件邮箱 | 邮箱归属人、SMTP 授权码管理方式、两人的收件地址 |
| 服务费用 | Vercel 与 Supabase 当前套餐、付款负责人、账单通知人 |

通过平台成员邀请交接各自账号权限。Supabase 的角色及邀请方式见[官方权限说明](https://supabase.com/docs/guides/platform/access-control)。若后续要更换项目归属，应先确认接手人能登录三个平台并管理项目，再完成所有权移交。

## 环境变量交接

配置入口为 Vercel 项目 Settings 中的 Environment Variables。生产部署使用 Production 范围的变量；Preview 和 Development 使用各自范围。修改配置后需要创建新的部署才能使用新值，见[Vercel 环境变量说明](https://vercel.com/docs/environment-variables)。

| 变量 | 是否必须 | 用途与交接内容 |
| --- | --- | --- |
| `SUPABASE_URL` | 必须 | 现有数据库项目的 Project URL；同时用于定位项目 |
| `SUPABASE_SERVICE_ROLE_KEY` | 必须 | 与上述项目对应的服务端 service role key；当前代码读取这个变量名，不能换成 anon 或浏览器 publishable key |
| `APP_PASSWORD_ME_HASH` | 必须 | `me` 角色密码的 bcrypt 校验值；私密交接现有值或生成新值 |
| `APP_PASSWORD_PARTNER_HASH` | 必须 | `partner` 角色密码的 bcrypt 校验值；须与另一个角色使用不同密码 |
| `SESSION_SECRET` | 必须 | 至少 32 字节的会话签名密钥；更换并部署后原会话会失效，需要重新登录 |
| `APP_TIMEZONE` | 建议明确配置 | 使用 `Asia/Shanghai`；影响保存、跨日、回应和打卡日期，移交时保持现有值 |
| `QQ_USER` | 发邮件必须 | 开启 SMTP 的 QQ 发件邮箱 |
| `QQ_AUTH` | 发邮件必须 | QQ SMTP 授权码；与发件邮箱匹配 |
| `QQ_TO_PARTNER` | 本人通知搭档时必须 | `me` 打卡后的收件地址，按私密配置交接 |
| `QQ_TO_ME` | 建议明确配置 | `partner` 打卡后的收件地址；缺省使用 `QQ_USER` |
| `APP_PUBLIC_URL` | 建议明确配置 | `https://pair-star-journal.vercel.app/`；用于邮件中的网站链接，换域名时同步修改 |

`QQ_TO` 是 `QQ_TO_PARTNER` 的兼容旧变量。接手时核对现有值，新配置优先使用 `QQ_TO_PARTNER`。QQ SMTP 使用 `smtp.qq.com:465` 和 TLS，这两项当前写在邮件模块中。

真实 service role key、`SESSION_SECRET`、SMTP 授权码、密码校验值及私人邮箱地址通过私密渠道交接，不写进公开仓库或本文档。`.env.local`、`smtp.env` 和 `.vercel/` 已在忽略规则中；提交前仍需查看 `git diff`。

需要重设网站密码时，在源码根目录分别运行两次：

```bash
node scripts/hash-password.mjs
```

脚本要求密码至少 12 个字符，生成 bcrypt 值。将两次结果分别填入对应变量；避免将明文密码作为命令行参数。这个脚本的交互输入会在终端显示，操作时避免共享屏幕。修改密码不会自动撤销已有 Cookie；需要同时撤销所有现有登录时，应更换 `SESSION_SECRET` 并重新部署。

## 本地开发和检查

安装 Node.js 20 或以上版本及 npm。克隆后在仓库根目录执行：

```bash
git clone https://github.com/HappynessI/Together.git
cd Together
npm ci
npm run verify
```

`npm run verify` 运行 JavaScript 语法检查和测试。2026年10月13日本地执行通过，28 项测试全部成功。线上是否使用当前版本，应以 Vercel 中关联正式域名的 Production 部署为准。

要使用 Vercel 的本地 API 环境，在获得项目权限后执行：

```bash
npx vercel login
npx vercel link
npx vercel pull --environment=development
npm run dev
```

关联时选择现有 `pair-star-journal` 项目。`vercel pull` 将 Development 配置下载到本机 `.vercel/`，见[官方命令说明](https://vercel.com/docs/cli/pull)。先在 Vercel 配好 Development 变量，测试写入应使用独立测试 Supabase 项目，收件地址使用开发者自己的邮箱。

如果只体验页面，可在本机启动静态 HTTP 服务。没有可用云端 API 时，本地预览允许使用演示密码 `solarized` 和 `bluebird`，数据只保存在浏览器，不能发送真实打卡邮件。共享版必须验证服务端登录和数据库读写。

## 沿用现有服务的部署流程

1. 获得三个平台权限，确认现有 Supabase 项目与 `SUPABASE_URL` 一致，核对 Production 环境变量。
2. 在 Vercel Git 设置中确认连接 `HappynessI/Together`，生产分支采用 `main`。若设置不同，以项目实际配置为准。
3. 核对源码根目录和部署设置。当前项目没有前端打包步骤，网页资源位于仓库根目录，API 位于 `api/`。需要重建配置时，框架选择 `Other`，开启 Build Command 的 Override 并留空，静态输出使用源码根目录 `.`，不要设置不存在的 `npm run build` 或 `dist` 目录。操作说明见[Vercel 构建配置](https://vercel.com/docs/builds/configure-a-build)。
4. 本地完成改动并运行 `npm run verify`、`git diff --check`。
5. 提交改动并推送到 GitHub。Git 集成有效时，生产分支的推送会触发正式部署；其他开发分支可用于 Preview，见[Vercel GitHub 部署说明](https://vercel.com/docs/git/vercel-for-github)。
6. 到 Vercel Deployments 确认新部署成功，核对源分支、提交内容和正式域名指向，再按后文验收。

Preview 如果连接生产数据库，测试会修改真实数据，也可能发送真实邮件；发布前应确认测试环境变量的范围和指向。

需要手动发布时，在已关联正确项目、配置齐全且检查通过的源码目录运行：

```bash
npx vercel --prod
```

这个命令直接创建生产部署。普通代码发布不需要重建数据库，也不会自动执行仓库中的 SQL 文件。数据库结构变更需要先核对迁移内容，再单独在正确项目执行。

## 新建服务时的部署流程

如果朋友需要在自己的账号下独立部署：

1. 创建新的 Supabase 项目，在 SQL Editor 先执行 `supabase/schema.sql`，再执行 `supabase/migrations/20260813_checkin_notifications.sql`。
2. 确认基础表、`wallet_summary` 视图、事务函数、`checkin_notifications` 通知表和私有 `pair-media` 存储桶已存在。
3. 将新的 Project URL、service role key 和其余配置填入新 Vercel 项目的环境变量。
4. 在 Vercel 导入 GitHub 仓库，使用仓库根目录，配置 Git 连接和生产分支后部署。
5. 将 `APP_PUBLIC_URL` 改为新网址，再部署并验收。

新数据库初始化只建立结构和默认双人资料，不包含现有历史。若要继承数据，还需要迁移数据库记录、图片对象及相关权限。新项目也不会自动获得原 `pair-star-journal.vercel.app` 域名，保留旧网址应处理现有 Vercel 项目和域名归属。

## 数据库与图片交接

| 数据 | Supabase 中的位置 |
| --- | --- |
| 昵称、明暗模式（`theme` 列）、头像和背景地址 | `public.profiles` |
| 每日文字、评分及日期 | `public.daily_logs` |
| 历史积分与已用 Star 结转 | `public.wallets` 的 `opening_lifetime_points`、`opening_spent_stars` |
| 统计后的积分和 Stars | `public.wallet_summary` 视图及事务维护的数据 |
| 愿望及状态 | `public.wishes` |
| 对搭档记录的回应 | `public.reactions` |
| 邮件通知与防重复状态 | `public.checkin_notifications` |
| 头像和背景文件 | Storage 的私有桶 `pair-media` |

图片上传后保存对象路径，由 API 临时签名生成访问 URL。移交或迁移时保留原对象路径，不能仅复制会过期的签名链接。

备份应包含数据库和 Storage 图片对象。Supabase 的数据库备份不包含 Storage 中的实际文件，图片需另外备份或迁移，见[官方备份说明](https://supabase.com/docs/guides/platform/backups)。浏览器中的未提交草稿由两位使用者各自保存或提交，数据库备份不能恢复这部分内容。

## 发布验收和排障

发布后用两个独立浏览器会话分别登录，完成以下验收。邮件检查使用双方约定的测试内容及收件地址。

- 两个正式密码进入正确角色，昵称与头像正确。
- 保存一条记录，重新打开仍可见；搭档在刷新或下一轮轮询后能看到。
- 保存期间继续输入，后续内容保留为草稿；后台同步不清空文字、不跳动光标。
- 在个性设置中切换主题风格和明暗模式，编辑器内容和光标保持不变；刷新、退出再登录后两项设置都能恢复。
- 登录过期后点击保存会回到登录页，提示内容已保留为本机草稿；重新登录后编辑器恢复这些文字。
- 下一个业务日加载当天记录或空白编辑器；旧草稿提示可查看、复制，历史仍在时间线。
- 周报、热力图、累计分数和已用 Stars 与原数据一致。
- 头像和背景正常上传、显示，愿望和回应可以读写。
- 打卡邮件包含正确日期、内容、自评分、格言和网站链接；重复确认同一次通知不会重复发送。

| 症状 | 检查位置与处理 |
| --- | --- |
| 无法登录 | Vercel API 日志、两份 bcrypt 值、`SESSION_SECRET`；未登录访问 bootstrap 返回 401 属于预期 |
| 记录不能共享 | 确认使用公网共享版及同一个 Supabase 项目；自动保存仅是本机草稿，需点击正式保存 |
| API 提示缺少表或函数 | 核对 Supabase 项目和 SQL 迁移；检查基础 schema、昵称 RPC 和通知迁移 |
| 跨日返回 HTTP 409 | 检查 `APP_TIMEZONE`、响应中的 `appDate` 和客户端版本；保留旧日内容，不将旧请求自动改记到今天 |
| 图片打不开 | 检查 `pair-media` 对象路径、桶权限、service role key 和 API 日志 |
| 邮件未配置或被拒绝 | 检查 `QQ_USER`、`QQ_AUTH`、收件地址、SMTP 开启情况及 `/api/checkin` 日志 |
| 通知结果未知 | 检查 `checkin_notifications` 与收件箱；先确认发送结果，避免盲目重复发送 |
| 推送后网页未更新 | 查看 Vercel Git 连接、生产分支、部署状态和正式域名指向 |

`loadState()` 按 1000 行一页读取全部日志和愿望（`readAllPages`），每页大小需要不大于 Supabase 项目 API 设置中的 Max rows（默认 1000）。调低 Max rows 时，同步调低 `lib/server.js` 中的 `READ_PAGE_SIZE`。自动化测试覆盖语法、跨日、保存与会话过期、主题偏好和分页逻辑；真实午夜、网络延迟、多设备并发及实际 SMTP 送达仍需按发布环境验收。

## 接手完成清单

- [ ] 接手人能向 GitHub 仓库推送代码。
- [ ] 接手人能查看 Vercel 日志、修改配置和发布生产版本。
- [ ] 已记录具体 Supabase 项目名称、Project URL 和 Dashboard 地址。
- [ ] 接手人能执行 SQL、管理数据库与 `pair-media`。
- [ ] 已私密交接生产环境变量、发件邮箱管理方式和双方收件地址。
- [ ] 已确认套餐、付款和账单通知负责人。
- [ ] 已保留数据库、图片对象和重要未提交草稿。
- [ ] 已在本地运行 `npm run verify`，并完成正式环境验收。
- [ ] 已核对正式域名对应的 Production 部署版本。
