# ClassNode 2.0.0 发布前逻辑审计

日期：2026-10-09。基线：`6c1aeb2bd160d2451cdd3f6c7b72f7fbb3ca9977`，包含另一个 agent 已提交的最新修改。

后续修复状态（2026-10-09）：Phase 1–5 的代码修改与自动化回归已完成，R01–R18 均已实施修复；当前后端 1086/1086、前端逻辑 1523/1523、核心补测 102/102、Rust 4/4 通过。备份/恢复/清零见 [Phase 4](./PHASE4-VERIFICATION-2026-10-09.md)，名册、作答一致性、会话与启动锁见 [Phase 5](./PHASE5-VERIFICATION-2026-10-09.md)。改动已提交并推送 GitHub 验收分支（`cfb39aa`）；Phase 6 已完成本机回归、部分真实 AI 平台联调及 macOS 候选包验证，Windows CI 和目标设备验收仍在进行。下文保留原审计基线的发现与验证数据，最新实施状态见 [修复计划](./RELEASE-FIX-PLAN.md)。

**结论：建议暂缓发布。** 本轮确认 8 项 P1 问题，涉及进程退出、升级数据丢失、恢复/清零一致性、教师权限隔离、备份完整性和名册/通知逻辑；另列 10 项 P2 问题。测试与生产构建通过，并不足以证明这些跨模块流程正确。

本轮是围绕业务流程的深入静态检查、现有测试及针对性临时库复现，比第一轮快速扫描扩大了范围；不声称每行源码、每种设备和第三方平台都已验证，也不是“无缺陷”认证。没有修改业务代码、真实业务数据库、版本号；没有提交、推送、打包发布或删除项目文件。

## 检查覆盖

源码目录盘点包含约 305 个非测试代码文件、206 个测试文件。下表说明实际检查的链路；文件数是盘点数，不代表逐行覆盖率。

| 链路 | 主要检查内容 | 验证方式 |
|---|---|---|
| 最新提交 | 学生移出/彻底删除、填空自动判分收口、学生等待态与保存队列、遥测删除 | 提交 diff、关联调用点、现有测试、真实路由复现 |
| 初始化/教师权限 | 首次密码、会话 cookie、登录/重置、API 权限门、CORS、局域网开关 | 前后端调用与中间件顺序检查 |
| 班级/课堂 | 名册与分组快照、标准/分组/高级创建、加入、暂停/恢复/结束、头像奖励 | Prisma 关系、事务、Socket 与 HTTP 交叉检查、临时库复现 |
| 学习单 | 编辑/关联、学生题面脱敏、保存/提交、自动与 AI 判分、逐题开放、锁定、清除、离线队列、教师看板水合 | 读写授权、状态转换、竞态检查、现有用例、受控并发复现 |
| 绘图/笔迹/照片 | 四种绘图适配、底稿与学生作答分离、快照上传、生命周期、撤销/重做与发布守卫 | 关键状态与清理路径阅读、相关现有测试；未做全设备交互验收 |
| AI/实时会话 | Coze/Coze Agent/智谱/文心代理、共享凭据、流式响应、终止、重复登录、屏蔽词与通知 | 服务实现、错误出口、会话作用域、Socket 事件对应关系 |
| 探究空间/上传 | 压缩包路径限制、独立托管源、SDK/监控、学生上传身份、SVG、孤儿附件清理 | 输入/文件边界、数据引用、CORS 与 iframe 联合检查 |
| 历史/导出/备份 | 对话/学习单报告的数据读取、备份目录、恢复校验/回滚、初始化清零 | 真实 SQLite、真实路由、备份 ZIP 检查 |
| 数据升级/桌面/发布 | 手写 schema 与数据迁移、Tauri 启动顺序/进程管理、源码包、版本同步、打包脚本、CI | 迁移复现、Rust 单测、静态检查、前端生产构建 |

## P1：建议作为发布阻断项

### R01 — 版本检查的备用请求失败会退出整个 Node 服务

位置：[upgrade.ts](/Users/zxc/myprojects/classnode/server/src/routes/upgrade.ts:119)，[服务启动调用](/Users/zxc/myprojects/classnode/server/src/index.ts:816)。

