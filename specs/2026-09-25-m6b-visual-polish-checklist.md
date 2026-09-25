# M6b · 「视觉打磨」的可判定清单（**已执行**：缺陷 8/8 · 口味 8/9 · 1 条有意推迟）

> 日期：2026-09-25 · 分支 `main` · 状态：**缺陷类 8/8 已做 · 口味类 8/9 已做 · 1 条有意推迟**
> 设计文档原话（`specs/2026-09-19-classnode-learning-suite-design.md` §P3）：「视觉打磨：首页、Tab 过渡、作答反馈动效」
> ⚠️ **为什么要有这份清单**：设计文档那句**没有「完成」的判据**，而本机**没有浏览器驱动、没有 jsdom**
> （实测零命中）—— 「好不好看」一条都验不了。所以把它逐项拆成「**现在是 X → 建议改成 Y → 怎么判断做成了**」，
> 你圈中哪几条就做哪几条。
> 🔴 **本文件里每一个 `file:line` 都是调研时实跑取证的**；动手前请自己再 grep 一遍（行号会漂）。

---

## 🔴 硬约束（每一条建议都已按它筛过）

1. **学生端跑在 Safari 15 的老 iPad 上**（`scripts/check-classroom-browser-compat.mjs` 会让构建失败）。
   扫描根：`src/app/classroom` · `src/lib` · `src/app/globals.css` · `src/app/layout.tsx` ·
   `server/src/services/webapp-sdk.ts` · `server/vendor/snapdom.js`。
   禁用：lookbehind · `Object.hasOwn` · `structuredClone` · `.at(` · `findLast` · `:has()` ·
   `@container` · `content-visibility` · `color-mix(`。
2. 🔴 **`worksheet.module.css` 的 `dvh` 用量在闸门里冻结为 3**（`check-classroom-browser-compat.mjs:272-274`）
   —— 本批**一行 `dvh` 都不许加**。
3. **判据分两类**，每条都标了：能用 DOM / `grep` 判定的（「怎么判断做成了」可执行），
   与**只能真机看**的。后者那一类是这批的主要成分，**这一点无法回避**。

---

## 〇、这批怎么分（控制器 2026-09-25 标注）

> 用户说「继续」，但没有逐条圈。我按**能不能客观判定**分了两类 —— 这样你只要看**口味**那一列。

| 类 | 判据 | 条 |
|---|---|---|
| ✅ **缺陷类已做**（8/8） | 有客观判据，`grep`/DOM 可判 | **1 · 3 · 4 · 5 · 11 · 14 · 15 · 17** |
| ✅ **口味类已做**（8/9） | 用户 2026-09-25 指示「把剩下的 9 条口味也做完」 | **2 · 6 · 7 · 9 · 10 · 12 · 13 · 16** |
| 🔵 **口味类有意推迟**（1） | 前提为真、但修法会撞一条不变量 | **8**（见下） |

### 🔵 第 8 条为什么没做（**这是推迟，不是漏**）

用户的指示是「把剩下的 9 条口味也做完」，**9 条里我做了 8 条，第 8 条没做**。理由：

- 第 8 条的**前提是真的**（`classroom-shell.tsx:316-322` 的注释自己记着，机制也已复核）：
  切层时提示条确实会 `visibility:hidden` 约 280ms。
- 但它的修法（给 `useOverlayPortal` 加 `visible` 参数、只对 toast 传 `phase.front === key`）
  要求把 `layer-overlays.tsx` 里那条**「非前台层的浮层不得浮在上面」**的不变量放宽一个口子 ——
  那是全屏浮层体系的承重结构，不是一条皮肤。改动面比另外 8 条加起来还大，
  而**收益（提示条少闪一下）本机一条都验不了**（看不见界面）。
- ⇒ 按「代价 >> 可验证收益」推迟，**留给能真机对照的一次**（真机验收清单里那条 §二-8）。
  硬性要求没变：改它的时候必须保住那条不变量。

⚠️ **口味类这 8 条同样无法证明「更好看」**：本机看不见界面，每一次改动都无法区分是变好还是变坏。
它们的判据都退化为「**可 grep / 可 DOM 断言**」那一半（例如 `grep -c "240ms"` 由 4 变 1、
`@keyframes rewardPop` 有命中）—— 「是否更好看」仍需真机。**不要把这些 ✅ 读成「已验过好看」。**

---

## 一、首页（6 条）

- [x] **1.（✅ 已做 2026-09-25）学生入口页的主按钮，禁用与可用长得一模一样；所有按钮都没有按下反馈**
  · 现状：`src/app/page.tsx:177-185` 的按钮 `disabled={fullCode.length !== 4 || loading}`（`:178`），
    唯一的禁用视觉是内联 `opacity: loading ? 0.7 : 1`（`:181`）⇒ 「码没填满 ⇒ disabled」时 opacity 是 1，
    **与可点状态完全一致**。根因：`src/app/globals.css:293-345` 的 `.btn` 系列只有 `:hover`，
    `grep -n "btn:active\|btn:disabled" src/app/globals.css` **零命中**。
  · 建议：`globals.css` 补 `.btn:active:not(:disabled) { transform: translateY(1px); }`（复用
    `shell.module.css:223-227` 已有的那套语言）与 `.btn:disabled { opacity: .5; cursor: not-allowed; }`；
    删掉 `page.tsx:181` 的内联 opacity。
  · 怎么判断做成了：`grep -n "\.btn:active\|\.btn:disabled" src/app/globals.css` 有 2 条命中；
    DOM 上取一个 disabled 的 `.btn`，`getComputedStyle().opacity === '0.5'`（现在是 `1`）。
  · 风险：`.btn` 是**师生共用**的类，教师端 20+ 处会一起获得按下反馈（想要的副作用，但改完要在教师端扫一眼）。

