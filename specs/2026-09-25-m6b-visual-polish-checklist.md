# M6b · 「视觉打磨」的可判定清单（**待用户逐条圈选**）

> 日期：2026-09-25 · 分支 `main`（M6a 已并入，HEAD `7c55c78`）· 状态：**待用户圈选**
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
| ✅ **已做**（8/8） | 缺陷类全部完成 | **1 · 3 · 4 · 5 · 11 · 14 · 15 · 17** |
| ⚠️ **口味（等你圈）** | 「哪个更好看」——本机看不见界面 | 2 · 6 · 7 · 8 · 9 · 10 · 12 · 13 · 16 |
| ⚠️ **口味**（等你圈） | 「哪个更好看」——本机**看不见界面**，我做的每一次改动都无法区分是变好还是变坏 | 2 · 6 · 7 · 8 · 9 · 10 · 12 · 13 · 16 |

⚠️ **为什么口味那一类我不擅自做**：这批的整个问题就是「视觉打磨没有完成判据」。
在看不见屏幕的前提下按我的偏好改 9 处界面，产出的是一批**我无法证明它更好、你也无从复核**的改动 ——
那是「假绿」的另一种形状。你圈哪几条，我就做哪几条。

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

- [ ] **2. 错误提示是裸红字，且出现时把整张卡顶上去**
  · 现状：`src/app/page.tsx:173-175` 一行 `<p style={{ color: '#ef4444', ... }}>`，无底色无边无图标无 `role`。
    外层是 `justifyContent: 'center'` 的 100vh flex ⇒ 这行一插入**整卡内容上移约一半高度**。
    对照组：`identity-picker.tsx:147-151` 的错误条是 `#fef2f2` 底 + `#fca5a5` 边 + 圆角。
  · 建议：错误位做成**固定槽**（`min-height: 24px` 的容器，`<p>` 只负责显隐）+ 套用 identity-picker 那套底色描边 + `role="alert"`。
  · 怎么判断做成了：量按钮的 `getBoundingClientRect().top` —— 触发前后**必须相同**（现在会差 ~13px）。
  · 风险：`src/app/page.tsx` **不在**扫描根内，但它跑在老 iPad 上 ⇒ 自觉守同一套约束。

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

- [x] **5.（✅ 已做）学生入口页的服务状态点，在健康检查回来之前就报「服务在线」**
  · 现状：`src/app/page.tsx:18` `useState(true)` ⇒ **首帧就是绿点 + 「服务在线」**（`:106-110`）。
    失败后变红点，但文案写「连接中...」（`:109`）⇒ 出现「红点 + 连接中」两个互相矛盾的说法，
    而**「服务离线」这句话永远不可能出现**。
  · 建议：初值改 `null`（未知）⇒ 三态：未知（灰 `#94a3b8` +「正在检查服务...」）/ 在线 / 未连接。
    `.status-dot` 已有 online/offline 两个修饰类（`globals.css:264-276`），加一个 `.unknown` 即可。
  · 怎么判断做成了：首帧 DOM 上 `.status-dot` 既不含 `online` 也不含 `offline`；失败时文案恰为「服务未连接」。
  · 风险：极低。

- [ ] **6. 学生首页的空态用虚线占位框，与同屏三张卡不是一个语言**
  · 现状：`student-home.tsx:251` → `home.module.css:296-305`：`border: 1px dashed` + 灰底灰字居中。
    同屏三张卡是 solid + `border-left: 4px solid var(--card-accent)`（`:131-132`）。
    **虚线框读起来像「出错了」，而这句话其实是正常状态。**
  · 建议：换成与 `.card` 同族的实线卡（`1px solid #e6eaf2` + `border-left: 4px solid var(--card-accent)` + 白底）。
  · 怎么判断做成了：两者 `border-style` 都是 `solid`、`border-radius` 都是 `14px`（可 grep 比对）；
    「是否更像同一套」**只能真机看**。
  · 风险：低（只改颜色/边框，不碰任何 token）。

- [ ] **7. 卡片按下的回弹被 hover 用的 160ms 过渡拖慢**
  · 现状：`home.module.css:139` `.card { transition: transform .16s ease; }` **同时**作用于
    `:hover`（抬起）与 `:active`（`:163-165` 缩到 0.992）⇒ 手指按下后要 160ms 才缩到位，触屏上就是「按了没反应」。
  · 建议：加一条 `.card:active { transition-duration: 60ms; }`（抬起仍保留 160ms）。
  · 怎么判断做成了：**只能真机看**。
  · 风险：极低（`prefers-reduced-motion` 那块已经覆盖 `.card:active`）。

## 二、Tab 过渡（4 条）

- [ ] **8. 切 Tab 时提示条会闪一下（消失约 280ms 再出现）—— 代码注释自己记着这个现象**
  · 现状：`classroom-shell.tsx:316-322` 注释原话「切层时两层都会 `visibility:hidden` 约 240+40ms」。
    机制：提示条走 portal（`layer-overlays.tsx:34`），而层传的 `active` 是 `activate(id)` =
    `phase.front === key && phase.settled`（`classroom-shell.tsx:274`）⇒ 动画期间 `settled` 为假 ⇒ 被隐藏。
  · 建议：给 `useOverlayPortal` 加第二个参数 `visible`（默认取 `active`），**只对 toast** 传 `phase.front === key`。
    ⚠️ **不要动换头像弹窗** —— 它的 `active` 是刻意恒为真（`classroom-shell.tsx:341-346`）。
  · 怎么判断做成了：用 `MutationObserver` 记录 portal 包装层的 `style.visibility` —— **不应出现 `hidden`**。
  · 风险：中（必须保住「非前台层的浮层不得浮在上面」这条不变量；只放宽到 `front` 是安全的）。