`giteePromise` 与 `githubPromise` 同时创建，只在 Gitee 失败时才等待 GitHub。Gitee 成功后，GitHub 的拒绝没有任何处理器；即使启动调用给外层 promise 挂了 catch，也捕获不到这个独立 promise 的失败。默认 Node 24 会把它视为未处理拒绝而退出进程。普通网络条件“Gitee 可用、GitHub 不可用”即可触发，可能发生在启动后或请求版本检查时。

**已复现：** 在独立 Node 子进程中替换 fetch：Gitee 返回合法 `2.0.0` JSON，GitHub 抛网络错误。外层先成功返回 `hasUpdate:false`，随后进程退出，退出码 1。没有请求真实网络。

修复方向：两个请求从创建时就处理拒绝，明确选择与降级策略；加入上述组合的进程级回归测试。另应避免缓存一次失败的启动 promise 后让本次进程内所有重试持续失败。

### R02 — 桌面升级先删旧列，分组智能体绑定来不及迁移

**修复状态：Phase 3 已完成。** 桌面与源码先在候选库搬迁数据，再严格同步结构；完整升级与失败重试证据见 [Phase 3 验收](./PHASE3-VERIFICATION-2026-10-09.md)。

位置：[Tauri schema 同步](/Users/zxc/myprojects/classnode/src-tauri/src/lib.rs:340)，[自动接受数据损失](/Users/zxc/myprojects/classnode/src-tauri/src/lib.rs:352)，[材料迁移](/Users/zxc/myprojects/classnode/server/src/services/group-materials-migration.ts:49)。

桌面壳启动 Node 前对最新 schema 执行 db push，遇到数据损失提示后自动带 `--accept-data-loss` 重试。旧 `ClassroomGroup.agentId` 先被删除，Node 后续 `ensureGroupMaterials` 发现列不存在，写入 `skipped`。历史高级课堂的小组智能体绑定没有转成材料行。升级安全备份存在，但不会自动还原这些绑定；判断“出现数据损失提示”也不能证明被删内容已安全迁移。

**已复现：** 临时真库建立旧 agentId 与组绑定，清空材料表，执行桌面升级顺序，迁移结果 `skipped`，agent 材料数 0。

修复方向：先读取/迁移旧数据，再执行破坏性 schema 对齐；覆盖真实旧版本到新版本的完整升级顺序，而不只测试单个迁移函数。

### R03 — 初始化清零返回成功，却留下学习单答案和外键孤儿

**修复状态：Phase 4 已完成并通过回归。** 以下为原基线发现；当前行为和边界见 [Phase 4 验收记录](./PHASE4-VERIFICATION-2026-10-09.md)。

位置：[reset](/Users/zxc/myprojects/classnode/server/src/routes/export.ts:864)。

清零先关闭外键，按固定旧表清单 DELETE。新增的 Worksheet、WorksheetResponse、WorksheetAnswer、ClassroomWorksheet、ClassroomModule、ClassroomGroupMember、ClassroomGroupMaterial、Webapp、WebappUsage、TeacherNotification、PlatformToken 等没有完整处理。由于外键已关闭，删除 Classroom/Student 不会替这些表级联清理。结果既残留学生作答/通知/凭据等内容，也产生失去课堂或参与者的关联。文件清单还漏了独立 webapps 目录。中途异常时没有 finally 恢复外键，且没有整体事务。

**已复现：** 调用真实 reset 路由返回 200/success；随后学习单、response、answer、课堂学习单关联均各残留 1 行，`PRAGMA foreign_key_check` 报 WorksheetResponse、ClassroomWorksheet、TeacherNotification 的孤儿外键。

修复方向：定义清零保留范围，按当前 schema 在事务内处理全部业务表；保证错误时外键恢复，清理所有对应资产，并终止/刷新活动 Socket、内存缓存和会话。验证成功后数据与界面均符合清零承诺。

### R04 — 恢复失败只回滚数据库，原加密密钥和附件不能回滚

**修复状态：Phase 4 已完成并通过回归。** 以下为原基线发现；当前行为和边界见 [Phase 4 验收记录](./PHASE4-VERIFICATION-2026-10-09.md)。

位置：[覆盖附件/密钥](/Users/zxc/myprojects/classnode/server/src/routes/export.ts:632)，[密钥重载](/Users/zxc/myprojects/classnode/server/src/routes/export.ts:653)，[失败回滚](/Users/zxc/myprojects/classnode/server/src/routes/export.ts:698)。