- [x] **2.（✅ 已做 2026-09-25）错误提示是裸红字，且出现时把整张卡顶上去**
  · 现状：`src/app/page.tsx:173-175` 一行 `<p style={{ color: '#ef4444', ... }}>`，无底色无边无图标无 `role`。
    外层是 `justifyContent: 'center'` 的 100vh flex ⇒ 这行一插入**整卡内容上移约一半高度**。
    对照组：`identity-picker.tsx:147-151` 的错误条是 `#fef2f2` 底 + `#fca5a5` 边 + 圆角。
  · 建议：错误位做成**固定槽**（`min-height: 24px` 的容器，`<p>` 只负责显隐）+ 套用 identity-picker 那套底色描边 + `role="alert"`。
  · 怎么判断做成了：量按钮的 `getBoundingClientRect().top` —— 触发前后**必须相同**（现在会差 ~13px）。
  · 风险：`src/app/page.tsx` **不在**扫描根内，但它跑在老 iPad 上 ⇒ 自觉守同一套约束。
  · **实做**：固定 `minHeight: **30**` 槽 + `#fef2f2`/`#fca5a5` + 圆角 + `role="alert"`。
    ⚠️ 独立审查抓到本行原写 `24`，**代码是 30** —— 已改（30 恰好放得下一行 `0.813rem` 的错误条）。
    ⚠️ **没做**「量 rect.top 前后相同」那条断言 —— 本机**没有 DOM 驱动**，这条只能真机验（已进真机清单）。

- [x] **3.（✅ 已做）教师端「加载失败」与「还没有课堂」不可区分**
  · 现状：`src/app/teacher/page.tsx:130-137` 的 `loadData()` 是 `catch {}`（空块，不记错误状态）⇒
    失败后 `activeClassrooms` 停在 `[]`，界面走到「创建第一个课堂」（`:1045`），**与「你确实一堂课都没有」逐字相同**。
  · 建议：`catch` 里 setToast + 新增 `loadError` state；失败时渲染一张错误卡 + 「重试」按钮。
  · 怎么判断做成了：停掉后端后打开 `/teacher`，屏幕上出现「加载失败」而**不是**「创建第一个课堂」。**不需要眼睛。**
  · 风险：零。

- [x] **4.（✅ 已做）教师端加载屏手写「加载中...」，而仓库里现成的带 spinner 的组件没用**
  · 现状：`src/app/teacher/page.tsx:379-393` 是个 60vh 居中 div，只有三个字。
    而 `src/lib/components.tsx:72-78` **已经有** `TeacherLoadingState`（`.teacher-loading-state`，带旋转圈 + `role="status"`）；
    同页第 10 行已经 import 了同文件的另外两个组件。
  · 建议：`teacher/page.tsx:379-393` 整块换成 `<TeacherLoadingState label="正在加载课堂…" />`。
    顺带给**学生端连接屏**（`src/app/classroom/page.tsx:71-79`，纯两行字）补一个旋转圈 ——
    `@keyframes spin` 在同文件 `:23` 已定义，**直接复用，不要新写**。
  · 怎么判断做成了：教师端 DOM 里出现 `.teacher-loading-state`；学生端连接屏里出现 `animation-name: spin` 的元素。
  · 风险：学生端那份在扫描根内，但 `spin` 是已存在的 keyframe ⇒ 不新增 token。
  · **实做（教师端）**：整块换成 `<TeacherLoadingState label="正在加载课堂…" />`。
  · 🔴 **实做（学生端）—— 这一半是独立审查后补的。** 条目当时已挂 ✅，而
    `git diff --stat f914817~1..ff2d4bd -- src/app/classroom/page.tsx` **输出为空** ——
    那屏仍是两行纯文字，**§六 也没给它留槽位** ⇒ 这条不会在任何地方被发现是空的。
    现补上旋转圈（复用本文件 `:23` 的全局 `@keyframes spin`，颜色走 `currentColor`）。
    **产物复验**：`out/classroom/index.html` 里 `animation:spin .7s linear infinite`
    就在「正在连接课堂...」前一个 div。**已给 §六 补槽位。**
    ⚠️ 教训：「一个条目写了两句话」时，**两句话都要有自己的判据**，否则做了一半也会勾上。

- [x] **5.（✅ 已做）学生入口页的服务状态点，在健康检查回来之前就报「服务在线」**
  · 现状：`src/app/page.tsx:18` `useState(true)` ⇒ **首帧就是绿点 + 「服务在线」**（`:106-110`）。
    失败后变红点，但文案写「连接中...」（`:109`）⇒ 出现「红点 + 连接中」两个互相矛盾的说法，
    而**「服务离线」这句话永远不可能出现**。
  · 建议：初值改 `null`（未知）⇒ 三态：未知（灰 `#94a3b8` +「正在检查服务...」）/ 在线 / 未连接。
    `.status-dot` 已有 online/offline 两个修饰类（`globals.css:264-276`），加一个 `.unknown` 即可。
  · 怎么判断做成了：首帧 DOM 上 `.status-dot` 既不含 `online` 也不含 `offline`；失败时文案恰为「服务未连接」。
  · 风险：极低。

- [x] **6.（✅ 已做 2026-09-25）学生首页的空态用虚线占位框，与同屏三张卡不是一个语言**
  · 现状：`student-home.tsx:251` → `home.module.css:296-305`：`border: 1px dashed` + 灰底灰字居中。
    同屏三张卡是 solid + `border-left: 4px solid var(--card-accent)`（`:131-132`）。
    **虚线框读起来像「出错了」，而这句话其实是正常状态。**
  · 建议：换成与 `.card` 同族的实线卡（`1px solid #e6eaf2` + `border-left: 4px solid var(--card-accent)` + 白底）。
  · 怎么判断做成了：两者 `border-style` 都是 `solid`、`border-radius` 都是 `14px`（可 grep 比对）；
    「是否更像同一套」**只能真机看**。
  · 风险：低（只改颜色/边框，不碰任何 token）。
  · **实做**：`.emptyNote` 换 `1px solid #e6eaf2` + `border-left: 4px solid var(--card-accent, #2563eb)` + `#fff` 底 + `14px` 圆角。
    ⚠️ 本文件**还剩一处 `dashed`**（`:240` `.cardLocked`）—— 那是**预告态的刻意设计**（锁住的卡），**不是漏改**。

