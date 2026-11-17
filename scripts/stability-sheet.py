#!/usr/bin/env python3
"""Build a contact sheet from the stability frames: for each bookmark, three consecutive
frames side by side, plus 2x crops of a near, mid and far region, plus the absolute
difference of consecutive frames (sparkle shows up as bright speckle; a smooth shift
from camera motion shows as soft edges). Usage: python3 scripts/stability-sheet.py [dir]"""
import sys, os
from PIL import Image, ImageChops, ImageOps

d = sys.argv[1] if len(sys.argv) > 1 else 'shots-tmp/stability'
names = sorted({f.rsplit('-f', 1)[0] for f in os.listdir(d) if '-f' in f and f.endswith('.png')})
rows = []
for n in names:
    fr = [Image.open(os.path.join(d, f'{n}-f{i}.png')).convert('RGB') for i in range(3)]
    w, h = fr[0].size
    crops = []
    for (cx, cy) in [(0.5, 0.85), (0.5, 0.6), (0.5, 0.48)]:
        box = (int(cx * w - 120), int(cy * h - 50), int(cx * w + 120), int(cy * h + 50))
        crops.append([f.crop(box).resize((240 * 2, 100 * 2), Image.NEAREST) for f in fr])
    diffs = [ImageOps.autocontrast(ImageChops.difference(fr[i], fr[i + 1]).convert('L')).convert('RGB') for i in range(2)]
    row = Image.new('RGB', (w * 3, h + 200 * 3 + h), (30, 30, 30))
    for i, f in enumerate(fr): row.paste(f, (i * w, 0))
    for r, cs in enumerate(crops):
        for i, c in enumerate(cs): row.paste(c, (i * 480, h + r * 200))
    for i, df in enumerate(diffs): row.paste(df, (i * w, h + 600))
    rows.append(row)
if rows:
    W = rows[0].width
    sheet = Image.new('RGB', (W, sum(r.height for r in rows)), (0, 0, 0))
    y = 0
    for r in rows: sheet.paste(r, (0, y)); y += r.height
    out = os.path.join(d, 'sheet.jpg')
    sheet.save(out, quality=85)
    print(out, sheet.size)