恢复期间先覆盖当前数据库、附件和 `.encryption.key`，然后校验密钥/同步结构。失败处理仅把旧数据库复制回来。密钥一旦被覆盖，旧数据库中原来可解密的 API Key 就不能使用；同名附件也可能已经被替换。接口返回“恢复失败、数据库已回滚”时，系统仍处在混合状态。

**已复现：** 原环境先加密一个 secret；恢复包包含合法 SQLite 和无效密钥。接口返回 500，原 Class 数据成功回滚，但 decrypt 原 secret 报“本地加密密钥文件格式无效”。全部在临时数据目录中完成。

修复方向：在独立目录验证完整候选数据库、密钥、附件、网页及迁移；对所有需替换的资产保留回滚版本，成功后统一切换。不能只给数据库做安全快照。

### R05 — 独立端口的教学网页仍能借教师 cookie 访问教师 API

**修复状态：Phase 2 已完成并通过回归。** 下面保留原基线发现；当前行为与验收见 [Phase 2 验收记录](./PHASE2-VERIFICATION-2026-10-09.md)。

位置：[CORS](/Users/zxc/myprojects/classnode/server/src/index.ts:101)，[cookie](/Users/zxc/myprojects/classnode/server/src/middleware/auth.ts:22)，[iframe sandbox](/Users/zxc/myprojects/classnode/src/lib/webapp-sandbox.ts:11)。

网页使用同主机不同端口，iframe 允许脚本并保留自己的 origin。cookie 不按端口隔离；SameSite=Strict 也不把同主机不同端口隔成不同 site。主 API 反射任意 Origin 并允许 credentials。因此教师登录后预览的 HTML 可以带凭据 fetch 教师 API，读取或修改数据。HttpOnly 不能阻止浏览器携带 cookie。不同端口隔离 DOM 的效果，不能代替 API 权限边界。

**证据级别：静态访问链确认，未执行浏览器攻击演示。** 前提是教师在登录的同主机浏览器中打开含相关脚本的网页。

修复方向：明确主前端 origin 允许列表，拒绝托管网页对教师 API 的凭据访问；写操作验证来源。若保留脚本网页能力，还需明确其网络与教师权限隔离策略。

### R06 — “含附件”备份漏掉独立教学网页目录

**修复状态：Phase 4 已完成并通过回归。** 以下为原基线发现；当前行为和边界见 [Phase 4 验收记录](./PHASE4-VERIFICATION-2026-10-09.md)。

位置：[备份资产清单](/Users/zxc/myprojects/classnode/server/src/routes/export.ts:471)，[恢复清单](/Users/zxc/myprojects/classnode/server/src/routes/export.ts:632)，[webapps 存储根](/Users/zxc/myprojects/classnode/server/src/services/webapp-host.ts:65)。

备份只包含数据库、chat/avatars/logos 与密钥，没有独立 `webapps/`；恢复同样不处理。换设备后，网页记录和课堂关联都在，HTML/JS/CSS 等实际文件不在，探究空间无法打开。

**已复现：** 临时数据目录创建 `webapps/demo/index.html`，真实 `/backup` 返回 200，ZIP 中只有 `data.db`（该环境没有其他资产），没有 webapps 文件。

修复方向：将网页资产纳入版本化备份格式、恢复与回滚，做跨空目录迁移后实际访问入口的回归。

### R07 — 移出班级的学生仍被带入后续分组课堂

**修复状态：Phase 5 代码修改与自动化回归已完成。** 以下保留原基线发现；当前行为、覆盖及真实环境待验项见 [Phase 5 验收记录](./PHASE5-VERIFICATION-2026-10-09.md)。

位置：[remove](/Users/zxc/myprojects/classnode/server/src/routes/classes.ts:252)，[分组创建](/Users/zxc/myprojects/classnode/server/src/routes/classroom.ts:480)，[高级创建](/Users/zxc/myprojects/classnode/server/src/routes/classroom.ts:663)。

最新提交把 Student.classId 置 null 来保留历史，方向正确，但没有清理 ClassGroup.studentIds。两处新建课堂都只按其中的 ID 查 Student，不限制其仍属于当前班级。移出学生因为基础记录仍在，就继续进入后续课堂成员快照；分组计数也保留其 ID。

**已复现：** 真实 remove 返回 200，新建分组课堂返回 200，已移出学生对应 ClassroomGroupMember 数量仍为 1。

