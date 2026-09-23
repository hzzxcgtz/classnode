# 改名：探究助手 → **探究空间**

**分支**：`fix/webapp-material-authority`（用户裁定「改到当前分支」）
**用户原话**：「三件套的名字，我要最终再确定一下，需要你按照我的要求进行全面的修改：**学习单、探究空间、智能学伴**」

---

## 一、要改什么

把三件套里的第二件从「探究助手」改成「**探究空间**」，**全面**改。
另两件不变（学习单、智能学伴）。

**背景**：09-19 设计文档 §3 原本专门论证过「为什么选『探究助手』而不是『探究空间』」
（理由是「教师口头表述『打开探究助手』更顺」）。**用户现在推翻了这个决定**。
那段论证要改写成「记录这次反转」，不是删掉 —— 这个项目的文档保留决策痕迹。

---

## 二、🔴 硬边界：这些**绝不能改**

只改**用户看得见的文字**与**注释/日志/文档里的行文**。
以下都是**标识符或持久化数据**，改了会静默坏掉：

| 不能改 | 为什么 |
|---|---|
| `'explorer'`（`ClassroomModule.moduleKey`） | **数据库里的持久化值**。改了要写迁移，且旧课堂读不到自己的模块状态（设计文档 §4.4 有专门说明：「键名是持久化数据，改了要迁移，所以以代码为准」） |
| `ModuleId = 'explore'`、`MODULE_KEY_BY_ID.explore` | 前端语义名，与上一条同源 |
| `ClassroomModuleKey = 'learning-sheet' \| 'explorer' \| 'companion'` | 同上 |
| `webapp-frame` / `webapp-diag` / `webapp-presence` / `webapp-capture-*` 等**事件名** | 线缆契约，两端必须一致 |
| `/teacher/webapps/`、`/api/webapps`、`Webapp` 模型名、`ClassroomWebapp` 表名 | 路由与 schema |
| 文件名 `src/app/classroom/explore/`、`explore-panel.tsx`、`use-explore-bridge.ts` 等 | 改文件名会让 diff 巨大且无收益 |
| `server/vendor/` 下的**第三方**代码 | 那是上游库的文本，不是我们的；**先核对那 2 处是不是我们自己的补丁文字**，是才改 |

⚠️ 「探究**网页**」这个词**也不改** —— 它指的是「教师做的那个网页」（`Webapp`），
与「探究空间」是**两个不同的概念**（后者是我们托管那个网页的模块）。混改会造成新的歧义。

---

## 三、范围（控制器已扫过，但**你要自己再 grep 一遍**）

本项目规矩：**实施者必须用 grep 自己枚举，不得信任任何清单（含本 brief）**。

```
specs/                     83     src/app/teacher/classroom   27
server/src/socket          18     src/lib                    12
src/app/classroom/explore  10     src/app/classroom           8
server/src                  8     server/src/tests            7
server/src/services         7     src/app/classroom/shell     6
src/app/classroom/chat      5     server/src/routes           5
src-tauri/src               3     design/student-home-cartoon-v*  7
src/app/teacher/webapps     2     server/vendor               2
src/app/teacher/classroom/new 1   src/app/classroom/home      1
```

**几个容易漏的地方**（确认一下）：
- `src-tauri/src/` 的 **Rust 源代码** —— 托盘菜单/窗口标题可能是用户可见的
- `server/src/tests/` —— 测试里的断言字符串可能含中文文案
- `myportal/` 落地页（如果有）
- `README.md` / `README.en.md`（同步版本号那个脚本会碰它们）
- `design/student-home-cartoon-v*/` 的设计稿

---

## 四、验收

1. **改完之后，全仓再 grep 一次「探究助手」**，只应剩下：
   - 「不改」清单里的标识符所在行（若有注释里提到旧名，一并处理）
   - **记录这次改名历史的那些文字**（例如设计文档 §3 的反转说明里会引用旧名）
   **把这条 grep 的输出原样贴进报告** —— 不许只说「已全部替换」。
2. 全仓 grep「探究空间」的数量，与「探究助手」改前的数量对照。
3. `npx tsc --noEmit` 退出 0（证明没改坏标识符 —— 这条是关键验证）。
4. `cd server && pnpm test` 全过（先测基线）。
5. `npx eslint src/app/classroom/ src/lib/ src/app/teacher/` 不新增 warning。

---

## 五、Global Constraints

1. **既有测试必须继续全过**（先测基线并记数字）。
2. **不新增任何 npm 依赖。**
3. 提交信息中文；报告一律中文。
4. 🔴 **绝不 `prisma db push` 打在真实库上**。本任务不需要碰数据库。
5. **只允许一个 `pnpm build` / `pnpm test` 在跑。**
6. ⚠️ **不跑根目录的 `pnpm build`**（会覆盖 `.next`，打断用户验证）。用 `cd server && pnpm build`。
7. ⚠️ **不要停 `./dev.sh`** —— 用户正在用它验证。
8. 不碰 `CLAUDE.md` / `dev.sh` / `release.sh`。
9. ⚠️ **`pnpm test` 不清理 `server/dist/`** —— 切分支后可能跑到陈旧产物。
   若基线看起来是红的，先 `rm -rf server/dist` 再测，并在报告里说明。
10. 🔴 **任何「已全部替换 / 因此安全」的结论，必须附 grep 或实测输出。**

---

## 六、交付

1. 先 grep 枚举（自己列，不要照抄本 brief 的清单）
2. 改
3. 按第四节验收，**把 grep 输出贴进报告**
4. 提交（中文信息）
5. 报告写到 `/Users/zxc/myprojects/classnode/.superpowers/rename-explore-space-report.md`
