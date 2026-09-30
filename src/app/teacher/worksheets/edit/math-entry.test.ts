/**
 * ★ 2026-09-30：公式**入口**的位置、弹窗的收尾动作、以及题干下面那条预览的去留。
 *
 * 三轮教师裁定（逐轮记在这里，别再改回去）：
 *   ① 第一轮：Σ 挂题干工具栏，确认后「插入到光标处」。
 *   ② 第二轮：「这个图标要单独提取出来，**不能放在题干编辑框内**，因为它同样适用于选项公式
 *      的编辑…好了以后**也不要直接点『插入』**，而且提供『复制』按钮，这样用户就可以在
 *      **任何地方粘贴**公式了。」⇒ 入口搬到编辑页右下角悬浮；收尾改成复制。
 *   ③ 第三轮：「还是放回到编辑框的工具栏里边吧，否则觉得怪怪的。就在西格玛符号后面加上
 *      『数学公式』四个字就可以了，**其他功能不变**。」
 *      ⇒ 入口搬回工具栏（Σ + 「数学公式」四个字）；**复制那套一个字不动**。
 *      同时：「这个预览我觉得完全没有必要，因为用户可以在右上角点『预览』看到渲染后的
 *      结果」⇒ 题干下面那条常显预览删掉。
 *
 * 🔴 本仓没有 jsdom、没有浏览器 ⇒「点一下 Σ 会不会弹出弹窗」在本机**验不了**。
 *    这一条网能回答的只有一件事：**那几个零件在不在、谁接谁**。
 *    ⚠️ 它**不保证**观感、也不保证交互对（光标落点、按钮会不会抢走焦点）—— 那些只能真机走查。
 *
 * ⚠️ 断言一律先**剥掉 import 行**：`MathInsertDialog` / `mathMarkup` 这些名字
 *    **本来就出现在 import 里**，不剥的话「把调用点整个删掉、只留一行 import」照样绿。
 *    这个坑 `worksheet-prompt-text.test.ts` 已经踩过一次（那里有一整段注释记着）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EDITOR = fs.readFileSync(path.join(HERE, 'prompt-editor.tsx'), 'utf8');
const DIALOG = fs.readFileSync(path.join(HERE, 'math-insert-dialog.tsx'), 'utf8');
const PAGE = fs.readFileSync(path.join(HERE, 'page.tsx'), 'utf8');
const CARD = fs.readFileSync(path.join(HERE, 'question-card.tsx'), 'utf8');
const GLOBALS = path.resolve(HERE, '../../../../app/globals.css');

/** 块注释（含 JSX 的 `{/* … *\/}`）与整行 `//` 注释。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * 连 `import` 行也剥掉（理由见文件头）。
 * ⚠️ 按行剥，假设这几个文件的 import 都是**单行**（今天都是）。
 */
function stripImports(source: string): string {
  return source.split('\n').filter((line) => !/^\s*import\b/.test(line)).join('\n');
}

const body = (source: string) => stripImports(stripComments(source));

test('★ Σ 住在题干工具栏里，右边写着「数学公式」（教师第三轮：放回去）', () => {
  const editor = body(EDITOR);
  // 阳性对照：剥完之后剩下的仍是这个组件，不是一段空壳（否则下面几句对空串永远绿）。
  assert.ok(editor.length > 500, '剥 import 与注释之后剩下的仍是编辑器组件');
  assert.ok(editor.includes('worksheet-editor-math-glyph'), '工具栏上没有 Σ');
  // 🔴 教师原话：「就在西格玛符号后面加上『数学公式』四个字就可以了」。
  //    旁边那个「粘贴题目」也是图标 + 文字 —— 这一条让它俩长得是一类东西。
  // ⚠️ **只看那个按钮本身**（从 Σ 那个字形到它的 `</button>`）：`数学公式` 四个字在
  //    同一行的 `aria-label` 里也有一份，查整个文件的话「把按钮上看得见的那四个字删掉」
  //    照样绿 —— 而那正是教师唯一能看到的那一份。变异检验实测抓出来的假绿。
  const glyphAt = editor.indexOf('worksheet-editor-math-glyph');
  const mathButton = editor.slice(glyphAt, editor.indexOf('</button>', glyphAt));
  assert.ok(mathButton.includes('数学公式'), 'Σ 右边没有「数学公式」四个字（看得见的那四个）');
  assert.ok(editor.includes('MathInsertDialog'), '弹窗没有挂上去');
  assert.ok(editor.includes('mathOpen'), '没有开合弹窗的状态');
  // ⚠️ 它要落在**「插入题目内容」那一组**里（与粘贴题目 / 填空域 / 图片同一组），
  //    不是文字格式那一组 —— 放错组只影响观感，但那是本次返工的全部内容。
  const insertGroup = editor.slice(editor.indexOf('is-insert'));
  assert.ok(insertGroup.includes('worksheet-editor-math-glyph'), 'Σ 没有放在「插入题目内容」那一组');
  // 🔴 反面：这一页**不许**自己调 KaTeX —— 公式渲染全仓只有 `MathSpan` 一处实现。
  assert.equal((editor.match(/katex\.renderToString/g) ?? []).length, 0,
    'prompt-editor 里直接调了 KaTeX —— 应该走 MathSpan');
});