修复方向：事务内同步清理所属班级的分组名册；创建快照再次校验 classId；保留已经创建的课堂历史。

### R08 — 学生可读取其他参与者或小组的定向通知

**修复状态：Phase 2 已完成并通过回归。** 下面保留原基线发现；当前行为与验收见 [Phase 2 验收记录](./PHASE2-VERIFICATION-2026-10-09.md)。

位置：[学生权限门](/Users/zxc/myprojects/classnode/server/src/index.ts:730)，[通知查询](/Users/zxc/myprojects/classnode/server/src/routes/classroom.ts:1817)。

学生 token 省略 studentId 查询参数仍被权限门放行；路由只有参数存在时才添加接收人过滤，因此会返回最近 100 条其他人的定向通知。另有 groupId 通知的 studentId 为 null，当前 OR 条件将它们与真正的全班广播混在一起，未限制本组范围。

**已复现查询行为：** 种入 `studentId=other-participant` 的私信，省略筛选时真实通知路由返回该消息。外层放行条件另外通过当前中间件源码确认；探针没有启动完整生产入口。

修复方向：学生查询始终从已验证 token/参与者查出允许的本人及组范围；全班广播应同时满足 studentId 与 groupId 均为空。教师读取全部通知单独处理。

## P2：发布前建议处理或明确接受的逻辑问题

### R09 — 已结束/暂停课堂仍接受学习单写入

**修复状态：Phase 5 代码修改与自动化回归已完成。** 以下保留原基线发现；当前行为、覆盖及真实环境待验项见 [Phase 5 验收记录](./PHASE5-VERIFICATION-2026-10-09.md)。

位置：[requireOwnWorksheet](/Users/zxc/myprojects/classnode/server/src/routes/worksheets.ts:1971)，[保存](/Users/zxc/myprojects/classnode/server/src/routes/worksheets.ts:2574)，[提交](/Users/zxc/myprojects/classnode/server/src/routes/worksheets.ts:2740)。

上下文只检查身份、材料归属、锁定/逐题开放，没有课堂 status 或 blacklisted。课堂结束不使现有 token 立即失效，保存和提交也不拒绝 ended。离开面板时队列 flush 可能把结束后的迟到作答写回历史。暂停状态同样仅由界面挡住。

**已复现 ended 保存：** 临时课堂设为 ended，持有效 token 的 PUT 返回 200/draft 并落库。提交及 paused/blacklisted 分支来自静态检查，未逐个动态复现。

修复方向：写路径统一校验课堂/参与者状态；若需要结束前排空队列，应明确收卷协议和截止时刻，避免历史数据无限接受旧会话写入。

### R10 — 小组作答清除只通知教师，不通知小组设备

**修复状态：Phase 5 代码修改与自动化回归已完成。** 以下保留原基线发现；当前行为、覆盖及真实环境待验项见 [Phase 5 验收记录](./PHASE5-VERIFICATION-2026-10-09.md)。

位置：[broadcastAnswersCleared](/Users/zxc/myprojects/classnode/server/src/routes/worksheets.ts:929)。

清除按真实 Student.id 发 student room；组参与者的 studentId 为 null，代码明确跳过学生侧广播。组设备仍保留旧画面和待保存项，继续操作会把旧作答存回。

**已复现：** null studentId 的组参与者删除答案返回 200，捕获的清除事件仅发往 teacher room。学生 hook 清队列依赖该事件。

修复方向：向实际课堂参与者连接/房间定向发送，而不是要求参与者必须关联真实学生。

### R11 — 在途保存能把教师刚清除的单题答案写回来

**修复状态：Phase 5 代码修改与自动化回归已完成。** 以下保留原基线发现；当前行为、覆盖及真实环境待验项见 [Phase 5 验收记录](./PHASE5-VERIFICATION-2026-10-09.md)。

位置：[答案 upsert](/Users/zxc/myprojects/classnode/server/src/routes/worksheets.ts:2682)，[清除](/Users/zxc/myprojects/classnode/server/src/routes/worksheets.ts:997)，[学生清队列](/Users/zxc/myprojects/classnode/src/app/classroom/worksheet/use-worksheet-answers.ts:399)。

清除事件只丢待发送队列，没有使已在途 PUT 失效。服务端 DELETE 与 PUT 也没有清除代际/条件写入机制。已通过校验的保存可以晚于清除完成，再 upsert 同一题。

