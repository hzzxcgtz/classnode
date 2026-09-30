/**
 * 教师用卷的**渲染层**（★ 2026-09-30）。
 *
 * 🔴 这一层本机验不了（没有 Word），而它最容易出的两种错**都在「打不开」那一侧**：
 *   · 生成的 zip 不合法 ⇒ Word 说「文件已损坏」；
 *   · 文本里的 `&` / `<` 没转义 ⇒ XML 非法 ⇒ 同样打不开（而屏幕上/日志里什么都不报）。
 * 所以这条用例做两件事：① 生成物是**合法 docx**（zip 里有 `word/document.xml`）；
 * ② **把 zip 解开、在 XML 里核几个字** —— 后者是这条用例比「按学生的作答报告」那条
 * smoke 多走的一步（那条的注释写着「要验内容得解 docx 的 zip，那是另一回事」）。
 *
 * ⚠️ 内容对不对**不靠这里**：纸上写什么由 `worksheet-paper.test.ts` 的 15 条判据盯着。
 *    这里只核**渲染层有没有把它画丢**（少一段、少一个答案、转义坏掉）。
 * ⚠️ 解 zip 用系统的 `unzip`。没装 `unzip` 的机器上**跳过**内容那一半并**打印一行**
 *    （不静默跳过：静默的跳过正是本仓最防的「假绿」）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildWorksheetPaperDocx, paperFilename } from '../services/worksheet-paper-docx.js';
import type { WorksheetPaper } from '../services/worksheet-paper.js';
import { splitMath } from '../services/worksheet-math.js';
import type { PaperInline } from '../services/worksheet-paper.js';

/**
 * 夹具助手：一串文字 → **行内部件**（★ 2026-09-30，`body` / `answer` / 表格单元格
 * 从 `string` 改成了部件数组）。
 * 🔴 它走**真实**的 `splitMath`，不是手搓 `[{ kind:'text', … }]` —— 这样夹具里
 *    写 `P('计算 $x^2$ 的值')` 就真的能测到公式，而不是自己造一个假的形状。
 */
const P = (text: string): PaperInline[] => splitMath(text);

const SAMPLE: WorksheetPaper = {
  title: '第三课练习',
  description: '完成后一起讲评',
  questionCount: 2,
  blocks: [
    { kind: 'task', title: '任务一', description: '读下面的材料' },
    {
      kind: 'question',
      question: {
        // ⚠️ 夹具里的 `meta` 是**判据层的产物**（那层决定印别名还是正式名，见 worksheet-paper.test.ts）；
        //    渲染层只负责「把它画上去」，所以这里直接给一个别名，钉住它没被丢掉。
        heading: '任务一 · 1', meta: '慧眼选择 · 2 分',
        prompt: [{ kind: 'text', text: '下列词语中，书写完全正确的一项是（  ）。' }],
        body: ['A 慈祥', 'B 爱幕', 'C 攀登'].map(P),
        answer: P('C 攀登'), answerNote: null,
      },
    },
    {
      kind: 'question',
      question: {
        heading: '任务一 · 2', meta: '排序题 · 2 分',
        prompt: [{ kind: 'text', text: '把下面的句子按顺序排列。' }],
        body: ['1 老师先讲解了乘船安全事项。', '2 小船离岸，向湖心驶去。'].map(P),
        answer: P('2 → 1'), answerNote: null,
      },
    },
  ],
};

/** 有没有 `unzip`（没有就只跑「打得开」那一半，并打印一行说明）。 */
function hasUnzip(): boolean {
  try { execFileSync('unzip', ['-v'], { stdio: 'pipe' }); return true; } catch { return false; }
}

async function writeTemp(paper: WorksheetPaper): Promise<string> {
  const buffer = await buildWorksheetPaperDocx(paper);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-paper-'));
  const file = path.join(dir, 'paper.docx');
  fs.writeFileSync(file, buffer);
  return file;
}

