import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * ★ 2026-09-25：教师看板上那个**模块指示字**的颜色，与学生端 `MODULE_META.accent` 同源。
 *
 * 🔴 §4.6 立的规矩：「学生在卡片上认到的颜色，进到模块里还是同一个」。
 * 教师看板是这个链条上的第三处 —— 三处颜色一旦分开，症状是**教师说「紫色的那个」
 * 而学生屏幕上没有一处是紫的**，而没有任何东西会报错。
 *
 * 2026-09-25 新增的那枚指示字（学 / 探 / 智）又加了一处拷贝：它住在
 * `src/app/teacher/classroom/page.tsx` 的 `MODULE_INITIALS` 里，而真源是
 * `src/app/classroom/module-meta.tsx` 的 `MODULE_META`。两处**必须逐个十六进制相等**。
 *
 * ⚠️ 只读文本 ⇒ 本机（无 jsdom、无浏览器）跑得起来。
 * ⚠️ `module-meta.tsx` 里有 JSX，`node --test` 加载不了它，所以只能扫文本 ——
 * 这也是这条用例存在的形式理由。
 */

const HERE = new URL('.', import.meta.url);
const STUDENT = readFileSync(new URL('../app/classroom/module-meta.tsx', HERE), 'utf8');
const TEACHER = readFileSync(new URL('../app/teacher/classroom/page.tsx', HERE), 'utf8');

/** 从 `module-meta.tsx` 里抠出每个模块的 `accent` 十六进制。 */
function studentAccents(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ['worksheet', 'explore', 'companion']) {
    // 先定位这个模块那一段（`worksheet: {` 到下一个 `},`），再取段内第一个 `accent:`。
    const start = STUDENT.indexOf(`  ${id}: {`);
    assert.notEqual(start, -1, `module-meta.tsx 里找不到 ${id} —— 用例的锚点失效了，先修用例`);
    const segment = STUDENT.slice(start, STUDENT.indexOf('\n  },', start));
    const m = /accent:\s*'(#[0-9a-fA-F]{6})'/.exec(segment);
    assert.ok(m, `module-meta.tsx 的 ${id} 段里没有 accent`);
    out[id] = m[1].toLowerCase();
  }
  return out;
}

/** 从教师端抠出 `MODULE_INITIALS` 的 `color` 十六进制。 */
function teacherColors(): Record<string, string> {
  const start = TEACHER.indexOf('const MODULE_INITIALS');
  assert.notEqual(start, -1, '教师端找不到 MODULE_INITIALS —— 用例的锚点失效了，先修用例');
  const block = TEACHER.slice(start, TEACHER.indexOf('};', start));
  const out: Record<string, string> = {};
  for (const id of ['worksheet', 'explore', 'companion']) {
    const m = new RegExp(`${id}:\\s*\\{[^}]*color:\\s*'(#[0-9a-fA-F]{6})'`).exec(block);
    assert.ok(m, `MODULE_INITIALS 里 ${id} 没有 color`);
    out[id] = m[1].toLowerCase();
  }
  return out;
}

test('🔴 教师看板的模块指示字颜色 = 学生端 MODULE_META 的 accent（三处同色）', () => {
  const student = studentAccents();
  const teacher = teacherColors();
  for (const id of ['worksheet', 'explore', 'companion']) {
    assert.equal(teacher[id], student[id],
      `${id} 的颜色对不上：教师端 ${teacher[id]} vs 学生端 ${student[id]} ——`
      + '§4.6 要求学生在卡片上、模块里、教师看板上认到的是同一个颜色',
    );
  }
  // 阳性对照：三处颜色**互不相同**。少了它，「三个全填成同一个色」也会让上面三条通过。
  assert.equal(new Set(Object.values(student)).size, 3, '三个模块的身份色必须两两不同');
});
