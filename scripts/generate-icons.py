#!/usr/bin/env python3
"""生成托盘图标：运行中（绿色）和已停止（灰色/红色）"""

from PIL import Image, ImageDraw
import os

ICON_DIR = os.path.join(os.path.dirname(__file__), '..', 'src-tauri', 'icons')
BASE = os.path.join(ICON_DIR, '32x32.png')

def create_tray_icon(dot_color):
    """在右下角加一个小圆点"""
    img = Image.open(BASE).convert('RGBA')
    draw = ImageDraw.Draw(img)
    r = 5  # dot radius
    cx, cy = img.width - r - 2, img.height - r - 2
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=dot_color + (255,))
    return img

# 运行中：绿色圆点
running = create_tray_icon((34, 197, 94))
running.save(os.path.join(ICON_DIR, 'tray-running.png'))

# 已停止：灰色圆点
stopped = create_tray_icon((148, 163, 184))
stopped.save(os.path.join(ICON_DIR, 'tray-stopped.png'))

print("✅ 托盘图标已生成:")
for f in ['tray-running.png', 'tray-stopped.png']:
    path = os.path.join(ICON_DIR, f)
    sz = os.path.getsize(path)
    print(f"  {path} ({sz} bytes)")