**受控并发复现：** 实际 Prisma upsert 前暂停一次 PUT；DELETE 单题返回 removed=1；释放 PUT 后保存返回 200，答案行重新变为 1。未修改路由源码。

修复方向：定义清除版本/作答代际并在写入时验证；客户端丢弃旧代际响应。只清 debounce timer 不足以解决服务器上的在途写入。

### R12 — 局域网开关没有覆盖所有 HTTP 服务

**修复状态：Phase 2 已完成并通过回归。** 下面保留原基线发现；当前行为与验收见 [Phase 2 验收记录](./PHASE2-VERIFICATION-2026-10-09.md)。

位置：[uploads 静态路由](/Users/zxc/myprojects/classnode/server/src/index.ts:119)，[访问门](/Users/zxc/myprojects/classnode/server/src/index.ts:140)，[托管启动参数](/Users/zxc/myprojects/classnode/server/src/index.ts:828)，[托管访问门](/Users/zxc/myprojects/classnode/server/src/services/webapp-host.ts:235)。

uploads 在局域网门之前注册，命中后直接返回文件。独立网页服务拿的是启动时的布尔值，设置更新只改主 app，不会同步它：启动时开放，后来关闭，网页仍可访问；启动时关闭，后来开放，网页仍被拒。

**静态控制流确认。** 修复方向：所有服务共享可实时读取的访问策略，静态文件也经过它；验证开→关→开及已有连接/新请求。

### R13 — 托盘启动绕过启动状态锁，可产生并发子进程

**修复状态：Phase 5 代码修改与自动化回归已完成。** 以下保留原基线发现；当前行为、覆盖及真实环境待验项见 [Phase 5 验收记录](./PHASE5-VERIFICATION-2026-10-09.md)。

位置：[托盘入口](/Users/zxc/myprojects/classnode/src-tauri/src/lib.rs:623)，[命令入口](/Users/zxc/myprojects/classnode/src-tauri/src/lib.rs:487)，[spawn_server](/Users/zxc/myprojects/classnode/src-tauri/src/lib.rs:262)。

命令入口维护 IS_STARTING，托盘直接调用 spawn_server；自动启动期间托盘仍可能触发。端口尚未监听时两次启动可能各建一个 child，再覆盖管理句柄。命令入口本身 load/store 也不是原子的占锁操作。

**静态并发路径确认，未进行桌面 UI 并发演示。** 修复方向：所有入口使用 compare_exchange 或互斥的单一启动函数，失败时回收 child 并准确维护状态。

### R14 — SVG 危险 URL 可以用实体编码绕过校验

**修复状态：Phase 2 已完成并通过回归。** 下面保留原基线发现；当前行为与验收见 [Phase 2 验收记录](./PHASE2-VERIFICATION-2026-10-09.md)。

位置：[sanitizeSvg](/Users/zxc/myprojects/classnode/server/src/services/upload-security.ts:36)，[学生自定义头像](/Users/zxc/myprojects/classnode/server/src/routes/avatars.ts:363)。

校验用正则检查原始文本，未按 SVG/HTML 解析后的属性值验证协议。`java&#x73;cript:alert(1)` 未命中 javascript 正则，而浏览器解析时会解码。多个教师页面将 SVG 内联渲染，给危险属性执行创造了条件。

**已复现校验绕过：** sanitizeSvg 接受含该 href 的 SVG。点击执行效果未在浏览器复现；此示例需点击链接，不宣称加载即执行。

修复方向：解析后做元素/属性/协议白名单，或以图片方式展示不可信头像，覆盖编码与命名空间变体。

### R15 — 恢复旧备份仅同步 schema，没有运行完整数据迁移

**修复状态：Phase 4 已完成并通过回归。** 以下为原基线发现；当前行为和边界见 [Phase 4 验收记录](./PHASE4-VERIFICATION-2026-10-09.md)。

**实施状态：Phase 3 已提供共用完整迁移入口；恢复流程尚未接线，问题继续留在 Phase 4。**

位置：[恢复后同步](/Users/zxc/myprojects/classnode/server/src/routes/export.ts:670)，[启动迁移入口](/Users/zxc/myprojects/classnode/server/src/index.ts:659)。

恢复完成前只 db push + connect，没有复用学习单任务/题干/分值、参与者、材料等数据升级。恢复成功不等于旧数据能按当前结构正确解释。若 db push 先删除迁移依赖旧列，还会重现 R02 的根本问题。

