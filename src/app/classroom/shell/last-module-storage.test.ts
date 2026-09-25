import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ★ 2026-09-25：「上次停在哪个模块」这条存档的**归属与清档点**。
 *
 * 🔴 起因（教师 2026-09-23 截图批注）：学生**选姓名进入**之后，落在的是
 * **上一个学生离开的那个模块**里 —— 共用 iPad 上这是必然发生的（上一个学生留在探究空间，
 * 下一个学生一进来就在探究空间，而且**他什么都没点**）。
 * 而教师看板跟着 `module-focus` 走，于是监测到的也是错的模块。
 *
 * 修法：**进入时清掉存档**。🔴 但**刷新不能清** —— 刷新走的是 `chat_session_<code>`
 * 那条自动重连（`identity/use-student-session.ts:70`），**根本不过身份页**。
 * 两条路分开靠的就是「清档只发生在 `handleIdentityConfirm` 里」这一件事。
 *
 * ⚠️ 与 `src/lib/classroom-material.test.ts` 同一条纪律：本文件证明的是**接线**，
 * 不是浏览器里的行为（本仓没有前端测试框架、也没有 jsdom）。
 * 真正的行为要人工验：**选姓名进入 ⇒ 停在首页；刷新 ⇒ 停在原处**。
 *
 * ```bash
 * node --test src/app/classroom/shell/last-module-storage.test.ts
 * ```
 */

/** 去掉注释再扫：两个文件里都**引用**了这个键名（说明用），不去掉会自己把自己扫红。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../..');

const STORAGE_KEY = 'classnode:last-module';

/** `src/` 下所有非测试的 ts/tsx（测试文件自己会写这个字面量，必须排除）。 */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('🔴 存档键**只有一个所有者** —— 换个地方清档时不会各写各的字符串', () => {
  // 🔴 为什么这条值得一条用例：`readStoredModule` / `writeStoredModule` / 现在多出来的
  //    `clearStoredModule` 必须读写**同一个键**。三个字面量各写一份的话，表现是
  //    「清档清了个空气」—— 存档还在，学生照样被拽回上一个模块，
  //    而**没有任何东西会红**（清档是一句 `removeItem`，键名写错不会抛）。
  const owners = sourceFiles(SRC)
    .filter((file) => stripComments(readFileSync(file, 'utf8')).includes(STORAGE_KEY))
    .map((file) => path.relative(SRC, file));

  assert.deepEqual(owners, ['app/classroom/shell/use-module-tabs.ts'],
    '这条存档键只许出现在所有者那一个文件里；别处要清档请调它导出的函数');
});

test('🔴 学生**选姓名进入**那一下必须清档（否则他落在上一个学生的模块里）', () => {
  // 判据挂在**行为**上、不挂在实现上：只要 `handleIdentityConfirm` 这条路上出现
  // 「清掉那个存档」的调用即可，具体调的是哪个函数由所有者决定。
  const file = path.join(SRC, 'app/classroom/use-classroom-session.ts');
  const source = stripComments(readFileSync(file, 'utf8'));

  // 锚点：确认我们扫的确实是「选姓名进入」那一段，而不是文件里别的地方。
  const confirmIndex = source.indexOf('const handleIdentityConfirm');
  assert.ok(confirmIndex >= 0, '找不到 handleIdentityConfirm —— 用例的锚点失效了，先修用例');

  const clearIndex = source.indexOf('clearStoredModule(');
  assert.ok(clearIndex >= 0,
    'use-classroom-session.ts 没有调用 clearStoredModule —— 选姓名进入时不会清档，'
    + '共用 iPad 上学生会被送到上一个学生离开的模块里');

  // ⚠️ 顺序也钉住：清档必须发生在 `handleIdentityConfirm` **内部**（进课堂那一刻），
  //    而不是模块顶层或某个 effect 里 —— 后者会在刷新时也清，把刷新记忆一起干掉。
  assert.ok(clearIndex > confirmIndex,
    'clearStoredModule 出现在 handleIdentityConfirm 之前 —— 那会连刷新也一起清掉');
});
