# 测试样本

## `small-rar3.rar`（336 字节）

**来源**：libarchive 测试套件，`libarchive/test/test_read_format_rar.rar.uu`。
解码自该 uuencode 文件，内容未作任何修改。

**许可证**：libarchive 采用 BSD-2-Clause。本文件是其测试数据的一部分，
按原许可证随本项目分发。

**里面有什么**（用 `7zz l -slt` 可复核）：

| 条目 | 说明 |
|---|---|
| `test.txt` | 20 字节 |
| `testlink` | 8 字节 —— **一条符号链接**（内容是链接目标）。7-Zip 会把它**摊平成普通文件**，这正是我们要钉住的行为 |
| `testdir/test.txt` | 20 字节，一层嵌套目录 |
| `testemptydir` | 空目录 |

**为什么是它**：RAR 是专有格式，`7zz` 与 7z-wasm 都只能解不能压，样本无法就地生成。
这个文件同时含**软链条目**和**空目录**两个边界，体积又只有 336 字节 —— 适合进仓。