- [x] **7.（✅ 已做 2026-09-25）卡片按下的回弹被 hover 用的 160ms 过渡拖慢**
  · 现状：`home.module.css:139` `.card { transition: transform .16s ease; }` **同时**作用于
    `:hover`（抬起）与 `:active`（`:163-165` 缩到 0.992）⇒ 手指按下后要 160ms 才缩到位，触屏上就是「按了没反应」。
  · 建议：加一条 `.card:active { transition-duration: 60ms; }`（抬起仍保留 160ms）。
  · 怎么判断做成了：**只能真机看**。
  · 风险：极低（`prefers-reduced-motion` 那块已经覆盖 `.card:active`）。
  · **实做**：`.card:active { transition-duration: 60ms; }`。
    ⚠️ 「按下去跟手了没有」**只能真机看** —— 这条的判据本机**一条都验不了**，已进真机清单。

## 二、Tab 过渡（4 条）

- [ ] **8. 切 Tab 时提示条会闪一下（消失约 280ms 再出现）—— 代码注释自己记着这个现象**
  · 现状：`classroom-shell.tsx:316-322` 注释原话「切层时两层都会 `visibility:hidden` 约 240+40ms」。
    机制：提示条走 portal（`layer-overlays.tsx:34`），而层传的 `active` 是 `activate(id)` =
    `phase.front === key && phase.settled`（`classroom-shell.tsx:274`）⇒ 动画期间 `settled` 为假 ⇒ 被隐藏。
  · 建议：给 `useOverlayPortal` 加第二个参数 `visible`（默认取 `active`），**只对 toast** 传 `phase.front === key`。
    ⚠️ **不要动换头像弹窗** —— 它的 `active` 是刻意恒为真（`classroom-shell.tsx:341-346`）。
  · 怎么判断做成了：用 `MutationObserver` 记录 portal 包装层的 `style.visibility` —— **不应出现 `hidden`**。
  · 风险：中（必须保住「非前台层的浮层不得浮在上面」这条不变量；只放宽到 `front` 是安全的）。

- [x] **9.（✅ 已做 2026-09-25）四条 240ms 是四个独立字面量，「必须一起改」只靠注释**
  · 现状：`shell.module.css:587-590` 四处硬编码 `240ms`，`:548-556` 的注释自己承认「没有任何机制强制它们相等」。
    **改其中一条不会报错、没有编译期信号。**
  · 建议：`.shell` 上加 `--shell-slide-duration: 240ms;`，四条动画改用它。
  · 怎么判断做成了：`grep -c "240ms" shell.module.css` 应为 **1**（只有变量定义处）。
    外壳一行不用改（已确认 `slideDurationMs` 的 `ms` 分支吃得下）。
  · 风险：中（改完必须验 `phase.settled` 仍在 ~280ms 翻真）。
  · **实做**：`.shell`（`shell.module.css:26`）上定义 `--shell-slide-duration: 240ms`，
    四条动画（`:595-598`）全部改用它。层元素是 `.shell` 的**后代**（`classroom-shell.tsx:578/590`
    的 `renderLayer` 渲染在 `<div className={styles.shell}>`( `:555` ) 之内），自定义属性继承成立。
  · 🔴 **本节原先那条判据「`grep -c "240ms"` 应为 1」是错的 —— 实测 7。动手后照抄它写进本文件，
    被自己复核时抓到。** 真实分布：**1** 条定义（`:30`）+ **1** 条紧随的说明注释（`:28`）
    + **4** 条散文注释（`:75` `:502` `:553` `:595`）+ **1** 条**与本不变量无关的真实时长**
    —— `:95` `.tabIndicator` 的 `transition: transform 240ms …`（滑块自己的动画，刻意独立）。
    ⇒ **准确判据**：四条 `animation: shell*` 声明**全部**引用变量，即
    `grep -c 'animation: shell'`（== 4）与 `grep -c 'animation: shell.*var(--shell-slide-duration)'`（== 4）**相等**。
    实测 **4 == 4**。⚠️ 别用 `grep -c "240ms"` 当判据 —— 注释里到处都是这个词。
  · **连带修的一处**：`shell.module.css:553` 那段注释原文断言「四条 240ms 是四处**独立的字面量**，
    没有任何机制强制它们相等」—— 本次改动**让它变成假话**，已改写为「四条一律写 `var(...)`，
    原先那句已不成立」，并保留「仍要读两侧计算样式」的理由（变量只保证这四条规则同源，
    挡不住别处覆盖其中一条）。**加变量而不改这段注释 = 留下一句自相矛盾的注释。**
  · ⚠️ **同一句话在 TS 里还有两份**（`classroom-shell.tsx:97` 与 `:235`），本批一开始**没跟着改**
    —— 独立审查抓到。已按同一口径改写。⇒ 这是本批第 **4** 处「改动让注释变成假话」，
    教训是：**改一个事实时要全仓 grep 那句话本身，而不是只改眼前那一份。**

