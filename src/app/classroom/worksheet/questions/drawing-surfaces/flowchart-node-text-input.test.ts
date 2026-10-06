/**
 * 节点文字输入框的**输入法**判据（★ 2026-10-06 教师报「双击节点后无法输入中文」）。
 *
 * 🔴 教师的现象（他对选项的原话）：双击节点后打拼音，**「拼音字母都上不去」**，
 *    候选框根本不出现；而**英文能正常打进去**。
 *    ⇒ input 是活着的、有焦点的（英文进得去），坏掉的是**输入法组合态**。
 *
 * 根因：这个输入框是**受控**的，而且**每敲一个键都把新值写回 React Flow store**
 *       （`onChange → instance.updateNodeData`）⇒ 每次按键都让 `visibleNodes` 那个 useMemo
 *       重算、**全图重渲染**。中文输入法要连着几次按键维持一个「组合态」，这个往返把它打断，
 *       候选框和拼音字母一起没掉；英文逐字提交，所以感觉不出来。
 *
 * ✅ 同一段代码里**能正常打中文**的对照物：连线标签的就地输入框 —— 它是
 *    `defaultValue`（**非受控**），只在 Enter/blur 时才写回 store。判据把它也钉住，
 *    免得将来有人为了「统一」把它也改成每次按键写 store。
 *
 * ⚠️ 本仓没有 jsdom ⇒ 这一条是**源码级**的网：它挡的是「又变回每按键写 store」这个**形态**，
 *    挡不住更细微的时序问题。真机上的中文输入只能靠教师在 Mac 上亲手按一遍。
 * ⚠️ 只有否定断言会**假绿**（切片切空了、或元素改名导致找不到锚点，都会静默全绿）⇒
 *    每条判据都配一句**长度断言**，切不出来就当场红，不许在空串上通过。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8');

/** `blockAfter` 的用法见同目录的 `surface-lifecycle.test.ts`：按**代码**标记切片，不按注释。 */
function blockBetween(source: string, startMarker: string, endMarker: string): string {
  const at = source.indexOf(startMarker);
  if (at === -1) return '';
  const end = source.indexOf(endMarker, at + startMarker.length);
  return end === -1 ? source.slice(at) : source.slice(at, end);
}

/** 节点文字那个 `<input>` 的属性区：从它的 aria-label 到同一表达式里 `<span>` 分支的开头。 */
const nodeTextInputSource = (source: string) => blockBetween(source, 'aria-label="节点文字"', '<span');
/** 连线标签的就地输入框（对照物）：从它的 aria-label 到它自己的结束。 */
const edgeLabelInputSource = (source: string) => blockBetween(source, 'aria-label="这条连线上的文字"', '/>');

test('节点文字编辑期间不许写回 React Flow store —— 那正是打断中文组合的东西', () => {
  const block = nodeTextInputSource(SOURCE);
  assert.ok(block.length > 200, `节点文字输入框的切片太短（${block.length} 字符），判据可能在空串上假绿`);
  assert.ok(
    !block.includes('updateNodeData'),
    '节点文字的每次按键都写回 store（onChange → updateNodeData）⇒ 全图重渲染 ⇒ 中文输入法的组合态被打断。'
      + '编辑期间只许改组件自己的草稿 state，Enter/blur 时才提交。',
  );
});

test('节点文字的 Enter/Escape 必须先排除输入法组合态', () => {
  const block = nodeTextInputSource(SOURCE);
  assert.ok(block.length > 200, `节点文字输入框的切片太短（${block.length} 字符），判据可能在空串上假绿`);
  assert.ok(
    block.includes('isComposing'),
    '中文输入法里 Enter 是「上屏候选词」、Escape 是「取消组合」，不能当成「确认/放弃」——'
      + '不先看 isComposing 就 blur()，按下回车的那一刻编辑框就关了。',
  );
});

test('连线标签的 Enter/Escape 同样要先排除输入法组合态', () => {
  const block = edgeLabelInputSource(SOURCE);
  assert.ok(block.length > 100, `连线标签输入框的切片太短（${block.length} 字符），判据可能在空串上假绿`);
  assert.ok(
    block.includes('isComposing'),
    '连线标签的就地输入框与节点文字是同一个坑：组合中按回车会把还没上屏的拼音丢掉。',
  );
});

/*
  ★ 2026-10-06（教师）：「**双击一个图形框，默认全选里面的文字**，方便修改」。

  现在的行为是：双击 → 进编辑 → 光标落在文字**末尾**（`autoFocus` 只负责聚焦、不负责选中）
  ⇒ 想改内容得先自己全选一次。
  ✅ 加一句 `select()`：input 只在编辑态存在（渲染条件是 `editing && …`）⇒ `onFocus` 一次
     **就是**「刚进入编辑」那一次，不必额外记「是不是刚进来」。
  ⚠️ 别改成「每次 focus 都全选」那种写法（比如往 input 外面挂监听）—— 那会让**在框里点一下
     就全选掉**，学生想放光标到中间改一个字都做不到。这里的写法天然只有一次。
*/
test('双击进入编辑时全选文字 —— 直接开打就是替换，不用先自己全选', () => {
  const block = blockBetween(SOURCE, 'aria-label="节点文字"', '<span');
  assert.ok(block.length > 200, `切片太短（${block.length}），判据可能在空串上假绿`);
  assert.match(
    block,
    /onFocus=\{\(event\) => event\.currentTarget\.select\(\)\}/,
    '进入编辑时要把文字全选上',
  );
});

test('连线标签的输入框保持非受控 —— 它是「中文能打」的对照物', () => {
  const block = edgeLabelInputSource(SOURCE);
  assert.ok(block.length > 100, `连线标签输入框的切片太短（${block.length} 字符），判据可能在空串上假绿`);
  assert.ok(
    block.includes('defaultValue'),
    '连线标签靠 defaultValue（非受控）才躲过了组合态被打断。把它改成 value= 受控会让它也打不了中文。',
  );
});