test('★ 右下角那个悬浮按钮已经拆了（教师第三轮：放回工具栏，否则觉得怪怪的）', () => {
  // 🔴 反面断言：拆干净 —— 组件、挂载点、CSS 类三处都不能留。
  //    半拆的症状是「屏幕上多一个莫名其妙的圆钮」，而构建与 tsc 全都不报错。
  assert.ok(!body(EDITOR).includes('MathFormulaButton'), '题干编辑器里还挂着悬浮按钮');
  assert.ok(!body(PAGE).includes('MathFormulaButton'), '编辑页上还挂着悬浮的 Σ');
  assert.ok(!body(DIALOG).includes('MathFormulaButton'), '悬浮按钮那个组件还在');
  assert.ok(!fs.readFileSync(GLOBALS, 'utf8').includes('.worksheet-editor-math-fab'),
    'globals.css 里还留着悬浮按钮的样式（死样式）');
});

test('★ 题干下面那条常显预览已经删了（教师第三轮）', () => {
  // 教师原话：「这个预览我觉得完全没有必要，因为用户可以在右上角点『预览』看到渲染后的
  // 结果」。⇒ 删干净：JSX 与 CSS 都不留。
  assert.ok(!body(EDITOR).includes('worksheet-editor-math-preview'), '题干下面的常显预览还在');
  assert.ok(!fs.readFileSync(GLOBALS, 'utf8').includes('.worksheet-editor-math-preview'),
    'globals.css 里还留着预览的样式（死样式）');
  // ⚠️ 删的是**那一条预览**，不是渲染本身 —— 右上角那个「预览」弹窗照旧（它渲染整份学习单）。
  assert.ok(body(PAGE).includes('WorksheetPreviewModal'), '别把右上角那个「预览」弹窗一起删了');
});