- [x] **10.（✅ 已做 2026-09-25）入场动画期间那一层可以点，而落点还在移动中**
  · 现状：`shell.module.css:589-590` 给两条**离场**动画加了 `pointer-events: none`，
    而 `:587-588` 的两条**入场**动画没有 ⇒ 这 240ms 里的 tap 会被一个正在位移的层接住。
  · 建议：给入场那两条也加 `pointer-events: none`（摘除时机不用写 JS —— `layerClass` 本来就用 `!phase.settled` 控制）。
  · 怎么判断做成了：**只能真机看**（真机上快速双击，第二次不应触发入场层里的按钮）；
    可辅以 DOM 断言（`settled` 为假时入场层 `pointerEvents === 'none'`）。
  · 风险：中（别把「滑到一半后悔、点回原 Tab」堵死；真机手感不对时的出路写在调研记录里）。
  · **实做**：`.enterRight`（`:599`）与 `.enterLeft`（`:600`）各补 `pointer-events: none` ⇒ 四条动画**全部**有。
    `grep -n 'pointer-events'` 的**声明**命中：`:94`（`.tabIndicator`，无关）+ `:599-602`（四条动画）。
  · ⚠️ **「滑到一半想反悔、点回原 Tab」这条路还通吗 —— 本机验不了。** 摘除靠 `layerClass` 的
    `!phase.settled`，settled 翻真后类就没了，理论上恢复正常；但**真机手感是唯一判据**，已进真机清单。
    ⚠️ 另注（`:598` 的注释）：`pointer-events: none` **不阻止**程序化 `focus()` ⇒ 不挡键盘弹出。

- [x] **11.（✅ 已做）`prefers-reduced-motion` 的「一条不漏」清单没有守护**
  · 现状：`shell.module.css:658-686` 手工列了 4 条动画 + 2 条过渡 + **5 个 `:active`**，
    文件自己说「必须一条不漏」。今天是对的，但**下次谁加一个带 `:active` 的按钮，不会有任何信号**。
  · 建议：**不加运行期代码**，只加一个纯字符串自检（本仓已有先例），断言「`:active` 选择器集合 == 降级块里的集合」。
  · 怎么判断做成了：故意加一个 `.foo:active` 而不加进降级块 ⇒ **测试必红**。
  · 风险：零。

## 三、作答反馈动效（5 条）

- [x] **12.（✅ 已做 2026-09-25）🔴 奖励徽章「出现即显示」，零动效 —— 代码自己把这件事挂到了本批次**
  · 现状：`reward-badge.tsx:41` 原文「动画（星星飞入）属 **P3 视觉打磨**，第一批是静态图标 + 出现即显示」。
    `worksheet.module.css` 全文只有 2 条 `transition`、**0 个 `@keyframes`、0 个 `animation`**。
  · 建议：`.questionReward` 与 `.rewardTotal` 各接一条入场动画
    （`rewardPop`：`scale(.4)` → `1.18` → `1`，260ms，带回弹的 `cubic-bezier(.34,1.56,.64,1)`）。**只碰 transform/opacity。**
  · 怎么判断做成了：`grep -n "@keyframes rewardPop" worksheet.module.css` 有命中；
    DOM 上 `getComputedStyle().animationName === 'rewardPop'`。「跳出来 vs 淡出来」**只能真机看**。
  · 风险：低-中（🔴 **`dvh` 冻结为 3，这批一行都不许加**）。
  · **实做**：加 `@keyframes rewardPop`（`scale(.4)`→`1.18`→`1`，260ms，`cubic-bezier(.34,1.56,.64,1)`），
    应用到 `.questionReward` 与 `.rewardTotal`。**只碰 `transform`/`opacity`**（守「不动画 filter/布局属性」）。
    **实测**：`grep -c rewardPop` == **3**（1 个 keyframes + 2 处引用）；`dvh` 用量**未变**（闸门仍过）。
    ⚠️ 「跳出来 vs 淡出来」**只能真机看** —— 已进真机清单。

- [x] **13.（✅ 已做 2026-09-25）提交中只有文字变化，没有「正在网络里」的可见信号**
  · 现状：`worksheet-panel.tsx:310` 是 `{submitting[node.id] ? '提交中…' : ...}`，
    而 `.submitButton:disabled` 只降透明度 ⇒ 判分往返期间屏幕上只有半透明按钮 + 三个字。
  · 建议：在「提交中…」前加一个 12px 纯 CSS 旋转圈（**本文件自带一份 `spin`** ——
    教师端的「学生端预览」不经过 `classroom/page.tsx`，自带更稳）。
  · 怎么判断做成了：DOM 断言 —— 提交中时按钮内存在 `animation-name: spin` 的子元素。
  · 风险：低。
  · **实做**：`.spinner` 加进 `worksheet.module.css`，`worksheet-panel.tsx` 在「提交中…」前插入 `<span className={styles.spinner} />`。
  · 🔴🔴 **动手后抓到一个真缺陷（本批最重的一条）：那个圈本来不会转。**
    初版写的是 `animation: spin .7s linear infinite`，理由是本节建议里那句
    「**本文件自带一份 `spin`**」—— 而**那句话是假的**：`worksheet.module.css` 里
    **没有** `@keyframes spin`，仓库里唯一的 `spin` 在 `src/app/globals.css:700`。
    **跨文件引用在 CSS 模块里不成立**：`css-loader` 把 `animation-name` 当局部名加哈希前缀，
    产物里写成 `animation: worksheet_spin__FJ3q5 .7s linear infinite`，
    而**全仓产物里没有 `@keyframes worksheet_spin__FJ3q5`**（已逐文件 grep 取证）⇒ **悬空引用**。
    三重假绿：① `next build` 退出 **0**；② `grep` 看得见那行 `animation: spin`；
    ③ 屏幕上那个白圈**看着像在转**（其实是静态的）。**只有去产物里对名字才抓得到。**
  · **修法（TDD）**：新增 `src/lib/css-module-animation.test.ts`（**3 条**）——
    断言「模块里引用的每个动画名字都在**同一文件**里定义」，带两条反证
    （抽走定义必须被抓到 · 注释与 `animation: none` 不算引用）。
    **RED 实测**：`app/classroom/worksheet/worksheet.module.css:382 引用了 \`spin\`，本文件没有这个 @keyframes`。
    **GREEN 修法**：在本文件定义 `@keyframes submitSpin`（**故意不叫 `spin`**，避免与全局同名造成下一次误读），
    `.spinner` 改引 `submitSpin`。
    ⚠️ 本机能给的证据到此为止：**「圈真的在转」仍需真机看**（已进真机清单）。
    ⚠️ 该判据只覆盖 CSS **模块**；`globals.css` 不是模块、不做哈希，本轮未纳入。
  · 🔴🔴 **第二轮（独立审查）又在这同一段代码上抓到一个 Critical：那个圈在「重新提交」的路上是白底白圈。**
    初版把颜色**写死成白色**，而按钮在「已提交过」时会切成 `.submitButtonResubmit`
    （`background: #fff`）⇒ 两条规则同时命中同一个按钮 ⇒ **等于没加**，
    而且 `:disabled { opacity: .5 }` 让它更淡。**我为修 #13 写的这段代码，自己又是一个静默失效。**
    **修法**：`border: 2px solid currentColor; border-top-color: transparent;` ——
    `currentColor` 在两种态下分别解析成 白 / accent，两种底都成立。
    **产物复验**：压缩器压成 `border:2px solid;border-top:2px solid transparent`
    （`currentColor` 是 `border-color` 的**初始值**，省掉语义不变）。
    **守护**：`worksheet-adornment-color.test.ts`（先看它红在 `2px solid rgba(255,255,255,.45)`）。
  · ⚠️ **本机没有 DOM 驱动 ⇒ 「DOM 断言」那条判据我一条都没跑**。本机能给的证据只有
    `grep -c 'styles.spinner'` == 1（引用存在）与静态检查/构建通过 —— **这不等价于「提交时真的在转」**。
    已进真机清单。