**静态迁移入口对照确认，未覆盖每一历史版本备份。** 修复方向：恢复与升级共用有顺序、有版本、有回滚的迁移流程，并在宣告成功前完成。

### R16 — 姓名被当作正则表达式，特殊字符可让 AI 请求失败

**修复状态：Phase 5 代码修改与自动化回归已完成。** 以下保留原基线发现；当前行为、覆盖及真实环境待验项见 [Phase 5 验收记录](./PHASE5-VERIFICATION-2026-10-09.md)。

位置：[anonymizeMessage](/Users/zxc/myprojects/classnode/server/src/services/anonymizer.ts:46)，[代理调用](/Users/zxc/myprojects/classnode/server/src/services/ai-proxy.ts:120)。

真实姓名/组名直接传给 `new RegExp(realName,'g')`。包含 `[` 等字符会抛错；`.`、`*` 等会改变替换范围。代理的脱敏动作还在 try 外。名册输入只 trim，没有约束为正则安全文本。

**已复现：** `anonymizeMessage('hello','[')` 抛 Unterminated character class。修复方向：按字面字符串替换，或严格转义；同时确保错误出口清理学生/教师等待态。

### R17 — 重复登录服务端事件与学生端处理事件不一致

**修复状态：Phase 5 代码修改与自动化回归已完成。** 以下保留原基线发现；当前行为、覆盖及真实环境待验项见 [Phase 5 验收记录](./PHASE5-VERIFICATION-2026-10-09.md)。

位置：[踢旧连接](/Users/zxc/myprojects/classnode/server/src/socket/index.ts:1128)，[客户端冲突处理](/Users/zxc/myprojects/classnode/src/app/classroom/chat/use-chat-socket.ts:248)。

服务端发 ai-error 后 `disconnect(true)`，客户端回身份页的专用逻辑却监听 identity-conflict，服务端没有发这个事件。旧设备只进入离线状态，无法自动重连，并继续保留旧 REST token 与身份。

**静态事件对应检查。** 修复方向：统一事件协议，旧会话明确清理身份/作答上下文；如确实禁止多设备，应同时定义 HTTP 会话的撤销策略。

### R18 — 同一学生并发发消息时，流式终止与轮次可能失配

**修复状态：Phase 5 代码修改与自动化回归已完成。** 以下保留原基线发现；当前行为、覆盖及真实环境待验项见 [Phase 5 验收记录](./PHASE5-VERIFICATION-2026-10-09.md)。

位置：[send-message](/Users/zxc/myprojects/classnode/server/src/socket/index.ts:1714)，[轮次计算](/Users/zxc/myprojects/classnode/server/src/socket/index.ts:1932)，[保存流控制器](/Users/zxc/myprojects/classnode/server/src/socket/index.ts:1994)，[finally 清理](/Users/zxc/myprojects/classnode/server/src/socket/index.ts:2173)。

服务端没有“该参与者已有请求”的互斥，activeStreams 仅按 socket.id 存一个 controller。第二次发送覆盖第一次 controller；先结束的请求 finally 又会删除另一个仍运行请求的记录。停止/结束课堂可能只终止其中一个或找不到剩余请求；轮次的 count+1 也不是原子的。普通 UI 有发送守卫，但服务器仍应保证自身状态一致。

**静态并发路径确认，未连接真实 AI 平台进行并发压力测试。** 修复方向：参与者级互斥或请求 ID，条件删除自己那次 controller，计数/上下文顺序与消息请求一致。

## 本机部署状态与额外待验证点

- **当前开发数据库尚未适配最新 Student.classId 可空性。** 只读 PRAGMA 显示 `server/prisma/dev.db` 中 classId.notnull=1；remove 写 null 会失败。最新提交已要求手动 db push，但当前库仍未完成。启动补列逻辑不修改已有列可空性。请在解决 R02 的安全迁移顺序后，为源码部署提供可靠迁移步骤；本次没有直接改真实库。
- 学生身份确认的 localStorage 写入未捕获错误（`use-classroom-session.ts:214`）；受限存储环境可能中断后续 Socket 初始化。尚未做受限浏览器动态复现。
- Coze Agent 的 session_id 仅基于全局匿名姓名，跨班同名/同组名会得到相同标识。是否混入历史上下文需结合实际部署平台的 session 语义验证；本次不将未核实的外部行为记作已确认泄露。
- 新的捕获失败回放遍历 captureBlocked 时缺少 classroom 前缀过滤（`socket/index.ts:1615`），与 frames/presence 的处理不一致，可能在教师切换课堂时回放别课堂的失败标记。尚未进行跨课堂 UI 复现。
- CI 构建流程不能替代测试与升级/恢复验收；656 条 lint 警告需要后续按功能清理，不能据警告数量推断缺陷数量。