test('★ 弹窗底部只有「复制」和「关闭」，没有「插入」（教师第二轮，未被第三轮推翻）', () => {
  const dialog = body(DIALOG);
  // ⚠️ 只看**底部那一块**（从 footer 那个类名到文件末尾）：`插入公式` 是弹窗标题，
  //    查整个文件的话这条网当场失效（假绿）。
  const foot = dialog.slice(dialog.indexOf('worksheet-editor-math-foot'));
  assert.ok(foot.includes('worksheet-editor-math-foot'), '找不到弹窗底部那一块');
  assert.match(foot, /复制\s*<\/button>/, '底部没有「复制」按钮');
  assert.match(foot, /关闭\s*<\/button>/, '底部没有「关闭」按钮');
  assert.doesNotMatch(foot, /插入\s*<\/button>/, '底部还留着一个「插入」按钮 —— 教师裁定是只留复制');
  assert.equal((foot.match(/className="btn /g) ?? []).length, 2, '底部应当正好两个按钮');
  // 🔴 复制的那一串必须由 `mathMarkup` 给（它是 `splitMath` 的写那一半，有用例、
  //    有对拍）—— 在组件里自己拼 `'$' + tex + '$'` 就是本仓最防的第二份真源。
  assert.ok(dialog.includes('mathMarkup('), '复制的内容不是 mathMarkup 给的');
  // 🔴 **复制之后必须关掉弹窗**：不关它盖着整页，教师**点不到**要粘贴的那个输入框，
  //    而这一整套流程的全部价值就是「复制完去任何地方粘」。
  // ⚠️ **只看 `copy` 那个函数的函数体**：`onClose()` 在这个文件里还有几处
  //（Esc、底部那个按钮）—— 查整个文件的话，「把复制之后那一句删掉」照样绿。
  // 变异检验实测抓出来的假绿，第一版就是这么写的。
  const copyAt = dialog.indexOf('const copy = async ()');
  assert.ok(copyAt >= 0, '找不到 copy 函数');
  const copyBody = dialog.slice(copyAt, dialog.indexOf('\n  };', copyAt));
  assert.ok(copyBody.includes('onClose()'), '复制之后没有关掉弹窗');
  // 🔴 `navigator.clipboard` 只在**安全上下文**（https / localhost）里存在。
  //    教师完全可能从局域网地址打开编辑页 —— 只走那一条会当场抛异常，
  //    而这个功能的全部价值就是那一次复制。
  assert.ok(dialog.includes('execCommand'), '没有 execCommand 那条退路（局域网 http 下复制会静默失效）');
});

test('★ 复制成功那句话要弹得出来（onNotice 从编辑页一路传到弹窗）', () => {
  // 🔴 第三轮把入口搬回工具栏之后，弹窗住在 `prompt-editor.tsx` 里 ——
  //    而 toast 在**编辑页**那一层。这条链路断了的症状是「复制成功了一声不吭」，
  //    屏幕上看不出哪里不对（克隆出来的代码照样编译、照样跑）。
  assert.ok(body(PAGE).includes('onNotice={notify}'), '编辑页没有把 notice 交给题目卡');
  // ⚠️ **只看 `<PromptEditor` 那一段**：`onNotice` 在题目卡里还有**类型声明**与**解构**
  //    两处，查整个文件的话「把往下传的那一行删掉」照样绿 —— 而断的正是那一行。
  //    变异检验实测抓出来的假绿。
  const card = body(CARD);
  const peAt = card.indexOf('<PromptEditor');
  assert.ok(peAt >= 0, '题目卡里找不到 <PromptEditor');
  const peMount = card.slice(peAt, card.indexOf('/>', peAt));
  assert.ok(peMount.includes('onNotice={onNotice}'), '题目卡没有把 notice 转给题干编辑器');
  const editor = body(EDITOR);
  assert.ok(editor.includes('onNotice'), '题干编辑器没有接 notice');
  const at = editor.indexOf('<MathInsertDialog');
  assert.ok(at >= 0, '找不到弹窗的挂载点');
  const mount = editor.slice(at, editor.indexOf('/>', at));
  assert.ok(mount.includes('onCopied'), '弹窗的 onCopied 没接上');
  assert.ok(mount.includes('onNotice'), '复制成功的提示没有接到页面的 toast 上');
});

test('★ 弹窗里那排符号是**分组**画的，且走的是那张表', () => {
  const dialog = body(DIALOG);
  // ⚠️ 只看**画符号那一段**（`symbolGroups` 那个 `useMemo`）：`MathSpan` 在预览区也有
  //    一处 ⇒ 查整个文件的话，「把符号区整个摘掉」照样绿（变异检验抓出来的第二条假绿，
  //    上一版就栽在这里；改成 memo 之后位置又变了一回，跟着断言一起挪）。
  const at = dialog.indexOf('const symbolGroups = useMemo(');
  assert.ok(at >= 0, '找不到画符号那一段');
  const symbols = dialog.slice(at, dialog.indexOf('worksheet-editor-math-foot', at));
  assert.ok(symbols.includes('MATH_SYMBOL_GROUPS.map('), '符号不是从 math-symbols 那张表里来的');
  assert.ok(symbols.includes('MathSpan'), '符号按钮上没画符号');
  // 图标按钮必须有说明（`title` + `aria-label` 同一句话）。
  assert.ok(symbols.includes('aria-label={symbol.title}'), '符号按钮没有 aria-label');
  assert.ok(symbols.includes('title={symbol.title}'), '符号按钮没有悬停说明');
  // 🔴 而它得**真的被渲染出来**：抽了个 memo 却没人用 = 教师一个符号也看不到，
  //    而上面那几句全都绿（它们只看「画法对不对」）。
  assert.ok(dialog.includes('{symbolGroups}'), '算出来的符号没有被渲染出来');
});

test('★ 预览走 MathSpan，且源码框里已被 `$…$` 包好时按里面那段画', () => {
  const dialog = body(DIALOG);
  // 🔴 这一页**不许**自己调 KaTeX（公式渲染全仓只有 `MathSpan` 一处实现）。
  assert.equal((dialog.match(/katex\.renderToString/g) ?? []).length, 0,
    'math-insert-dialog 里直接调了 KaTeX —— 应该走 MathSpan');
  const pv = dialog.indexOf('worksheet-editor-math-effect-view');
  assert.ok(pv >= 0, '弹窗里没有预览区');
  // ⚠️ 只看**预览区那一段**（到符号区为止）：`MathSpan` 在符号按钮上也有一处 ⇒
  //    查整个文件的话，「把预览整个摘掉」照样绿（上一版就是栽在这条假绿上）。
  const pvEnd = dialog.indexOf('worksheet-editor-math-symbols', pv);
  assert.ok(pvEnd > pv, '找不到符号区（预览区与符号区的顺序变了？）');
  assert.ok(dialog.slice(pv, pvEnd).includes('MathSpan'), '弹窗的预览区里没有 MathSpan（打错了看不见）');
  // 🔴 教师从别处粘进来的源码常**自带定界符**（`$x^2$`）。拿它直接喂 KaTeX 会画出
  //    一个红色错误标记，而「复制」给出的那一串其实是对的 ⇒ 两边打脸。
  //    ⇒ 预览前先用 `splitMath` 判一下「整串是不是一段公式」，是就剥掉那一层。
  assert.ok(dialog.includes('splitMath('), '预览没有剥掉源码里自带的定界符');
});