/** 解开 docx 读 `word/document.xml`。 */
function readDocumentXml(file: string): string {
  return execFileSync('unzip', ['-p', file, 'word/document.xml'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

test('🔴 生成的是一份**合法的 docx**（zip 里有 word/document.xml）', async () => {
  const file = await writeTemp(SAMPLE);
  const head = fs.readFileSync(file).subarray(0, 2).toString('latin1');
  assert.equal(head, 'PK', 'docx 就是 zip ⇒ 头两个字节必须是 PK');
  if (!hasUnzip()) {
    console.log('⚠️ 本机没有 unzip ⇒ 跳过「解开核字」那一半（内容正确性由 worksheet-paper.test.ts 盯着）');
    return;
  }
  const list = execFileSync('unzip', ['-l', file], { encoding: 'utf8' });
  assert.match(list, /word\/document\.xml/);
});

test('🔴 渲染层把判据层的内容**画上去了**（题号 / 选项 / 答案 / 任务标题都在 XML 里）', async () => {
  if (!hasUnzip()) { console.log('⚠️ 本机没有 unzip ⇒ 跳过本条'); return; }
  const xml = readDocumentXml(await writeTemp(SAMPLE));
  for (const expected of [
    '第三课练习',            // 标题
    '2 道题',                // 副标题只剩题数（教师：「最上面不要写教师用卷」）
    '慧眼选择',              // 题型印**别名**（教师：「题型使用别名，例如开心填空」）
    '任务一',                // 任务块
    '读下面的材料',           // 任务的说明
    '任务一 · 1',            // 题号（`flattenAnswerable` 的两级号）
    '慧眼选择 · 2 分',
    '下列词语中，书写完全正确的一项是（  ）。',
    'A 慈祥', 'B 爱幕', 'C 攀登',
    '答案：',                // 加粗的那三个字
    'C 攀登',                // 答案本体
    '2 → 1',                 // 排序题的答案
  ]) {
    assert.ok(xml.includes(expected), `document.xml 里没有「${expected}」`);
  }
  // ★ 2026-09-30：① 顶上**不许**再出现「教师用卷」那四个字（教师明确要去掉）；
  //              ② 答案用**暗红色**（`934E4E`），正文一律纯黑。
  assert.ok(!xml.includes('教师用卷'), '顶上还写着「教师用卷」');
  assert.ok(xml.includes('934E4E'), '答案没有用暗红色');
  assert.ok(xml.includes('000000'), '正文不是纯黑（教师：「颜色使用纯黑」）');

  // 反面：绘图题那种「没有答案」的情形**不许**印出一个空的「答案：」——
  // 判据层用 `answerNote` 表达它，渲染层要照着分开画（这条用例钉的是渲染层这一半）。
  const withNote = await writeTemp({
    ...SAMPLE,
    questionCount: 1,
    blocks: [{ kind: 'question', question: { heading: '1', meta: '绘图题 · 3 分', prompt: [{ kind: 'text', text: '画出实验装置' }], body: [], answer: [], answerNote: '（绘图题：答案在学生画的那张图上，请在教师端查看）' } }],
  });
  const noteXml = readDocumentXml(withNote);
  assert.ok(noteXml.includes('请在教师端查看'), '答案说明没画上去');
  assert.ok(!noteXml.includes('答案：'), '有 answerNote 时**不许**再画一个空的「答案：」');
});

test('🔴 表格必须画成 **Word 里的真表格**（`<w:tbl>`），不是 `|` 分隔的文字', async () => {
  // 教师原话：「下方的表格要用 Word 里的真表格」——原来那份是把表格折成
  // `时间 | 上午 | 下午` 那样的纯文本行，教师一眼就说难看。
  if (!hasUnzip()) { console.log('⚠️ 本机没有 unzip ⇒ 跳过本条'); return; }
  const file = await writeTemp({
    ...SAMPLE,
    questionCount: 1,
    blocks: [{
      kind: 'question',
      question: {
        heading: '1', meta: '开心填空 · 2 分',
        prompt: [
          { kind: 'text', text: '看表填空：' },
          { kind: 'table', rows: [
            [{ text: P('时间'), blank: false }, { text: P('安排'), blank: false }],
            [{ text: P('周六'), blank: false }, { text: P(''), blank: true }],
          ] },
        ],
        body: [], answer: P('①借书'), answerNote: null,
      },
    }],
  });
  const xml = readDocumentXml(file);
  assert.ok(xml.includes('<w:tbl>'), '没有真表格（`<w:tbl>`）—— 是不是又画成段落了？');
  assert.ok(xml.includes('<w:tc>'), '没有表格单元格（`<w:tc>`）');
  for (const expected of ['时间', '安排', '周六', '看表填空：', '答案：']) {
    assert.ok(xml.includes(expected), `表格里/题面上没有「${expected}」`);
  }
  // 空格子画的是那串下划线（不是留白）：留白打印出来只是一个空方框，分不清
  //「这一格要填」与「这一格本来就没内容」。
  assert.ok(xml.includes('________'), '空格子里没有印下划线');
  // 反面：**不许**再出现 `|` 那种折行投影（那是旧写法，两处并存最糟）。
  assert.ok(!xml.includes('时间 | 安排'), '表格又被折成纯文本行了');
});

test('🔴 文本里的 `&` / `<` 必须被转义（不转义 ⇒ Word 直接报文件损坏）', async () => {
  if (!hasUnzip()) { console.log('⚠️ 本机没有 unzip ⇒ 跳过本条'); return; }
  const file = await writeTemp({
    ...SAMPLE,
    title: 'A & B <测试>',
    questionCount: 1,
    blocks: [{ kind: 'question', question: { heading: '1', meta: '问答题 · 1 分', prompt: [{ kind: 'text', text: 'a < b & c > d' }], body: [], answer: P('x & y'), answerNote: null } }],
  });
  const xml = readDocumentXml(file);
  // 转义之后是 `&amp;` / `&lt;` / `&gt;`；**没转义**的裸字符会让 XML 非法。
  assert.ok(xml.includes('A &amp; B &lt;测试&gt;'), '标题里的 & < > 没有正确转义');
  assert.ok(xml.includes('a &lt; b &amp; c &gt; d'), '题干里的 & < > 没有正确转义');
  assert.ok(xml.includes('x &amp; y'), '答案里的 & 没有正确转义');
  // 反面：**裸的** ` & ` 不该出现（它正是让 Word 报损坏的那种）。
  assert.ok(!/(^|[^&])& /.test(xml.replace(/&amp;/g, '§')), 'XML 里出现了没转义的裸 &');
});

test('文件名：去掉各系统不认的字符，并带上「教师用卷」与时间戳', () => {
  assert.equal(paperFilename('第三课练习', '2026-09-30_12-05-00'), '第三课练习-教师用卷-2026-09-30_12-05-00.docx');
  assert.equal(paperFilename('a/b:c*d?e"f<g>h|i', 'T'), 'a_b_c_d_e_f_g_h_i-教师用卷-T.docx');
  // 空标题兜底（库里可能有空标题的行）。
  assert.equal(paperFilename('', 'T'), '未命名学习单-教师用卷-T.docx');
});

// ---------------------------------------------------------------------------
// ★ 2026-09-30：数学公式 → 真 Word 公式（OMML）
// ---------------------------------------------------------------------------

test('🔴 公式画成真 Word 公式（`<m:oMath>`），上标 / 分数 / 根号的结构都在', async () => {
  if (!hasUnzip()) { console.log('⚠️ 本机没有 unzip ⇒ 跳过本条'); return; }
  const file = await writeTemp({
    ...SAMPLE,
    questionCount: 1,
    blocks: [{ kind: 'question', question: {
      heading: '1', meta: '开心填空 · 2 分',
      prompt: P('化简 $x^2+\\frac{1}{2}+\\sqrt{y}$ 的值。'),
      body: [], answer: P('$x=5$'), answerNote: null,
    } }],
  });
  const xml = readDocumentXml(file);
  assert.ok(xml.includes('<m:oMath'), '没有 OMML 公式 —— 是不是当普通文字印了？');
  assert.ok(xml.includes('<m:sSup'), '上标结构不在（`x^2` 没转成真公式）');
  assert.ok(xml.includes('<m:f>'), '分数结构不在');
  assert.ok(xml.includes('<m:rad'), '根号结构不在');
  // 🔴 反面：**不许**把公式当纯文字原样印出来（那是「转换静默失败」的样子）
  assert.ok(!xml.includes('$x^2'), '公式被当成了纯文字（原样印了源码）');
  assert.ok(!xml.includes('$x=5$'), '答案里的公式被当成了纯文字');
  // 前后那些**普通文字**必须还在（别为了画公式把整段吃掉了）
  assert.ok(xml.includes('化简'), '公式前面的文字没了');
  assert.ok(xml.includes('的值'), '公式后面的文字没了');
});

test('🔴 认不出的 LaTeX 如实降级成源码，**不许**印一个空白', async () => {
  if (!hasUnzip()) { console.log('⚠️ 本机没有 unzip ⇒ 跳过本条'); return; }
  const file = await writeTemp({
    ...SAMPLE,
    questionCount: 1,
    blocks: [{ kind: 'question', question: {
      heading: '1', meta: '开心填空 · 1 分',
      // 这个 LaTeX 是坏的（`{` 没闭合）⇒ KaTeX 抛 ⇒ `mathRun` 返回 null ⇒ 降级。
      prompt: P('$\\thisIsNotACommand{$'), body: [], answer: [], answerNote: null,
    } }],
  });
  const xml = readDocumentXml(file);
  // 🔴 判据是**源码印出来了**。印空白的话教师看到的是「这里本来就没内容」——
  //    与「这里本该是个公式、但没转成功」是两件事，不能混。
  assert.ok(xml.includes('thisIsNotACommand'), '降级时把公式整个丢了（印了空白）');
});

test('🔴 公式里的 `<` `>` `&` 必须被转义（不转义 ⇒ Word 报文件损坏）', async () => {
  if (!hasUnzip()) { console.log('⚠️ 本机没有 unzip ⇒ 跳过本条'); return; }
  // 🔴 这一条**必须自己拉网**：公式走的是 `ImportedXmlComponent.fromXmlString(omml)`，
  //    那是**原始 XML** —— 转义由 `mathml2omml` 负责，不像 `TextRun` 由 docx 库自己转义。
  //    不转义 ⇒ XML 非法 ⇒ Word 直接说「文件已损坏」，而屏幕上什么都不报。
  const file = await writeTemp({
    ...SAMPLE,
    questionCount: 1,
    blocks: [{ kind: 'question', question: {
      heading: '1', meta: '开心填空 · 1 分',
      prompt: P('比较 $a<b$ 与 $x \\& y$ 的大小'),
      body: [], answer: [], answerNote: null,
    } }],
  });
  const xml = readDocumentXml(file);
  assert.ok(xml.includes('<m:oMath'), '没有 OMML');
  // 🔴 **这两个公式都必须真的转成功**，不许走「降级成源码」那条路。
  //    这条断言是变异检验逼出来的：去掉 `&` 的转义之后 XML 会非法 ⇒ `fromXmlString` 抛 ⇒
  //    `mathRun` 降级 ⇒ 纸上印 `$x \& y$` 的**源码** ⇒ 而源码走的是 `TextRun`（docx 自己
  //    转义）⇒ 下面那两条「不许有裸 & / 裸尖括号」**照样绿**。没有这一条就是假绿。
  assert.ok(!xml.includes('\\&'), '含 `&` 的公式降级了（说明它的 XML 非法 ⇒ 转义没生效）');
  assert.ok(!xml.includes('$a<b$'), '含 `<` 的公式降级了（同上）');
  // 判据：把标签剥掉之后，**文本内容里**不许再有裸的尖括号。
  const textOnly = xml.replace(/<[^>]*>/g, '');
  assert.ok(!/[<>]/.test(textOnly), `XML 文本里出现了没转义的裸尖括号：${textOnly.slice(0, 120)}`);
  // `&` 同既有那条的判据：遮掉合法实体之后不许再有裸 `&`。
  assert.ok(!/(^|[^&])&(?![a-z]+;|#)/.test(xml.replace(/&amp;/g, '§')), 'XML 里出现了没转义的裸 &');
});

test('🔴 n 元算符之后的**裸文本**也要转义（`escapeMathText` 不能只看 `<m:t>`）', async () => {
  if (!hasUnzip()) { console.log('⚠️ 本机没有 unzip ⇒ 跳过本条'); return; }
  // 🔴 `mathml2omml@0.5` 在 n 元算符（`\int` / `\sum`）之后会把 `<m:e>` 里的**后续兄弟节点
  //    原样拼在标签外**：`\int_0^1 f(a<b)dx` ⇒ `<m:e><m:r><m:t>f</m:t></m:r>(a<b)dx</m:e>`
  //    —— 那段 `(a<b)dx` 的 `<` **不经过 `<m:t>`**。
  // ⇒ 只转 `<m:t>` 的实现会漏掉它 ⇒ XML 非法 ⇒ 整个公式降级成源码印在纸上。
  const file = await writeTemp({
    ...SAMPLE,
    questionCount: 1,
    blocks: [{ kind: 'question', question: {
      heading: '1', meta: '开心填空 · 1 分',
      prompt: P('求 $\\int_0^1 f(a<b)dx$ 的值'), body: [], answer: [], answerNote: null,
    } }],
  });
  const xml = readDocumentXml(file);
  assert.ok(xml.includes('<m:oMath'), '没有 OMML —— 说明它降级了（那段裸文本让 XML 非法）');
  assert.ok(!xml.includes('\\int'), '公式降级成了源码');
  // 判据与上一条同源：剥掉标签之后，文本内容里不许有裸的尖括号。
  const textOnly = xml.replace(/<[^>]*>/g, '');
  assert.ok(!/[<>]/.test(textOnly), `XML 文本里出现了没转义的裸尖括号：${textOnly.slice(0, 120)}`);
  // 阳性对照：那段的文字必须**还在**（别为了转义把内容吃了）
  assert.ok(xml.includes('f'), '公式里的内容被吃掉了');
});