- [x] **14.（✅ 已做）作答面板的空态/错误态卡，与另外两处「同款语气」的兄弟尺寸与徽章都不同**
  · 现状：`shell.module.css:618-627` 与 `explore.module.css:58-66` **逐字相同**
    （`padding: 28px 24px` / `border-radius: 18px` / `border-top: 4px` / `box-shadow: 0 10px 30px …`）；
    而 `worksheet.module.css:402-412` 是 `26px 22px` / `5px` / `0 18px 40px …`。徽章、标题行距也都不同。
  · 建议：把 worksheet 那一份对齐到另外两份。**注释自己写着「与探究空间同款语气」，那就让它字面为真。**
  · 怎么判断做成了：三个文件的这几条声明逐字一致（可 grep 比对）。
  · 风险：低。

- [x] **15.（✅ 已做）工作表模块的触控目标跌破本文件自己写的 44px 下限（提交按钮 40px、重试按钮 40px）**
  · 现状：同文件 `min-height: 44px` 出现 4 次并三次附注释「44px 是触屏命中区的下限，老 iPad 上手指更粗」，
    而 `.submitButton`（`:361`）与 `.retry`（`:441`）都是 **40px**。探究空间的重试按钮是 44px + 实心。
  · 建议：两者补到 44px，并对齐 explore 那份的形状与字号；两者都补 `:active` 反馈（现在没有）。
  · 怎么判断做成了：`getBoundingClientRect().height >= 44`。
  · 风险：低。
  · 🔴 **本条的现状枚举本身是一次漏扫（独立审查 2026-09-25 抓到）**：那句
    「`.submitButton` 与 `.retry` 都是 40px」是**拿 `grep min-height` 扫出来的**，
    于是同文件里用 `width/height` 写的 **`.orderButton`（排序题的 ▲/▼，40×40）一次都没被扫到** ——
    修法照抄那句枚举，也就**一起漏了**：它才是真正被留在原地的那一个。
  · **实做（补漏）**：`.orderButton` 补到 44×44。
    **守护**：`worksheet-tap-targets.test.ts` —— 判据不再是我「grep 了哪些」，
    而是**从 TSX 反查每一个 `<button>` 再回 CSS 量尺寸**（尺寸取多个类的并集）。
    **RED 实测**：红在 `questions/order-body.tsx:116/125 orderButton 高 40px / 宽 40px`，零误报。
    ⚠️ 别与 `.poolItem`（分类题的**拖拽源**，40px 刻意不动）混为一谈 —— 那是另一回事。
  · ⚠️ **本条的建议里还有两条没做**（独立审查 M9）：「对齐 explore 那份的**形状与字号**」、
    「两者都补 **`:active`** 反馈」。**判据只覆盖高度 ⇒ ✅ 成立**，但记账要诚实：
    实测 `grep -n 'submitButton:active'` **零命中**，`.retry` 仍是描边白底
    （explore 那份是实心 + 有按下反馈）。改按钮形状/字号是**看不见界面时的盲改**，
    已列进 §六 由你真机对照后再定。

- [x] **16.（✅ 已做 2026-09-25）状态 chip 与选项选中态都是瞬间跳变，而同屏的进度条是平滑的**
  · 现状：`.questionState` 三态只换颜色（无过渡）、`.optionSelected` 换边框底色也是瞬间，
    而同屏 `.progressFill` 有 `transition: width .25s` ⇒ **「进度条在动、状态字在跳」**。
  · 建议：各加 `transition: color .18s` / `transition: background-color .18s, border-color .18s`。
    ⚠️ 若想严格守「只用 transform/opacity」，替代方案是 180ms 的 `opacity + translateY(2px)` 入场。
  · 怎么判断做成了：`grep -n "transition" worksheet.module.css` 从 2 条涨到 4 条；
    「跳变 vs 渐变」**只能真机看**。
  · 风险：低（本文件已有 `background-color` 与 `width` 两条非 transform/opacity 过渡的先例 ⇒ 不算破例，
    但要在评审时说明这是**刻意的例外**，别让它扩散到外壳）。
  · **实做**：`.questionState` 加 `transition: color .18s ease-out;`（`:197`）、
    `.optionSelected` 加 `transition: background-color .18s ease-out, border-color .18s ease-out;`（`:270`），
    两条都进 reduced-motion 降级块。
    **实测**：`transition:` **声明**由 2 条（`:52` `:91`）涨到 **4 条**（+`:197` `:270`）—— 与判据一致。
    ⚠️ `grep -c 'transition'` 全文会数到 **7**（4 条声明 + 2 处注释 + 降级块的 `transition: none`）⇒
    （独立审查抓到本行原写 6 —— 漏了我自己新写的那句注释。**这条「修正」自己也是错的**，已改。）
    **判据要数「声明」，不是数 `grep -c`**（本节原判据写的是条数，实测时按声明数才对得上）。
    ⚠️ 「跳变 vs 渐变」**只能真机看** —— 已进真机清单。**这是刻意的非 transform/opacity 例外，不要扩散到外壳。**

