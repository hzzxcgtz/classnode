#!/usr/bin/env python3
"""学生作答文本 → 一张「手机拍的作业纸」PNG（供 `seed-worksheet-demo.mjs` 造**照片作答**）。

用法：
    python3 scripts/make-answer-photos.py <manifest.json>
    manifest.json: [{"path": "/绝对/路径/chat-xxx.png", "lines": ["第一行", "第二行"], "style": "neat|sloppy"}]

输出（stdout，一行 JSON）：`{"written": 3, "font": "Songti SC Light"}`

── 为什么要有它 ────────────────────────────────────────────────────────────
学习单里的**照片作答**（`inputMode: photo`）存的是 `{format:'photo/v1', url}`，而 AI 分析
会把那些 url **真的读成图**（`analysis-render.ts` → `resolveLocalPath` → 拼联系表）。
⇒ 造测试数据时只写一个 URL 是不行的：文件不在，AI 分析那条路会当场抛错。
所以这里把「学生写的那段话」画成一张图，落到上传目录里。

⚠️ 字体是**本机找**的（macOS 自带的那几个），找不到就退回 Arial Unicode；
   一台机器上渲染出来什么样，这里不做保证 —— 它只是**测试数据**，不是线上产物。
"""
import json
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# 从「像笔写的」往「至少能看」排：宋体细体最接近学生手写，黑体/无衬线垫底。
FONT_CANDIDATES = [
    ('/System/Library/Fonts/Supplemental/Songti.ttc', 3),   # Songti SC Light
    ('/System/Library/Fonts/Supplemental/Songti.ttc', 4),   # STSong Regular
    ('/System/Library/Fonts/Supplemental/Songti.ttc', 1),   # Songti SC Bold
    ('/System/Library/Fonts/Hiragino Sans GB.ttc', 0),
    ('/Library/Fonts/Arial Unicode.ttf', 0),
]
PAPER = (1000, 700)          # 一张作业纸的像素尺寸（够 AI 看清，也不至于几 MB）
INK = (32, 46, 72)           # 蓝黑墨水
RULE = (226, 232, 240)       # 横线
MARGIN_X, TOP_Y, LINE_H = 78, 132, 62


def load_font(size: int):
    for path, index in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size, index=index), f'{ImageFont.truetype(path, size, index=index).getname()[0]} {ImageFont.truetype(path, size, index=index).getname()[1]}'
        except Exception:  # noqa: BLE001 —— 换下一个，最后一定有 Arial Unicode
            continue
    raise SystemExit('这台机器上找不到任何可用的中文字体')


def wrap(draw: ImageDraw.ImageDraw, text: str, font, max_width: int) -> list[str]:
    """按像素宽换行（中文没有空格，只能逐字量）。"""
    lines, line = [], ''
    for ch in text:
        if ch == '\n':
            lines.append(line)
            line = ''
            continue
        if draw.textlength(line + ch, font=font) > max_width and line:
            lines.append(line)
            line = ch
        else:
            line += ch
    if line:
        lines.append(line)
    return lines


def render(entry: dict, rng: random.Random) -> str:
    neat = entry.get('style') != 'sloppy'
    font, font_name = load_font(34 if neat else 33)
    img = Image.new('RGB', PAPER, (252, 251, 247))
    draw = ImageDraw.Draw(img)

    # 横线本（每行一条）——「作业纸」的样子
    y = TOP_Y + 8
    while y < PAPER[1] - 30:
        draw.line([(40, y), (PAPER[0] - 40, y)], fill=RULE, width=2)
        y += LINE_H

    body = '\n'.join(entry.get('lines') or [])
    max_width = PAPER[0] - MARGIN_X * 2
    y = TOP_Y
    for line in wrap(draw, body, font, max_width):
        # 逐字画：字号一致但每一笔的位置都抖一点 —— 一行字完全对齐反而像打印的
        x = MARGIN_X + rng.randint(-3, 3)
        jitter = (3 if neat else 6)
        for ch in line:
            draw.text((x + rng.randint(-1, 1), y + rng.randint(-jitter, jitter)), ch, font=font, fill=INK)
            x += draw.textlength(ch, font=font)
        y += LINE_H + rng.randint(-3, 3)

    # 拍照的样子：整页歪一点（正着扫出来的反而像截图）
    img = img.rotate(rng.uniform(-1.1, 1.1), resample=Image.BICUBIC, expand=False, fillcolor=(240, 240, 238))
    Path(entry['path']).parent.mkdir(parents=True, exist_ok=True)
    img.save(entry['path'], 'PNG', optimize=True)
    return font_name


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    entries = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    font_name = ''
    for index, entry in enumerate(entries):
        # 每张用自己的种子：同一份清单重跑，出来的图一模一样（便于反复造同一批数据）
        font_name = render(entry, random.Random(index * 7919 + 13))
    print(json.dumps({'written': len(entries), 'font': font_name}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
