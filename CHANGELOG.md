# ClassNode 更新日志

## v1.6.0 (2026-07-12)

### 🔒 安全增强

- **新增教师认证中间件** (`middleware/auth.ts`)
  - 敏感 API 路由（agents、classes、classroom、export、shield、avatars）强制教师鉴权
  - 基于服务端会话管理，替代前端 localStorage 验证
  - 新增会话创建、销毁、刷新接口
- **新增学生会话中间件** (`middleware/student-auth.ts`)
  - 学生身份基于临时令牌（JWT 风格，2小时过期）验证
  - 课堂学生 API 支持学生自主访问白名单
- **密码存储升级**
  - 从 SHA256 升级为 scrypt 哈希（`services/password-security.ts`）
  - 登录频次限制（5次失败后临时封禁）、暴力破解防护
  - 管理密码最低长度从 6 位提升至 **8 位**
- **上传安全检测** (`services/upload-security.ts`)
  - 文件魔数验证（`detectSafeImage`），防止伪装文件上传
  - SVG 文件 XSS 清理（`sanitizeSvg`），移除 script、onload 等危险内容
  - ZIP 安全解压（路径穿越防护、最大文件数/总大小限制）
- **代理密钥保护策略** (`services/agent-secret-policy.ts`)
  - 更新时不覆盖已加密的 API 密钥
- **CORS 配置强化**
  - 启用 `credentials: true`，移除通配符 origin
- **新增安全响应头**
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: no-referrer`
- **Logo 上传安全**
  - 文件名使用随机 UUID 替代时间戳 + 原扩展名，规避路径遍历风险
- **数据库升级安全**
  - Tauri 桌面端升级前自动创建安全备份快照到 `backups/` 目录
  - 升级失败返回具体错误信息，不回退静默忽略

### ♻️ 代理配置重构

- 将 800+ 行的 `agents/page.tsx` 拆分为 **12 个独立组件和自定义 Hook**
- **新组件：**
  - `agent-card.tsx` — 代理卡片展示（状态、Logo、名称、平台）
  - `credentials-fields.tsx` — 凭据表单字段（Bot ID、API Key、API URL）
  - `platform-selector.tsx` — 平台选择器（Coze / Dify / OpenAI）
  - `logo-field.tsx` — Logo 上传组件（预览、上传、清除）
  - `help-button.tsx` — 平台帮助按钮
  - `agent-overlays.tsx` — 删除确认弹窗、错误提示浮层
- **新 Hook：**
  - `use-agent-controller.ts` — 代理列表加载、启用/禁用、删除、连通性测试
  - `use-agent-form-fields.ts` — 表单字段状态管理（展示字段、折叠状态）
  - `use-agent-form-actions.ts` — 表单提交、更新、校验逻辑
  - `use-agent-logo.ts` — Logo 上传逻辑封装
- **新常量：** `agent-platforms.ts` — 平台配置常量
- **新类型：** `src/lib/types.ts` — `AgentSummary` 等类型定义

### 🌐 学生端（Classroom）会话升级

- 学生登录采用 **临时令牌认证**，页面刷新自动静默续领令牌
- 学生端 API 调用自动携带认证令牌（`Authorization: Bearer <token>`）
- 本地会话持久化存储令牌，支持应用重启后恢复
- **Typed Socket Events** (`socket-events.ts`)
  - `ServerToClientEvents` / `ClientToServerEvents` 类型定义
  - Socket.IO 连接启用 `withCredentials`
- 头像系统 API 增加令牌鉴权
- 学生退出课堂时自动销毁服务端会话令牌

### 🔄 教室功能增强

- 创建教室参数校验强化（模式、班级、智能体有效性检测）
- 分组模式一次只能选择一个班级
- 分组模式采用 **Prisma 事务** 创建，组学生支持幂等创建
- 新增 `POST /api/classroom/code/:code/student-session` 无感登录端点
- 教室路由增加公开访问白名单机制
- 引入 `classroom-state.ts` 来源状态常量

### 📋 导出与设置重构

- **导出功能增强：**
  - 数据库恢复前自动创建安全快照，支持还原回滚
  - 新版 `.classbak` 备份文件恢复增加安全限制
  - 导入数据库时验证表结构和完整性
- **设置路由重构：**
  - 新增 `GET /api/settings/init-status` 初始化状态检测
  - 新增登录失败频率限制（`loginAttempts` Map）
  - 会话管理支持多端登录、会话吊销
  - 管理密码首次设置与修改功能分离
  - CORS 与安全增强同步

### 🖥️ 桌面端（Tauri）增强

- 数据库升级前自动备份到 `backups/` 目录（附带 `.meta` 元数据文件）
- 升级失败时返回具体错误信息，不再静默忽略
- **移除 `--accept-data-loss` 标志**，拒绝非安全升级
- 使用 `SystemTime` 时间戳命名备份文件

### 🎨 前端界面优化

- **About 页面** 全新视觉设计
  - `SectionCard` 卡片组件（渐变色、圆角、阴影）
  - 产品故事、技术优势重新编排
  - 优化移动端响应式布局
- **Layout 侧边栏**
  - 会话管理改为服务端验证，移除 localStorage 鉴权逻辑
  - 顶部栏、导航结构优化
- **屏蔽词管理** (`shield/page.tsx`)
  - CSV 导入、批量删除操作优化
  - 分页与统计信息改进
- **班级管理** (`classes/page.tsx`)
  - 批量删除、分组管理交互优化
- **教室板** (`classroom/page.tsx`)
  - 分组模式显示、代理状态展示优化
  - Socket 连接稳定性改进
- **聊天界面** (`app/classroom/page.tsx`)
  - 学生端导出 Word 文档功能增强
  - 通知同步与身份冲突处理优化
- **头像管理** (`avatars/page.tsx`)
  - 学生令牌管理、头像分配改进
- **学生端 Portal** (`app/classroom/page.tsx`)
  - 身份选择后自动领取会话令牌
  - 刷新后自动续签令牌（静默、无感）
  - 头像自定义增强
- **教师主页** (`teacher/page.tsx`)
  - 快速入门引导优化

### ✅ 测试

- 新增 `server/src/tests/` 测试目录
- `agent-secret-policy.test.ts` — 代理密钥保护策略测试
- `upload-security.test.ts` — 上传安全检测测试（魔数验证、SVG 清理、ZIP 解压）
- `classroom-state.test.ts` — 教室状态常量测试
- `security.test.ts` — 综合安全性测试

### 📝 文档

- 新增 `AGENTS.md` — 项目说明文档

---

## 历史版本

### v1.5.4 (2026-06-30)

- 版本检测源改为 Gitee 主 + GitHub 备选，并行请求
- 移除所有 Linux 部署代码（install.sh、PM2、start.js）
- 代码推送自动同步 GitHub + Gitee

### v1.5.3 (2026-06-28)

- Linux PM2 一键部署

### v1.5.2 (2026-06-27)

- 升级检测优先走 GitHub raw（避免 jsDelivr CDN 返回过期版本）
- 修复 Rust 编译错误 `_pid` → `pid`
- 进程组 kill 信号引用变量名不匹配修复