## 验证结果

| 项目 | 结果 | 解释 |
|---|---|---|
| 前端原样测试 | 1521 通过，0 失败 | 当前测试集合 |
| 前端 TypeScript | 通过 | `pnpm exec tsc --noEmit` |
| 服务端 TypeScript | 通过 | 服务端测试入口先执行 tsc |
| 服务端原样测试 | 737/987 通过，250 失败 | 失败发生于 Prisma 创建临时库阶段，不能记成全绿，也不能直接认定业务回归 |
| 服务端临时库预建辅助后 | 978/987 通过；剩余 9 条独立复跑 9/9 | 两种临时路径前缀需要预建空 SQLite 文件；全部业务用例在该条件下通过，不代表原样入口已修复 |
| Next 生产构建 | 通过 | 使用 `pnpm exec next build`，避免 prebuild 自动版本同步；开发服务确认已停止 |
| 学生端兼容门 | 通过 | 扫描构建 46 个脚本、源码 204 个文件；既有 docx lookbehind 容忍项仍有显式提示，并非真机验证 |
| ESLint | 0 错误、656 警告 | 命令正常完成；警告未逐条消除 |
| Rust 单测 | 3/3 通过 | `cargo test --offline --manifest-path src-tauri/Cargo.toml --lib` |
| 定向复现 | 见 R01–R04、R06–R11、R14、R16 | 动态证据与静态推断在各条中分别注明 |

Prisma 临时库问题在退出沙箱及改变 TMPDIR 后仍复现，预建空文件后可通过；仓库打包脚本已有同类平台规避注释。本轮辅助脚本仅在 `/private/tmp`，没有改项目测试代码。

## 复现证据索引

探针全部使用新建临时 SQLite/数据目录，结束后清除这些专用临时数据；不涉及用户提出的项目文件清理。

- `/private/tmp/classnode-audit-repro.mjs`：R02、R07 的真实数据库/路由复现。
- `/private/tmp/classnode-release-probes.mjs` 与对应 `.log`：R03、R04、R06、R08 查询行为、R09、R10、R11；其中 R11 在 Prisma upsert 处人为设置调度屏障以稳定展示合法并发顺序。
- `/private/tmp/classnode-release-upgrade-probe.mjs` 与对应 `.log`：R01 的独立进程退出，使用模拟 fetch，不依赖公网可达性。
- `/private/tmp/classnode-release-build.log`、`classnode-release-lint.log`、`classnode-release-rust-tests.log`：构建及检查输出。
- `/private/tmp/classnode-audit-server-precreated.log`、`classnode-audit-schema-final.log`：服务端辅助环境复跑证据。

临时路径可能被系统清理；主要触发条件、观察结果和修复要求已保存在本文。

## 发布前建议验收顺序

1. 修复 R01，验证 Gitee/GitHub 的双成功、单成功、双失败均不退出服务，失败后可重试。
2. 建立安全升级/恢复流水线，处理 R02、R04、R06、R15 与 classId 可空性；用真实旧版库验证智能体绑定、历史作答、密钥和网页均保留。
3. 修复清零 R03，验证全部业务表/文件/缓存的保留与删除范围，以及异常回滚。
4. 修复权限与隐私 R05、R08、R12、R14；从托管 HTML、其他学生、其他小组与局域网客户端分别验收。
5. 修复名册 R07，以及课堂结束、清除/保存竞态、小组广播、重复登录与并发请求；覆盖状态转换和迟到请求。
6. 修复原样测试临时库入口后重跑测试和生产构建；在最终安装包上做首次安装、旧版升级、备份跨设备恢复、服务启停与课堂端到端验收。

**尚未执行：** 修复后的回归、真实 AI 平台联调、Windows/macOS 安装包整套验收、多种 iPad/Safari/触摸设备人工走查、依赖漏洞数据库扫描。这些边界不能由当前的构建/单测结果替代。
