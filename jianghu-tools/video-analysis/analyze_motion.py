#!/usr/bin/env python3
"""运动/演出分析：打击节拍、全屏立绘演出(插入技)、闪白、镜头抖动、节奏。

用法: python3 analyze_motion.py <frames_dir> <out_dir>
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

FRAMES_DIR = sys.argv[1] if len(sys.argv) > 1 else "out/frames_12fps"
OUT_DIR = sys.argv[2] if len(sys.argv) > 2 else "out/analysis"
os.makedirs(OUT_DIR, exist_ok=True)

items = json.load(open(os.path.join(FRAMES_DIR, "manifest.json")))
SMALL = (160, 72)

rows = []
prev = None
for it in items:
    arr = np.asarray(Image.open(os.path.join(FRAMES_DIR, it["file"])).convert("RGB").resize(SMALL, Image.BILINEAR)).astype(np.float32)
    gray = arr.mean(axis=2)
    chroma = (np.abs(arr[..., 0] - arr[..., 1]) + np.abs(arr[..., 1] - arr[..., 2]) + np.abs(arr[..., 2] - arr[..., 0])).mean() / 3.0
    diff = float(np.abs(gray - prev).mean()) if prev is not None else 0.0
    diff_p90 = float(np.percentile(np.abs(gray - prev), 90)) if prev is not None else 0.0
    rows.append({
        "t": it["t"], "file": it["file"],
        "bright": round(float(gray.mean()) / 255.0, 4),
        "chroma": round(float(chroma), 2),
        "diff": round(diff, 3),
        "diff_p90": round(diff_p90, 3),
    })
    prev = gray

t = np.array([r["t"] for r in rows])
diff = np.array([r["diff"] for r in rows])
bright = np.array([r["bright"] for r in rows])
chroma = np.array([r["chroma"] for r in rows])

# --- 1) 全屏立绘/水墨演出帧：低彩度（近黑白）持续 >= 0.4s ---
mono = chroma < np.percentile(chroma, 12)
runs = []
start = None
for i, m in enumerate(mono):
    if m and start is None:
        start = i
    elif not m and start is not None:
        if t[i - 1] - t[start] >= 0.4:
            runs.append((start, i - 1))
        start = None
if start is not None and t[-1] - t[start] >= 0.4:
    runs.append((start, len(rows) - 1))
cutins = [{"start": round(float(t[a]), 3), "end": round(float(t[b]), 3),
           "dur": round(float(t[b] - t[a] + 1 / 12), 3),
           "mean_chroma": round(float(chroma[a:b + 1].mean()), 2),
           "mean_bright": round(float(bright[a:b + 1].mean()), 3),
           "keyframes": [rows[k]["file"] for k in range(a, b + 1)][:14]} for a, b in runs]

# --- 2) 闪白/强闪光：亮度突升 ---
db = np.concatenate([[0], np.diff(bright)])
flash_thr = db.mean() + 3.0 * db.std()
flashes = []
for i in range(1, len(rows) - 1):
    if db[i] > flash_thr and db[i] >= db[i - 1] and db[i] > db[i + 1]:
        flashes.append({"t": round(float(t[i]), 3), "delta_bright": round(float(db[i]), 4), "bright": round(float(bright[i]), 4)})

# --- 3) 打击/强运动峰值 ---
d = diff.copy()
d[:1] = 0
thr = d.mean() + 1.4 * d.std()
peaks = []
i = 1
while i < len(d) - 1:
    if d[i] > thr and d[i] >= d[i - 1] and d[i] >= d[i + 1]:
        peaks.append(i)
        i += 3
    else:
        i += 1
impacts = [{"t": round(float(t[i]), 3), "diff": round(float(diff[i]), 2)} for i in peaks]

# --- 4) 打击节拍（视觉事件自相关） ---
sig = np.clip(diff - diff.mean(), 0, None)
ac = np.correlate(sig, sig, mode="full")[len(sig) - 1:]
ac = ac / (ac[0] + 1e-9)
fps = 1.0 / np.median(np.diff(t))
lags = np.arange(len(ac))
periods = np.arange(0.25, 4.0, 0.01)
scores = [float(np.interp(p * fps, lags, ac)) for p in periods]
best_period = float(periods[int(np.argmax(scores))])
# 每 2 秒窗口的打击密度
win = 2.0
density = []
edges = np.arange(0, t[-1] + win, win)
for a, b in zip(edges[:-1], edges[1:]):
    n = sum(1 for p in impacts if a <= p["t"] < b)
    mv = float(diff[(t >= a) & (t < b)].mean()) if ((t >= a) & (t < b)).any() else 0.0
    density.append({"start": round(float(a), 2), "end": round(float(b), 2), "impacts": n,
                    "impacts_per_sec": round(n / win, 2), "mean_diff": round(mv, 2)})

# --- 5) 镜头/画面稳定性：高 diff 帧占比 ---
unstable_ratio = round(float((diff > diff.mean() + 1.0 * diff.std()).mean()), 4)

summary = {
    "frames": len(rows), "fps": round(float(fps), 3), "duration": round(float(t[-1]), 3),
    "diff_mean": round(float(diff.mean()), 2), "diff_p90": round(float(np.percentile(diff, 90)), 2),
    "diff_max": round(float(diff.max()), 2), "diff_max_t": round(float(t[int(np.argmax(diff))]), 3),
    "bright_mean": round(float(bright.mean()), 3), "bright_min": round(float(bright.min()), 3), "bright_max": round(float(bright.max()), 3),
    "chroma_mean": round(float(chroma.mean()), 2),
    "impact_count": len(impacts), "impact_rate_per_sec": round(len(impacts) / float(t[-1]), 2),
    "visual_beat_period_s": round(best_period, 3), "visual_beat_bpm": round(60.0 / best_period, 1),
    "high_motion_frame_ratio": unstable_ratio,
    "flash_count": len(flashes),
    "cutin_count": len(cutins),
    "cutin_total_dur": round(sum(c["dur"] for c in cutins), 3),
    "cutin_coverage": round(sum(c["dur"] for c in cutins) / float(t[-1]), 4),
    "cutins": cutins, "flashes": flashes,
    "impacts": impacts, "density_2s": density,
    "beat_score_curve": [{"period": round(p, 2), "score": round(s, 3)} for p, s in zip(periods, scores)],
}
json.dump(summary, open(os.path.join(OUT_DIR, "motion.json"), "w"), ensure_ascii=False, indent=1)
print(json.dumps({k: v for k, v in summary.items() if k not in ("cutins", "flashes", "impacts", "beat_score_curve", "density_2s")}, ensure_ascii=False, indent=1))
print("\ncutins:")
for c in cutins:
    print(" ", c["start"], "->", c["end"], "dur", c["dur"], "chroma", c["mean_chroma"], "bright", c["mean_bright"])
print("\nflashes:", [f["t"] for f in flashes])
print("\nimpact times(0.5s 粒度):", [round(p["t"]) for p in impacts])
print("\ndensity per 2s:", [(dd["start"], dd["impacts"]) for dd in density])

# --- 6) 时间轴可视化 ---
W, H = 1600, 520
img = Image.new("RGB", (W, H), (16, 16, 20))
dr = ImageDraw.Draw(img)
pad_l, pad_r, pad_t = 60, 20, 30
plot_w = W - pad_l - pad_r


def x_of(tt):
    return pad_l + plot_w * (tt / max(t[-1], 1e-6))


def draw_series(vals, top, height, color, label, vmax=None):
    vmax = vmax or float(vals.max()) or 1.0
    dr.text((8, top - 12), label, fill=(200, 200, 210))
    pts = [(x_of(t[i]), top + height - height * float(vals[i]) / vmax) for i in range(len(vals))]
    dr.line(pts, fill=color, width=1)
    dr.rectangle([pad_l, top, W - pad_r, top + height], outline=(60, 60, 70))


draw_series(bright, pad_t + 12, 70, (120, 200, 255), "brightness")
draw_series(diff, pad_t + 122, 110, (255, 170, 90), "frame diff (motion)")
draw_series(chroma, pad_t + 272, 70, (150, 255, 150), "chroma (colorfulness)")

# 事件标记
base = pad_t + 380
dr.text((8, base - 14), "events", fill=(200, 200, 210))
dr.rectangle([pad_l, base, W - pad_r, base + 42], outline=(60, 60, 70))
for c in cutins:
    dr.rectangle([x_of(c["start"]), base, x_of(c["end"]), base + 42], fill=(240, 240, 240))
    dr.text((x_of(c["start"]) + 2, base + 4), "立绘", fill=(20, 20, 20))
for f in flashes:
    dr.line([x_of(f["t"]), base, x_of(f["t"]), base + 42], fill=(255, 255, 0), width=2)
for p in impacts:
    dr.line([x_of(p["t"]), base + 20, x_of(p["t"]), base + 42], fill=(255, 80, 80), width=2)
for i in range(int(t[-1]) + 1):
    dr.line([x_of(i), base + 42, x_of(i), base + 50], fill=(120, 120, 130))
    if i % 5 == 0:
        dr.text((x_of(i) - 8, base + 52), f"{i}s", fill=(160, 160, 170))
img.save(os.path.join(OUT_DIR, "timeline.png"))
print("wrote", os.path.join(OUT_DIR, "timeline.png"))
