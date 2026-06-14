---
name: portal 版本号同步
description: portal/index.html 中的版本号必须与项目版本同步更新
metadata:
  type: feedback
---

升级项目版本号时，`portal/index.html` 中 Hero 区域的版本号（`vX.X.X · 开源免费`）也需要同步更新。

**Why:** portal 页面是项目的门面，展示的版本号必须与实际版本一致。

**How to apply:** 每次 bump 版本号时，同步修改 `portal/index.html` 中第 114 行附近的 `<span>vX.X.X · 开源免费</span>`。
