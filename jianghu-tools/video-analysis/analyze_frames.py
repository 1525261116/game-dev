#!/usr/bin/env python3
"""分析抽帧结果：镜头切分、运动能量、亮度/色彩、生成接触表(contact sheet)。

用法: python3 analyze_frames.py <frames_dir> <out_dir>
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

FRAMES_DIR = sys.argv[1] if len(sys.argv) > 1 else "out/frames_3fps"
OUT_DIR = sys.argv[2] if len(sys.argv) > 2 else "out/analysis"
os.makedirs(OUT_DIR, exist_ok=True)

manifest = json.load(open(os.path.join(FRAMES_DIR, "manifest.json")))
items = manifest

SMALL = (160, 72)


def load_small(path):
    im = Image.open(path).convert("RGB").resize(SMALL, Image.BILINEAR)
    return np.asarray(im).astype(np.float32)


def rgb_to_hsv_np(arr):
    r, g, b = arr[..., 0] / 255.0, arr[..., 1] / 255.0, arr[..., 2] / 255.0
    mx = np.max(arr, axis=-1) / 255.0
    mn = np.min(arr, axis=-1) / 255.0
    v = mx
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    return s, v


rows = []
prev_gray = None
prev_hist = None
for it in items:
    path = os.path.join(FRAMES_DIR, it["file"])
    arr = load_small(path)
    gray = arr.mean(axis=2)
    # 边缘密度（简化梯度）
    gx = np.abs(np.diff(gray, axis=1)).mean()
    gy = np.abs(np.diff(gray, axis=0)).mean()
    edge = float(gx + gy)
    s, v = rgb_to_hsv_np(arr)
    bright = float(v.mean())
    sat = float(s.mean())
    # 色彩统计：主色相
    r, g, b = arr[..., 0].mean(), arr[..., 1].mean(), arr[..., 2].mean()
    total = r + g + b + 1e-6
    warmth = float((r - b) / total)  # >0 偏暖, <0 偏冷
    # 与前一帧差异
    diff = float(np.abs(gray - prev_gray).mean()) if prev_gray is not None else 0.0
    diff_max = float(np.abs(gray - prev_gray).max()) if prev_gray is not None else 0.0
    # 直方图差异（对亮度+色彩更敏感）
    hist = np.concatenate([
        np.histogram(arr[..., 0], bins=16, range=(0, 255))[0],
        np.histogram(arr[..., 1], bins=16, range=(0, 255))[0],
        np.histogram(arr[..., 2], bins=16, range=(0, 255))[0],
    ]).astype(np.float32)
    hist /= hist.sum()
    hdiff = float(np.abs(hist - prev_hist).sum()) if prev_hist is not None else 0.0
    rows.append({
        "t": it["t"], "file": it["file"], "brightness": round(bright, 4),
        "saturation": round(sat, 4), "edge": round(edge, 3), "warmth": round(warmth, 4),
        "diff": round(diff, 3), "diff_max": round(diff_max, 3), "histdiff": round(hdiff, 4),
    })
    prev_gray = gray
    prev_hist = hist

json.dump(rows, open(os.path.join(OUT_DIR, "frame_metrics.json"), "w"), ensure_ascii=False, indent=1)

# 镜头切分：直方图差异 + 像素差异
diffs = np.array([r["histdiff"] for r in rows])
pix = np.array([r["diff"] for r in rows])
cuts = []
for i in range(1, len(rows)):
    thr_h = max(0.35, diffs.mean() + 2.5 * diffs.std()) if len(diffs) > 3 else 0.35
    if diffs[i] > thr_h and pix[i] > 12:
        cuts.append({"idx": i, "t": rows[i]["t"], "histdiff": rows[i]["histdiff"], "diff": rows[i]["diff"]})
# 合并相距很近平的切点
merged = []
for c in cuts:
    if merged and c["t"] - merged[-1]["t"] < 0.65:
        if c["histdiff"] > merged[-1]["histdiff"]:
            merged[-1] = c
        continue
    merged.append(c)

shots = []
t0 = 0.0
for c in merged:
    shots.append({"start": round(t0, 3), "end": round(c["t"], 3), "dur": round(c["t"] - t0, 3)})
    t0 = c["t"]
shots.append({"start": round(t0, 3), "end": round(rows[-1]["t"], 3), "dur": round(rows[-1]["t"] - t0, 3)})

json.dump({"cuts": merged, "shots": shots}, open(os.path.join(OUT_DIR, "shots.json"), "w"), ensure_ascii=False, indent=1)

# 汇总
def stat(key):
    a = np.array([r[key] for r in rows])
    return {"mean": round(float(a.mean()), 3), "min": round(float(a.min()), 3), "max": round(float(a.max()), 3),
            "p10": round(float(np.percentile(a, 10)), 3), "p90": round(float(np.percentile(a, 90)), 3)}

summary = {
    "frame_count": len(rows),
    "fps_sampled": round(len(rows) / max(rows[-1]["t"], 1e-6), 3),
    "brightness": stat("brightness"), "saturation": stat("saturation"),
    "edge": stat("edge"), "warmth": stat("warmth"),
    "frame_diff": stat("diff"),
    "shot_count": len(shots),
    "avg_shot_dur": round(float(np.mean([s["dur"] for s in shots])), 3),
    "min_shot_dur": round(float(np.min([s["dur"] for s in shots])), 3),
    "max_shot_dur": round(float(np.max([s["dur"] for s in shots])), 3),
    "shots": shots,
}
json.dump(summary, open(os.path.join(OUT_DIR, "summary.json"), "w"), ensure_ascii=False, indent=1)
print(json.dumps(summary, ensure_ascii=False, indent=1))

# 接触表：5x5 网格
CELL_W, CELL_H = 256, 115
COLS, ROWS = 5, 5
per_sheet = COLS * ROWS
label_h = 16
sheet_idx = 0
for start in range(0, len(rows), per_sheet):
    chunk = rows[start:start + per_sheet]
    sheet = Image.new("RGB", (COLS * CELL_W, ROWS * (CELL_H + label_h)), (18, 18, 18))
    draw = ImageDraw.Draw(sheet)
    for k, r in enumerate(chunk):
        cx = (k % COLS) * CELL_W
        cy = (k // COLS) * (CELL_H + label_h)
        im = Image.open(os.path.join(FRAMES_DIR, r["file"])).convert("RGB").resize((CELL_W, CELL_H), Image.LANCZOS)
        sheet.paste(im, (cx, cy))
        draw.text((cx + 4, cy + CELL_H + 2), f"#{start + k:03d} t={r['t']:.2f}s", fill=(230, 230, 230))
    name = os.path.join(OUT_DIR, f"sheet_{sheet_idx:02d}.jpg")
    sheet.save(name, quality=90)
    print("wrote", name)
    sheet_idx += 1