- [x] **17.（✅ 已做）🔴 工作表模块没有任何 `prefers-reduced-motion` 块 —— 加动画时必须同批补上**
  · 现状：`worksheet.module.css` 里 `grep -n "prefers-reduced-motion"` **零命中**（`explore.module.css` 同样为零）。
    目前靠 `globals.css:38-44` 的全局 `0.01ms` 兜底 —— 那确实生效，但意味着本文件「所有会动的东西」
    **既没有清单也没有例外可言**。
  · 建议：本批加动画时**同批**补一个与 shell 同形的显式块，并在文件头的硬约束注释里补一句。
    特别是 `.progressFill` 的 `width .25s` —— 全局 0.01ms 下它会变成瞬移，若希望它对 reduced-motion 用户仍平滑，得显式写例外。
  · 怎么判断做成了：`grep -n "prefers-reduced-motion" worksheet.module.css` 有命中；
    且该块覆盖的选择器数量 == 文件里 `animation`/`transition` 的条数。
  · 风险：零。

---

## 四、调研认为是**不值得做**的（11 条，各一句理由）

> 列在这里是为了让你知道**看过并且刻意略过了**，而不是漏了。

- 入场/离场位移量不对称（进 100% / 出 30%）—— 镜像后是对称的；改它只是换一种手感，收益不可判定。
- `.tabIndicator` 的宽度不参与过渡 —— 注释已解释（width 是布局属性、相邻 Tab 差值只有几像素），**是对的**。
- `progressFill` 动画 `width` 而不是 `transform: scaleX()` —— 84px 宽的条，重排代价可忽略；改 scaleX 会与 `border-radius` 打架。
- **四条层动画的 240ms 这个值本身** —— 它与 `SETTLE_SLACK_MS = 40` 和读计算样式的机制精确匹配，调时长要连带重算就位判定。
- `Toast` 没有入场/退场动画 —— 师生共用的老组件、教师端 20+ 处在用，为 3 秒提示条加动画不划算。
- `.card` 的 `:hover` 抬起 + 阴影淡入 —— 老 iPad 没有 hover，这套是给桌面与投屏看的，**保持**。
- 给 `classroom/page.tsx:71-79` 加**骨架屏** —— 正常路径亚秒级，骨架屏反而会让秒进的学生看到一闪而过的假骨架（只补旋转圈，见第 4 条）。
- `page.tsx:158` 的 `caretColor: 'transparent'` —— iOS 上光标本来就基本不可见，改它要真机反复验，收益不明。
- `home.module.css:262-265` 锁定图标的 `filter: grayscale(1)` —— 它是**静态**的、不参与动画，不违反「不动画 filter」。别顺手改掉。
- `worksheet.module.css:717-725` 的 `.poolItem` 是 40px —— 它是分类题的**拖拽源**不是点按目标；改 44px 会撑高候选池、挤掉可视题面。
- 全屏 loading 用 `minHeight: '100vh'` 而不是 `dvh` —— **这正是 Safari 15 上唯一正确的写法**（`dvh` 会让整条声明被丢弃）。

---

## 五、本批门禁实测（2026-09-25，全绿）

> 下表是**独立审查修复后**的最终数字（修复前的中间值：前端 351、Safari 闸门 78）。

| 门禁 | 命令 | 实测 |
|---|---|---|
| 类型 | `npx tsc --noEmit` | 退出 **0** |
| 静态检查 | `npx eslint src server/src` | **0 errors / 5 warnings**（5 条全是本批之前就有的） |
| 前端全量 | `node --test "src/**/*.test.ts"` | **359 pass / 0 fail**（本批开工前 346） |
| 服务端全量 | `rm -rf server/dist && pnpm test` | **527 pass / 0 fail** |
| 产物构建 | `./dev.sh stop && pnpm build && ./dev.sh start` | 退出 **0**；Safari 15 闸门 **80 个源文件通过** |
| `dvh` 冻结 | （闸门内建） | 用量**未变**，仍过 |

**本批新增的自动化网**（3 个文件、11 条用例，全部带反证）：

| 文件 | 条 | 钉住的事 |
|---|---|---|
| `src/lib/css-module-animation.test.ts` | 4 | 模块引用的动画名字必须在**同一文件**里定义（跨文件引用不成立）；**注释里的 `@keyframes` 不算定义** |
| `src/app/classroom/worksheet/worksheet-tap-targets.test.ts` | 3 | 本模块**每个 `<button>`** 的命中区 ≥ 44px（从 TSX 反查，尺寸取多个类的并集） |
| `src/app/classroom/worksheet/worksheet-adornment-color.test.ts` | 4 | 按钮里的装饰件颜色必须来自 `currentColor`（按钮有白底变体） |

⚠️ **测试覆盖 ≠ 端到端走查**：上面这一整节**不证明** §一–§三 任何一条的「更好看」。

---

## 五之二、独立审查（2026-09-25）的发现与处置

> 审查者拿到的是 `f914817..ff2d4bd` 的整批 diff，独立取证。
> **1 Critical / 5 Important / 9 Minor。** 处置如下（Critical+Important 一轮修完，每条先写会红的用例）。

### 🔴 Critical

