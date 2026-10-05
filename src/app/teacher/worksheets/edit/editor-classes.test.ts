/**
 * ★ 2026-09-25：**编辑页用到的每一个 `.worksheet-editor-*` 类，都必须在 `globals.css` 里有定义。**
 *
 * 🔴 它为什么存在 —— 教师当天报的原话：「这个给分框太大了，而且不美观」。
 * 真因不是「太大」，是**那四个类名一个都没有定义**：`question-card.tsx` 里写着
 * `className="worksheet-editor-points-field"`，而 `globals.css` 里搜不到它 ⇒
 * 那两个 `<input>` 只拿到 `.input { width: 100% }` ⇒ 撑满整行。**全程无报错**：
 * JSX 里看得见类名、构建退出 0、`tsc` 退出 0，屏幕上只是「长得不对」。
 *
 * 这与 `src/lib/css-module-class-reference.test.ts` 是**同一族失效的另外一半**：
 * 那一条守的是 **CSS 模块**（`styles.X` 求值是 `undefined`），而这一页用的是
 * `globals.css` 的**全局类名**（拼错 / 忘了写 / 改名只改一边 ⇒ 那个元素零样式）。
 * 两处都很久没有网，而全局类名这一半**连一层类型检查都没有**。
 *
 * ⚠️ 只读文本、不渲染任何东西 ⇒ 本机（无 jsdom、无浏览器）跑得起来。
 * ⚠️ 它**不查样式对不对、好不好看** —— 那只能在真机上看。它只回答一个问题：
 * **这个名字有没有人给它写过样式。**
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));          // …/worksheets/edit
const EDITOR_DIR = HERE;
const GLOBALS_CSS = path.resolve(HERE, '../../../../app/globals.css');

/** 这一页自己的前缀。别的页面的类不归这条网管（它们的定义在别处）。 */
const PREFIX = 'worksheet-editor-';

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(full));
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** 从 `className=…` 的三种写法（普通串 / 模板串 / 表达式）里抠出类名。 */
function editorClassesIn(source: string): Set<string> {
  const found = new Set<string>();
  const attribute = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{([^}]*)\})/g;
  for (const match of source.matchAll(attribute)) {
    const blob = match[1] ?? match[2] ?? match[3] ?? '';
    for (const name of blob.matchAll(new RegExp(`${PREFIX}[a-z0-9-]+`, 'g'))) found.add(name[0]);
  }
  return found;
}

test('🔴 编辑页用到的每个 `.worksheet-editor-*` 都在 globals.css 里有定义', () => {
  const used = new Set<string>();
  for (const file of tsxFiles(EDITOR_DIR)) {
    for (const name of editorClassesIn(fs.readFileSync(file, 'utf8'))) used.add(name);
  }
  const css = fs.readFileSync(GLOBALS_CSS, 'utf8');
  const defined = new Set([...css.matchAll(new RegExp(`\\.(${PREFIX}[a-z0-9-]+)`, 'g'))].map((m) => m[1]));

  const missing = [...used].filter((name) => !defined.has(name)).sort();
  assert.deepEqual(
    missing, [],
    `这些类名在 JSX 里用了、globals.css 里却没有定义 ⇒ 那些元素**一点样式都没有**（且不报错）：\n  ${missing.join('\n  ')}`,
  );
});

test('阳性对照：这条网真的看得见类名（否则上面那条对空集合永远绿）', () => {
  assert.ok(editorClassesIn('<div className="worksheet-editor-question" />').has('worksheet-editor-question'));
  // 模板串与表达式两种写法也要抠得到 —— 漏了它们，网就只挡住最朴素的那种写法。
  assert.ok(editorClassesIn('<i className={`worksheet-editor-add ${x}`} />').has('worksheet-editor-add'));
  assert.ok(editorClassesIn("<i className={active ? 'worksheet-editor-question' : ''} />").has('worksheet-editor-question'));
  // 而它不该把别的类误算进来。
  assert.equal(editorClassesIn('<i className="btn is-danger" />').size, 0);
});

test('选择填空的待选词设置固定在题干之后、自动评分之前', () => {
  const source = fs.readFileSync(path.join(EDITOR_DIR, 'question-card.tsx'), 'utf8');
  const prompt = source.indexOf('<PromptEditor');
  const choiceSetup = source.indexOf('<ChoiceBlankSetup');
  // ★ 2026-09-27：这个锚点原来认的是 `is-mode`（「自动评分」自成一卡时那个类）。
  // 教师随后说「中间不要分隔，在一个大窗口里」⇒ 开关与设置合成一张卡、`is-mode` 删掉。
  // ⇒ 锚点改认**那张卡的标题**：类名会随排版改名，而「谁在谁前面」这件事是绑在
  //   「题干 / 作答方式 / 自动评分」这三个**区域**上的，标题比类名稳。
  const gradingMode = source.indexOf('<h3>自动评分</h3>');

  assert.ok(prompt >= 0 && choiceSetup >= 0 && gradingMode >= 0, '三个区域都必须存在');
  assert.ok(prompt < choiceSetup, '待选词设置必须紧跟在题干编辑之后');
  assert.ok(choiceSetup < gradingMode, '待选词设置必须位于自动评分之前');
});

test('聚焦编辑器在同一页连续显示题目内容与评分设置', () => {
  const source = fs.readFileSync(path.join(EDITOR_DIR, 'question-card.tsx'), 'utf8');

  assert.doesNotMatch(source, /worksheet-editor-panel-tabs/, '整页编辑不应再出现页签导航');
  assert.doesNotMatch(source, /activeEditorPanel/, '整页编辑不应保留页签状态');
  assert.match(source, /题目与作答/, '题目编辑区域必须点名题目与作答');
  assert.match(
    source,
    /<section className="worksheet-editor-question-section is-prompt">/,
    '题目与作答区域必须直接显示',
  );
  const promptSection = source.indexOf('<section className="worksheet-editor-question-section is-prompt">');
  const gradingSection = source.indexOf('<section className="worksheet-editor-question-section is-grading">');
  assert.ok(gradingSection > promptSection, '评分设置必须排在题目与作答区域之后并直接显示');
  assert.match(source, /<h4>分值设置<\/h4>/, '评分区应使用唯一的“分值设置”标题');
  assert.doesNotMatch(source, /<strong>得分规则<\/strong>/, '分值控件内部不应重复“得分规则”标题');
});

test('任务说明默认折叠，避免每道题上方常驻一块低频输入框', () => {
  const source = fs.readFileSync(path.join(EDITOR_DIR, 'task-card.tsx'), 'utf8');

  assert.match(source, /<details className="worksheet-editor-task-desc-details">/);
  assert.match(source, /<span>任务说明<\/span>/);
  assert.match(source, /'已填写' : '选填'/);
});
