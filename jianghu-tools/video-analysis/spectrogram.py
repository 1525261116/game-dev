#!/usr/bin/env python3
"""生成音频频谱图/波形图（用于人眼判读：BGM 结构、打击点、是否有语音）。

用法: python3 spectrogram.py <raw_f32_mono> <sampleRate> <out_png>
"""
import sys

import numpy as np
from PIL import Image, ImageDraw

RAW = sys.argv[1] if len(sys.argv) > 1 else "out/audio_22050.raw"
SR = int(sys.argv[2]) if len(sys.argv) > 2 else 22050
OUT = sys.argv[3] if len(sys.argv) > 3 else "out/analysis/spectrogram.png"

x = np.fromfile(RAW, dtype=np.float32)
win = 1024
hop = 256
n = (len(x) - win) // hop
idx = np.arange(win)[None, :] + hop * np.arange(n)[:, None]
frames = x[idx] * np.hanning(win)[None, :]
spec = np.abs(np.fft.rfft(frames, axis=1))
freqs = np.fft.rfftfreq(win, 1.0 / SR)
times = (np.arange(n) * hop + win / 2) / SR

# 只画到 8kHz，对数频率轴
fmax = 8000
mask = freqs <= fmax
S = spec[:, mask]
S_db = 20 * np.log10(S + 1e-6)
S_db = np.clip(S_db, S_db.max() - 70, S_db.max())

n_bins = 256
f_axis = np.logspace(np.log10(60), np.log10(fmax), n_bins)
img_w = 1600
col_idx = np.linspace(0, n - 1, img_w).astype(int)
spec_img = np.zeros((n_bins, img_w), dtype=np.float32)
for j, c in enumerate(col_idx):
    col = S_db[c, :]
    spec_img[:, j] = np.interp(f_axis, freqs[mask], col)

spec_norm = ((spec_img - spec_img.min()) / (spec_img.max() - spec_img.min() + 1e-9) * 255).astype(np.uint8)
rgb = np.stack([spec_norm, np.clip(spec_norm * 0.85 + 20, 0, 255).astype(np.uint8), np.clip(255 - spec_norm * 0.6, 0, 255).astype(np.uint8)], axis=-1)
img = Image.fromarray(rgb[::-1], "RGB")

H_EXTRA = 150
canvas = Image.new("RGB", (img_w, img.height + H_EXTRA), (12, 12, 16))
canvas.paste(img, (0, 0))
dr = ImageDraw.Draw(canvas)

# 波形
wave_top = img.height + 8
wave_h = 60
seg = max(1, len(x) // img_w)
for j in range(img_w):
    a = j * seg
    b = min(a + seg, len(x))
    if b <= a:
        continue
    mx = float(np.max(np.abs(x[a:b])))
    y = wave_top + wave_h / 2
    dr.line([j, y - mx * wave_h / 2, j, y + mx * wave_h / 2], fill=(120, 200, 255))

# RMS 曲线
seg2 = int(0.05 * SR)
rms = [float(np.sqrt((x[i:i + seg2] ** 2).mean())) for i in range(0, len(x) - seg2, seg2)]
rms = np.array(rms) / (max(rms) + 1e-9)
rms_top = wave_top + wave_h + 12
for j in range(img_w):
    i = int(j / img_w * len(rms))
    v = rms[min(i, len(rms) - 1)]
    dr.line([j, rms_top + 50, j, rms_top + 50 - v * 50], fill=(255, 180, 90))

dr.text((6, wave_top + 2), "waveform", fill=(200, 200, 210))
dr.text((6, rms_top + 2), "rms", fill=(200, 200, 210))
for s in range(0, int(times[-1]) + 1, 5):
    jx = int(s / times[-1] * img_w)
    dr.line([jx, 0, jx, 10], fill=(255, 255, 255))
    dr.text((jx + 2, 10), f"{s}s", fill=(255, 255, 255))
canvas.save(OUT)
print("wrote", OUT, "shape", canvas.size, "duration", round(float(times[-1]), 2))

# 频段能量占比（时间平均）
bands = [(0, 150), (150, 400), (400, 1000), (1000, 2500), (2500, 5000), (5000, 11000)]
tot = spec.sum()
for lo, hi in bands:
    m = (freqs >= lo) & (freqs < hi)
    print(f"band {lo:5d}-{hi:5d} Hz: {spec[:, m].sum() / tot * 100:5.1f}%")

# 起音间隔直方图
hop_t = hop / SR
flux = np.maximum(0, np.diff(spec, axis=0)).sum(axis=1)
flux = np.concatenate([[0], flux])
fn = (flux - flux.mean()) / (flux.std() + 1e-9)
ons = [i for i in range(1, len(fn) - 1) if fn[i] > 1.4 and fn[i] >= fn[i - 1] and fn[i] > fn[i + 1]]
ons_t = [i * hop_t for i in ons]
ioi = np.diff(ons_t)
ioi = ioi[(ioi > 0.05) & (ioi < 2.0)]
hist, edges = np.histogram(ioi, bins=np.arange(0.0, 2.0, 0.05))
print("IOI histogram top peaks (s):")
order = np.argsort(hist)[::-1][:8]
for k in sorted(order):
    print(f"  {edges[k]:.2f}-{edges[k+1]:.2f}s : {hist[k]}")
# chroma（判断是否五声音阶）
f0 = 55.0
chroma = np.zeros(12)
for i, f in enumerate(freqs):
    if 80 < f < 2000:
        midi = 69 + 12 * np.log2(f / 440.0)
        pc = int(round(midi)) % 12
        chroma[pc] += spec[:, i].sum()
chroma = chroma / chroma.sum()
names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
print("chroma:", ", ".join(f"{names[i]}={chroma[i]*100:.1f}%" for i in range(12)))
print("pentatonic(C D E G A) energy: %.1f%%" % (sum(chroma[i] for i in [0, 2, 4, 7, 9]) * 100))
