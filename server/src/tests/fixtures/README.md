# 测试样本

## `small-rar3.rar`（336 字节）

**来源**：libarchive 测试套件，`libarchive/test/test_read_format_rar.rar.uu`。

- 上游仓库：<https://github.com/libarchive/libarchive>
- 取用地址（pin 到 tag）：<https://raw.githubusercontent.com/libarchive/libarchive/v3.8.1/libarchive/test/test_read_format_rar.rar.uu>
- 该文件是一份 uuencode 文本：取 `begin` / `end` 之间的行做 `binascii.a2b_uu` 解码即得本样本，
  内容未作任何修改。
- 本仓样本 `sha256 = d421b86f6290aefad61b2a36737253b2b30fe27c156bd95abfc230f24fe0307e`。
  复核方式是重新取、重新解码、比这个值。实测 `v3.7.7`、`v3.8.1`、`master` 三个 ref 解出来
  **逐字节相同**（都是这个 sha256），所以换 ref 复核也应当对得上。

**许可证**：libarchive 采用 BSD-2-Clause。本样本是 `libarchive/test/test_read_format_rar.c`
这个用例的数据文件，`.uu` 自身不含许可头（uuencode 格式也没有注释位），版权行取自它的宿主用例文件头：

> Copyright (c) 2003-2007 Tim Kientzle
> Copyright (c) 2011 Andres Mejia
> Copyright (c) 2011-2012 Michihiro NAKAJIMA
> All rights reserved.

项目整体另有「The libarchive distribution as a whole is Copyright by Tim Kientzle」的表述，
原文（含完整 BSD-2-Clause 条文）见 <https://github.com/libarchive/libarchive/blob/master/COPYING>。

⚠️ BSD-2-Clause 第 1 条**要求再分发时保留上述版权声明**。本项目是随安装包对外分发的，
不是内部自用，所以这几行**不能删**。

**里面有什么** —— 用**原生 `7zz l -slt <文件>`** 复核（为什么必须限定原生 `7zz`，见下方警告二）：

| 条目 | 说明 |
|---|---|
| `test.txt` | 20 字节，`Attributes = -rw-r--r--` |
| `testlink` | 8 字节，**一条符号链接**，`Attributes = lrwxrwxrwx`（内容是链接目标文本，见警告一） |
| `testdir/test.txt` | 20 字节，一层嵌套目录 |
| `testemptydir` | 空目录（`Folder = +`、`Size = 0`） |

归档里共 5 个条目（上表 4 行，另有 `testdir` 自身的目录条目）。

### ⚠️ 警告一：`testlink` 的「摊平」是 `7z-wasm` 上的一次观察，不是 7-Zip 的契约

| 解压走哪条路 | `testlink` 出来是什么 |
|---|---|
| 原生 `7zz x`（macOS，实测 26.03） | **真符号链接**：`lrwxr-xr-x testlink -> test.txt` |
| `7z-wasm`（实测 1.2.0，基于 7-Zip 24.09） | **8 字节普通文件**：mode `100666`、`isLink === false`，内容是字符串 `test.txt` |

即：**在 `7z-wasm` 这条路上**它被摊平成普通文件 —— 但这不是 7-Zip 的普遍行为，
同一个样本换原生 `7zz` 就还原成真软链。它是**一次观察，不是一条契约**，
**一次 `7z-wasm` 升级就可能把它改掉**。

⇒ **对实现的约束**：「软链不会落盘」这件事**不能**建立在「反正 7-Zip 会摊平」上，
**也**不能只靠解压前的 `l -slt`（警告二说明它根本认不出软链）。真正的主保证是解压**之后**
我们自己在 wasm FS 上走一遍、对每个条目 `lstat` + `isLink` 的那道闸门。
它**不是深度防御，是主保证 —— 删不得**。

### ⚠️ 警告二：`7z-wasm` 的 `l -slt` 不输出 POSIX 权限串，认不出软链

同一个样本、同一个 `-slt`，两个工具的 `Attributes` 字段并不一致（实测）：

| 条目 | 原生 `7zz l -slt` | `7z-wasm l -slt` |
|---|---|---|
| `test.txt` | `Attributes = -rw-r--r--` | `Attributes =`（空） |
| `testlink` | `Attributes = lrwxrwxrwx` | `Attributes =`（**空**） |
| `testdir` | `Attributes = D drwxr-xr-x` | `Attributes = D` |

`7z-wasm` 只给得出 `D`（是不是目录），**给不出权限位**，因此**没法从它的列表里认出一条软链**。
它给得出的是 `Size` / `Packed Size` / `Folder` / `Encrypted` / `CRC` / `Method` 等字段。

⇒ 上表里那句 `lrwxrwxrwx` 是**原生 `7zz`** 的视图（也就是「归档里本来记着什么」）；
走 `7z-wasm` 时，软链只能靠解压后的 `lstat` 才认得出来（警告一）。

**为什么是它**：RAR 是专有格式，`7zz` 与 7z-wasm 都**只能解不能压** —— 实测原生
`7zz a -tRar` 报 `E_NOTIMPL` 且不产出文件；7z-wasm 的编解码器表里 `Rar1` / `Rar2` / `Rar3` /
`Rar5` 旗标都只有 `D`。所以样本无法就地生成。
这个文件同时含**软链条目**和**空目录**两个边界，体积又只有 336 字节 —— 适合进仓。
