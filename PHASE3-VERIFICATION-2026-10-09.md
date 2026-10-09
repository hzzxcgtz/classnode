# Phase 3 旧版本升级与数据库迁移验收

日期：2026-10-09。Git 基线仍为 `6c1aeb2bd160d2451cdd3f6c7b72f7fbb3ca9977`；三个阶段的工作区修改均未提交。本阶段完成 R02、Student.classId 旧库可空迁移，以及 R15 所需的共用迁移入口。备份恢复路由的接线属于 Phase 4，R15 尚未关闭。

## 升级契约

源码服务在注册路由、清理上传资产和开始监听之前执行 `upgradeDatabase`。桌面端先运行 `dist/upgrade-database.js`，该命令使用同一函数；失败时桌面端不启动课堂服务。新增 `pnpm --filter classnode-server db:upgrade` 命令，需先构建服务端。

1. 校验传入路径与 Prisma 实际连接的 SQLite 文件一致，取得升级锁。
2. 通过 SQLite `VACUUM INTO` 创建一致的升级前快照，包含已提交 WAL 数据；无法备份即停止。
3. 在原库同卷的独立候选库中补充必要结构、执行原有数据迁移。参与者迁移保留稳定 ID，再将旧 `ClassroomGroup.agentId` 搬入按组材料；高级课堂的旧网页关联同时实体化。
4. 明确重建旧 `Student.classId NOT NULL` 约束，保留原有列、记录、索引与触发器。兼容 SQLite 原始查询中的 bigint 约束标志，也修正了参与者迁移的同类判断。
5. 最后在候选库执行严格 `db push --skip-generate`，不使用 `--accept-data-loss`。未知非空旧字段等数据丢失提示使升级停止，不能推定为“已知安全清理”。打包空数据库的初始化也移除了强制接受数据丢失参数。
6. 候选库通过完整性、外键以及原有业务记录 ID 保留校验后，写入包含 schema 和迁移代码指纹的完成标记，关闭连接并替换原库。原库在候选处理期间发生变化或存在活动 WAL 时取消替换。

旧 `.schema-version` 不再决定是否跳过数据迁移。新完成标记只在成功候选库中写入；失败候选的标记不会进入原库。再次运行会检查新指纹及关键旧约束，成功升级后的重复运行不再创建备份或修改学习单。原有填空“只迁移一次”的标记继续保留。

## 真实旧结构与故障验证

新增 12 个服务端回归用例：

- 旧 NOT NULL Student、无 type 的课堂参与者和旧组 agentId 的真实 SQLite 结构；保留组智能体/网页材料、成员快照、参与者 ID、消息、通知、Interaction、学习单和答案。
- 升级后移出学生，保留其参与记录；第二次运行不改变答案或标记。
- Git 发布标签 **v1.5.1** 的原始 schema（`f4bc3e04e870ce62ebb870651b1a064574978704`），未改动 fixture schema；从无学习单/网页表的旧库升级，保留组绑定及旧消息，旧通知转为参与者 ID，重复运行正常。
- 数据迁移之后抛异常：原库旧字段、内容和完成标记不变，重试成功。
- 候选库出现外键错误，或者删掉历史消息但外键仍合法：均拒绝替换原库。
- 未知非空旧字段：严格 schema 同步拒绝，原字段及内容保留。
- 升级期间原库并发写入：取消替换，保留该写入。
- SQLite WAL 内已提交消息：独立备份及升级后库均包含该消息。
- 子进程在迁移后直接退出 42：原库未修改；确认锁属主已退出后可重试。活跃属主的锁保留，不被抢占。
- 路径与真实 Prisma 连接不一致：拒绝升级。
- 桌面使用的 CLI 真正完成旧库升级；源码 Node 服务真正启动，健康检查可用且数据库已升级。源码启动测试明确禁用外网请求，版本检查失败不会影响启动。

Rust 另外验证共用命令的实际 Node 子进程执行、含空格路径、数据库/数据目录环境传递和失败退出码；保留原有 Windows 路径处理用例。尚未运行打包后的桌面 GUI 升级，安装包及跨平台运行验收仍属于 Phase 6。

## 最终结果与证据

- 原样 `pnpm test:server`：**1065/1065**，0 失败、0 跳过；包括新增 12 项迁移验收和前两阶段的回归。
- 服务端 TypeScript 构建通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --offline --lib`：**3/3**，Rust 编译通过。
- 修改文件的定向 ESLint：0 错误、0 警告；`git diff --check` 通过。
- 本阶段未修改前端页面，未重复生成前端或安装包。

完整服务端日志：`/private/tmp/classnode-phase3-server-complete.log`。
Rust 日志：`/private/tmp/classnode-phase3-rust-final.log`。
Lint 日志：`/private/tmp/classnode-phase3-lint.log`。
较早的单独迁移日志：`/private/tmp/classnode-phase3-upgrade.log`（11 项，新增记录 ID 丢失测试在最终完整入口中验证）。

全量运行中处理了两项测试夹具干扰，未放宽业务断言：

- `request-security.test.ts` 的无关中文/emoji 启动横幅干扰 Node 24.18.1 测试 IPC；定向组合运行正常，全量运行出现反序列化错误。本地 Node 内置源码仍使用有符号消息长度计算，现象与 [Node 已知问题](https://github.com/nodejs/node/issues/65934) 一致。仅在该 LAN 测试内 mock console.log，保留生产日志和全部 HTTP/Socket 断言；之后全量入口通过。
- `analysis-run-endpoint.test.ts` 在同一临时库中从 90 个随机互动码生成多间课堂，出现真实唯一键冲突。测试只按课堂 ID 访问，改为允许的 null code，避免随机碰撞；全部原断言保留。

早期失败证据仍保存在 `classnode-phase3-server.log`、`classnode-phase3-server-final.log`。没有更新系统 Node 或忽略失败用例。

## 使用与恢复边界

日常启动自动执行升级；也可在服务停止后、服务端构建完成后，使用配置好的数据库地址运行 `pnpm --filter classnode-server db:upgrade`。全新空库仍通过既有初始化流程创建，不能将空文件当成可升级旧库。

升级失败时错误会给出升级前快照路径，原库未切换。先停止其他服务或修复具体错误，再重新启动；不要改用 `--accept-data-loss` 绕过拒绝。未知旧字段需先确认其用途并补充明确迁移。升级锁无法解析或属主仍活跃时，应先确认相关进程状态；不要在服务运行中替换数据库。

这里的升级前快照是 SQLite 数据库恢复依据，不是含密钥、附件及网页资产的完整产品备份。完整备份、恢复切换/回滚及初始化清零按 Phase 4 实施。旧版此前已经删除、且没有对应备份的组绑定无法凭新 schema 自动重建。

本阶段没有升级真实业务库，没有清理项目文件、提交、推送、改版本号或发布。剩余发布风险继续按 Phase 4–6 实施。