**C1 · 那个旋转圈在「重新提交」的路上是白底白圈（等于没加）。**
`.spinner` 把颜色写死成白色，而按钮在「已提交过」时会切成 `.submitButtonResubmit`
（`background: #fff`）⇒ 两条规则同时命中同一个按钮。**这正是我用来修 #13 的那段代码**，
而它自己又是一个静默失效。审查者的取证是产物里两条规则并存。
**处置**：改成 `border: 2px solid currentColor; border-top-color: transparent;` ——
`currentColor` 在两种态下分别解析成 白 / accent，两种底都成立。
**产物复验**：压缩器把它压成 `border:2px solid;border-top:2px solid transparent`
（`currentColor` 是 `border-color` 的**初始值**，省掉语义不变）⇒ 行为保留。
**守护**：`worksheet-adornment-color.test.ts`（先看它红在 `2px solid rgba(255,255,255,.45)`）。

### ⚠️ Important

**I1 · 清单 #4 的「学生端那一半」根本没做，条目却挂着 ✅。**
`git diff --stat f914817~1..ff2d4bd -- src/app/classroom/page.tsx` **输出为空** ——
那屏仍是两行纯文字，而 §六 真机清单里**也没给它留槽位** ⇒ 这条不会在任何地方被发现是空的。
**处置**：补上那个圈（用本文件 `:23` 已有的全局 `@keyframes spin`，颜色走 `currentColor`）。
**产物复验**：`out/classroom/index.html` 里 `animation:spin .7s linear infinite` 就在
「正在连接课堂...」前一个 div。**已给 §六 补槽位。**

**I2 · `.orderButton` 仍是 40×40 —— 同一个文件里的 44px 下限还是破的。**
#15 的现状枚举写成「`.submitButton` 与 `.retry` 都是 40px」，那是**拿 `grep min-height` 扫出来的**，
于是用 `width/height` 写的 `.orderButton`（排序题的 ▲/▼，`<button aria-label="上移">`）
**一次都没被扫到**，修法照抄那句枚举也就一起漏了。
**处置**：补到 44×44。**守护**：`worksheet-tap-targets.test.ts` ——
判据不再是我「grep 了哪些」，而是**从 TSX 反查每一个 `<button>` 再回 CSS 量尺寸**。
**RED 实测**：红在 `questions/order-body.tsx:116/125 orderButton 高 40px / 宽 40px`，零误报。

**I3 · 🔴 我为修 bug 建的那张网，被我在同一个提交里写的一句注释废掉了。**
`css-module-animation.test.ts` 的 `declaredKeyframes` 扫**原文不剥注释**，而
`worksheet.module.css:379` 那句注释里**恰好写着**「全局 `@keyframes spin`」
⇒ 「`spin` 已在本文件定义」被一句注释凭空满足。
**触发场景**：谁把 `.spinner` 改回 `animation: spin`（**这张网存在的全部理由**），测试**照样全绿**。
**审查者的复现**：拿真文件只把 `submitSpin` 改回 `spin` ⇒ `pass 3 / fail 0`。
**处置**：`declaredKeyframes` 先剥注释；补第 4 条用例「注释里的 `@keyframes X` 不算定义」。
**双向验证**：① 修好的判据 vs 回退成 `spin` 的真文件 ⇒ **RED**（改前全绿）；
② 把判据改回旧写法 ⇒ 新用例 **RED**（「注释里的 @keyframes 不能算定义」）。

**I4 · `classroom-shell.tsx` 里那句「四处独立字面量」没跟着改，现在是假话。**
本批已在 CSS 里改掉了这句，而**同一句话在 TS 里还有两份**（`:97` 与 `:235`）一字未动。
**处置**：两份都按同一口径改写（并保留「两侧都读仍必要」的理由）。
⚠️ 这是本批第 **4** 处「改动让注释变成假话」—— 说明**改一个事实时要全仓 grep 那句话，别只改眼前那份**。

**I5 · `.btn:disabled { opacity: .5 }` 把教师端一个按钮压到几乎看不见。**
`.agent-coze-fetch-button:disabled` 是本仓唯一一处**自己写死禁用外观**的 `.btn`；
`opacity` 无人覆盖 ⇒ 与新增的 `.5` 叠加，对比度 **1.42 → 1.19**（1.42 本来就极低）。
**处置**：给它补 `opacity: 1`（它已有自己的禁用配色）。
⚠️ 审查者同时**查了教师端全部 `.btn`**，确认**没有**别处依赖「disabled 时 opacity 为 1」、
也**没有**会被 `translateY(1px)` 顶出接缝的按钮 —— 这条我记下来，因为它比「找到一个缺陷」更有用。

### Minor（**未修，交你定**）

审查者的原话是「判据只覆盖高度 ⇒ 不算漏判」，所以下面这些**不影响任何 ✅ 的成立**，但都要记账：

- **M1** #14 的判据「三个文件的这几条声明逐字一致」**不成立**：`.badge` 的 `letter-spacing`
  是 `.04em` 而另两处 `.02em`；`.cardTitle` / `.cardNote` 的字号与行距也没对齐。
  #14 自己点名的「徽章、标题行距也都不同」**只解决了徽章的一半**。
- **M2** `shell-reduced-motion.test.ts` 的正则只认「类/ID 紧邻 `:active`」⇒
  `button:active`、`.a:hover:active` 这类**会被漏掉**。今天文件里 5 条恰好都是单类形态 ⇒ 不是现网缺陷。
- **M3** `shell.module.css:588` 的「**退场那两层额外**关掉指针事件」在 #10 之后不再准确（四条现在都有）。
- **M4** `identity-picker.tsx:143` 的内联 `opacity` 盖掉了 `.btn:disabled` 的新视觉 ——
  **这是我在 #1 里清掉的那个反模式，学生端这份还在**（「进入中...」时按钮看着仍是可点的）。
