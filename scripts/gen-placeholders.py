"""生成 images/empty/ 下的两个占位图（代码已引用但文件缺失）。

- empty-post.png  750x420 路线/动态卡片封面占位
- avatar.png      200x200 头像占位

纯几何图形，浅灰系，与 app 的 #F5F5F5 背景协调。
"""
import os
from PIL import Image, ImageDraw

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'images', 'empty')
os.makedirs(OUT_DIR, exist_ok=True)

S = 4  # 超采样倍数，缩小后得到抗锯齿边缘

BG = (242, 240, 237, 255)
FG = (201, 196, 189, 255)


def rounded_rect(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def make_empty_post():
    w, h = 750 * S, 420 * S
    img = Image.new('RGBA', (w, h), BG)
    d = ImageDraw.Draw(img)

    cx, cy = w // 2, h // 2
    # 相框
    fw, fh = 200 * S, 150 * S
    box = [cx - fw // 2, cy - fh // 2, cx + fw // 2, cy + fh // 2]
    d.rounded_rectangle(box, radius=14 * S, outline=FG, width=8 * S)

    # 相框内的山形
    base_y = cy + fh // 2 - 18 * S
    d.polygon([(cx - 70 * S, base_y), (cx - 22 * S, base_y - 62 * S), (cx + 14 * S, base_y)], fill=FG)
    d.polygon([(cx - 8 * S, base_y), (cx + 34 * S, base_y - 42 * S), (cx + 68 * S, base_y)], fill=FG)

    # 太阳
    sr = 16 * S
    d.ellipse([cx + 30 * S - sr, cy - fh // 2 + 30 * S - sr,
               cx + 30 * S + sr, cy - fh // 2 + 30 * S + sr], fill=FG)

    img = img.resize((750, 420), Image.LANCZOS)
    path = os.path.join(OUT_DIR, 'empty-post.png')
    img.convert('RGB').save(path, 'PNG', optimize=True)
    return path


def make_avatar():
    n = 200 * S
    img = Image.new('RGBA', (n, n), BG)
    d = ImageDraw.Draw(img)

    cx, cy = n // 2, n // 2
    # 圆形底板
    r = 66 * S
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=FG, width=7 * S)

    # 头
    hr = 20 * S
    d.ellipse([cx - hr, cy - 34 * S - hr, cx + hr, cy - 34 * S + hr], fill=FG)
    # 肩
    d.pieslice([cx - 38 * S, cy + 2 * S, cx + 38 * S, cy + 78 * S], 180, 360, fill=FG)

    img = img.resize((200, 200), Image.LANCZOS)
    path = os.path.join(OUT_DIR, 'avatar.png')
    img.convert('RGB').save(path, 'PNG', optimize=True)
    return path


for fn in (make_empty_post, make_avatar):
    p = fn()
    print('生成:', os.path.relpath(p), os.path.getsize(p), 'bytes')