- [ ] **9. 四条 240ms 是四个独立字面量，「必须一起改」只靠注释**
  · 现状：`shell.module.css:587-590` 四处硬编码 `240ms`，`:548-556` 的注释自己承认「没有任何机制强制它们相等」。
    **改其中一条不会报错、没有编译期信号。**
  · 建议：`.shell` 上加 `--shell-slide-duration: 240ms;`，四条动画改用它。
  · 怎么判断做成了：`grep -c "240ms" shell.module.css` 应为 **1**（只有变量定义处）。
    外壳一行不用改（已确认 `slideDurationMs` 的 `ms` 分支吃得下）。
  · 风险：中（改完必须验 `phase.settled` 仍在 ~280ms 翻真）。

- [ ] **10. 入场动画期间那一层可以点，而落点还在移动中**
  · 现状：`shell.module.css:589-590` 给两条**离场**动画加了 `pointer-events: none`，
    而 `:587-588` 的两条**入场**动画没有 ⇒ 这 240ms 里的 tap 会被一个正在位移的层接住。
  · 建议：给入场那两条也加 `pointer-events: none`（摘除时机不用写 JS —— `layerClass` 本来就用 `!phase.settled` 控制）。
  · 怎么判断做成了：**只能真机看**（真机上快速双击，第二次不应触发入场层里的按钮）；
    可辅以 DOM 断言（`settled` 为假时入场层 `pointerEvents === 'none'`）。
  · 风险：中（别把「滑到一半后悔、点回原 Tab」堵死；真机手感不对时的出路写在调研记录里）。

- [x] **11.（✅ 已做）`prefers-reduced-motion` 的「一条不漏」清单没有守护**
  · 现状：`shell.module.css:658-686` 手工列了 4 条动画 + 2 条过渡 + **5 个 `:active`**，
    文件自己说「必须一条不漏」。今天是对的，但**下次谁加一个带 `:active` 的按钮，不会有任何信号**。
  · 建议：**不加运行期代码**，只加一个纯字符串自检（本仓已有先例），断言「`:active` 选择器集合 == 降级块里的集合」。
  · 怎么判断做成了：故意加一个 `.foo:active` 而不加进降级块 ⇒ **测试必红**。
  · 风险：零。

## 三、作答反馈动效（5 条）

- [ ] **12. 🔴 奖励徽章「出现即显示」，零动效 —— 代码自己把这件事挂到了本批次**
  · 现状：`reward-badge.tsx:41` 原文「动画（星星飞入）属 **P3 视觉打磨**，第一批是静态图标 + 出现即显示」。
    `worksheet.module.css` 全文只有 2 条 `transition`、**0 个 `@keyframes`、0 个 `animation`**。
  · 建议：`.questionReward` 与 `.rewardTotal` 各接一条入场动画
    （`rewardPop`：`scale(.4)` → `1.18` → `1`，260ms，带回弹的 `cubic-bezier(.34,1.56,.64,1)`）。**只碰 transform/opacity。**
  · 怎么判断做成了：`grep -n "@keyframes rewardPop" worksheet.module.css` 有命中；
    DOM 上 `getComputedStyle().animationName === 'rewardPop'`。「跳出来 vs 淡出来」**只能真机看**。
  · 风险：低-中（🔴 **`dvh` 冻结为 3，这批一行都不许加**）。

- [ ] **13. 提交中只有文字变化，没有「正在网络里」的可见信号**
  · 现状：`worksheet-panel.tsx:310` 是 `{submitting[node.id] ? '提交中…' : ...}`，
    而 `.submitButton:disabled` 只降透明度 ⇒ 判分往返期间屏幕上只有半透明按钮 + 三个字。
  · 建议：在「提交中…」前加一个 12px 纯 CSS 旋转圈（**本文件自带一份 `spin`** ——
    教师端的「学生端预览」不经过 `classroom/page.tsx`，自带更稳）。
  · 怎么判断做成了：DOM 断言 —— 提交中时按钮内存在 `animation-name: spin` 的子元素。
  · 风险：低。

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

- [ ] **16. 状态 chip 与选项选中态都是瞬间跳变，而同屏的进度条是平滑的**
  · 现状：`.questionState` 三态只换颜色（无过渡）、`.optionSelected` 换边框底色也是瞬间，
    而同屏 `.progressFill` 有 `transition: width .25s` ⇒ **「进度条在动、状态字在跳」**。
  · 建议：各加 `transition: color .18s` / `transition: background-color .18s, border-color .18s`。
    ⚠️ 若想严格守「只用 transform/opacity」，替代方案是 180ms 的 `opacity + translateY(2px)` 入场。
  · 怎么判断做成了：`grep -n "transition" worksheet.module.css` 从 2 条涨到 4 条；
    「跳变 vs 渐变」**只能真机看**。
  · 风险：低（本文件已有 `background-color` 与 `width` 两条非 transform/opacity 过渡的先例 ⇒ 不算破例，
    但要在评审时说明这是**刻意的例外**，别让它扩散到外壳）。

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