- **M5** 本节 #16 修正后的判据**还是错的**：`grep -c 'transition'` 实测 **7**，我写的 **6**
  （漏了我自己新写的那句注释）。**已改。**
- **M6** #2 的「实做」写 `minHeight: 24`，代码是 **30**。**已改。**
- **M7** `.classroom-management-toolbar`（不带 `-actions`）成了**孤立选择器**（`f914817` 换掉那块 div 之后）。
  **已删。**
- **M8** 旋转圈与「提交中…」之间**没有间隙**（`.submitButton` 不是 flex、JSX 里也没空白）⇒ 12px 的圆紧贴第一个字。
- **M9** #15 的**建议**里「对齐 explore 那份的形状与字号」「两者都补 `:active`」**两条没做**（只做了高度）。
  判据只覆盖高度 ⇒ ✅ 成立，但记账要诚实。

✅ **已就手修掉的 Minor：M5 · M6 · M7**（都是「我自己写错的数字 / 我自己改动造成的死代码」，
不是新的打磨建议）。其余 6 条**未修**，等你圈。

### 审查者「查了但没找到」的部分（比找到什么更有信息量）

- **产物全域动画名配对：13 引用 / 13 定义 / 悬空 0** —— 逐文件脚本扫过 `out/_next/static/css/*.css`。
  旧的 `worksheet_spin__<hash>` 已不在产物里。
- 教师端**没有**任何地方依赖「disabled 时 opacity 为 1」，也**没有**会被 `translateY(1px)` 顶出接缝的 `.btn`。
- 新增/改动的每条 CSS 都有消费者，没有写错的选择器、没有死规则（`.classroom-management-toolbar` 除外，见 M7）。
- `--shell-slide-duration` 的继承链成立（层不是 portal，变量继承得到）。
- `#5` 状态点三态可达、`#3` 失败态与空态确实分开了。
- `spin` 的其它引用（`chat-panel.tsx` 等 9 处）都是**内联 style**、不经过 css-loader ⇒ 成立，不是悬空。

---

## 六、🔴 真机验收清单（本机一条都验不了，**已填 0**）

> 本机**没有浏览器驱动、没有 jsdom**（实测零命中）⇒ 下面每一条都只能你在真机上看。
> 与 M4a/M4b/M5a/M5b/M6a/M6c 那 **95 个已填 0 的槽位**是同一笔账，**不重复计入**。

- [ ] **未验证 · #2** —— 学生入口页：**刻意填错/留空**触发错误提示，量主按钮的
  `getBoundingClientRect().top`：提示出现前后**必须相同**（改前会差 ~13px）。
- [ ] **未验证 · #7** —— 老 iPad 上按学生首页的卡：**按下要跟手**（改前 160ms 才缩到位，像「按了没反应」）。
- [ ] **未验证 · #9** —— 切 Tab 时四次层动画的**手感**没变（时长仍是 240ms；本机只验到「四条同源」）。
- [ ] **未验证 · #10** —— 老 iPad 上**快速双击**切 Tab：第二次点击**不应**触发入场层里的按钮；
  并确认「滑到一半想反悔、点回原 Tab」**这条路还通**（这是本条的主要风险）。
- [ ] **未验证 · #12** —— 判分后奖励徽章是「**跳**出来」而不是「淡出来」（`rewardPop`）。
- [ ] **未验证 · #13** —— 点提交后按钮里那个圈**真的在转**（不是静态白点）。
  ⚠️ 修之前它**不会转**（悬空 `animation-name`）—— 所以这一条同时也在验那个修复。
- [ ] **未验证 · #16** —— 状态 chip / 选项选中态是**渐变**而不是瞬间跳（与同屏进度条同族）。
- [ ] **未验证 · #6** —— 空态卡看起来与同屏三张卡**是同一套语言**（不再是「虚线 = 出错了」）。
- [ ] **未验证 · #8（本轮没做）** —— 切 Tab 时提示条**不闪**。⚠️ 第 8 条**未实现**，先别照这条验。

### 独立审查修复后**新增**的待验项（4 条）

- [ ] **未验证 · #13/C1** —— **走「重新提交」那条路**（学习单开启 `allowResubmit` + 某题已提交过，
  按钮变成白底的「重新提交」）点它：那个**圈必须在白底上看得见**。
  ⚠️ 修之前它是**白底白圈、等于没加** —— 所以这一条同时也在验 C1 那个修复。
  主按钮（accent 底）那条路顺带一起看。
- [ ] **未验证 · #4/学生端** —— 学生扫码进入后那一屏（深色渐变底 +「正在连接课堂...」）
  上方**有一个白圈在转**。⚠️ 修之前那屏**只有两行字**（条目却挂着 ✅）。
- [ ] **未验证 · #15/I2** —— 排序题的 **▲/▼** 现在 44×44，手指按得准；
  并确认**撑高之后排序题的排版没有变难看**（这是这次补 44px 唯一可能变坏的地方）。
- [ ] **未验证 · #15/M9（未做，先看再定）** —— 提交按钮与重试按钮的**形状与字号**
  要不要对齐探究空间那份（实心 + 有按下反馈）。**我没改** —— 看不见界面时改按钮长相是盲改。
  你对照两边真机看一次，说要改我再改。
- [ ] **未验证 · M4（未修）** —— 学生身份选择页点「进入课堂」后（`joiningClassroom` 为真），
  按钮**应当看起来是禁用的**。现在它的内联 `opacity` 盖掉了 `.btn:disabled` 的 `.5`
  ⇒ 很可能**看着仍可点**。⚠️ 这是 #1 清掉的那个反模式在学生端的残留，**本轮没修**。
- [ ] **未验证 · M8（未修）** —— 旋转圈与「提交中…」三个字之间**有没有间隙**。
  现在没有 `gap` 也没有空白 ⇒ 12px 的圆应当**紧贴**第一个字。看着别扭我再补 `margin-right`。
