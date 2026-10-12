#!/usr/bin/env python3
"""音频分析：响度包络、起音(onset)检测、节奏(BPM)、频谱特征、静音段。

用法: python3 analyze_audio.py <raw_f32_mono> <sampleRate> <out_json>
"""
import json
import sys

import numpy as np

RAW = sys.argv[1] if len(sys.argv) > 1 else "out/audio_22050.raw"
SR = int(sys.argv[2]) if len(sys.argv) > 2 else 22050
OUT = sys.argv[3] if len(sys.argv) > 3 else "out/analysis/audio.json"

x = np.fromfile(RAW, dtype=np.float32)
dur = len(x) / SR
print(f"loaded {len(x)} samples, {dur:.3f}s @ {SR}Hz")

# --- 预加重 + 分帧 ---
hop = 256
win = 1024
n_frames = max(1, (len(x) - win) // hop)
idx = np.arange(win)[None, :] + hop * np.arange(n_frames)[:, None]
frames = x[idx] * np.hanning(win)[None, :]
spec = np.abs(np.fft.rfft(frames, axis=1)) + 1e-9
freqs = np.fft.rfftfreq(win, 1.0 / SR)
times = (np.arange(n_frames) * hop + win / 2) / SR

rms = np.sqrt((frames ** 2).mean(axis=1))
dbfs = 20 * np.log10(np.maximum(rms, 1e-6))
peak = float(np.max(np.abs(x)))
peak_db = 20 * np.log10(max(peak, 1e-6))

# --- 频谱特征 ---
centroid = (spec * freqs[None, :]).sum(axis=1) / spec.sum(axis=1)
rolloff = freqs[np.argmax(np.cumsum(spec, axis=1) > 0.85 * spec.sum(axis=1, keepdims=True), axis=1)]
flatness = np.exp(np.log(spec).mean(axis=1)) / spec.mean(axis=1)
zcr = (np.diff(np.sign(x)) != 0)
zcr_rate = float(zcr.mean())

# --- onset: spectral flux ---
flux = np.maximum(0, np.diff(spec, axis=0)).sum(axis=1)
flux = np.concatenate([[0], flux])
flux_n = (flux - flux.mean()) / (flux.std() + 1e-9)
# 自适应阈值峰值拾取
onset_thr = 1.2
onsets = []
last = -10
for i in range(1, len(flux_n) - 1):
    if flux_n[i] > onset_thr and flux_n[i] >= flux_n[i - 1] and flux_n[i] > flux_n[i + 1]:
        t = times[i]
        if t - last > 0.09:
            onsets.append({"t": round(float(t), 3), "strength": round(float(flux_n[i]), 2)})
            last = t

# --- 节奏估计（onset 强度自相关） ---
onset_env = np.zeros(n_frames)
for o in onsets:
    j = int(round(o["t"] * SR / hop - win / (2 * hop)))
    if 0 <= j < n_frames:
        onset_env[j] = o["strength"]
env_sr = SR / hop  # ~86 Hz
ac = np.correlate(onset_env - onset_env.mean(), onset_env - onset_env.mean(), mode="full")[len(onset_env) - 1:]
ac = ac / (ac[0] + 1e-9)
bpm_candidates = []
for bpm in np.arange(60, 200, 0.5):
    lag = 60.0 / bpm * env_sr
    if lag < len(ac) - 1:
        v = np.interp(lag, np.arange(len(ac)), ac)
        v2 = np.interp(lag * 2, np.arange(len(ac)), ac) if lag * 2 < len(ac) - 1 else 0
        bpm_candidates.append((float(v + 0.5 * v2), float(bpm)))
bpm_candidates.sort(reverse=True)
best_bpm = bpm_candidates[0][1] if bpm_candidates else None

# --- 段落能量（每0.5秒） ---
seg = int(0.5 * SR)
env = [round(float(20 * np.log10(max(np.sqrt((x[i:i + seg] ** 2).mean()), 1e-6))), 2) for i in range(0, len(x) - seg, seg)]

# --- 静音段 ---
sil_thr = np.percentile(dbfs, 10) + 6
silent = dbfs < sil_thr
sil_segments = []
start = None
for i, s in enumerate(silent):
    if s and start is None:
        start = times[i]
    elif not s and start is not None:
        if times[i] - start > 0.25:
            sil_segments.append({"start": round(float(start), 3), "end": round(float(times[i]), 3)})
        start = None
if start is not None:
    sil_segments.append({"start": round(float(start), 3), "end": round(float(times[-1]), 3)})

out = {
    "duration": round(dur, 3),
    "peak_dbfs": round(peak_db, 2),
    "rms_dbfs": round(float(dbfs.mean()), 2),
    "loudness_range_db": [round(float(np.percentile(dbfs, 5)), 2), round(float(np.percentile(dbfs, 95)), 2)],
    "loudness_curve_0p5s": env,
    "spectral_centroid_hz": {"mean": round(float(centroid.mean()), 1), "p10": round(float(np.percentile(centroid, 10)), 1), "p90": round(float(np.percentile(centroid, 90)), 1)},
    "spectral_rolloff85_hz": {"mean": round(float(np.mean(rolloff)), 1), "p90": round(float(np.percentile(rolloff, 90)), 1)},
    "spectral_flatness_mean": round(float(flatness.mean()), 4),
    "zero_crossing_rate": round(zcr_rate, 4),
    "onset_count": len(onsets),
    "onset_rate_per_sec": round(len(onsets) / dur, 2),
    "onsets": onsets,
    "bpm_estimate": best_bpm,
    "bpm_top5": [{"bpm": b, "score": round(s, 3)} for s, b in bpm_candidates[:5]],
    "silence_segments": sil_segments,
}
json.dump(out, open(OUT, "w"), ensure_ascii=False, indent=1)
print(json.dumps({k: v for k, v in out.items() if k not in ("onsets", "loudness_curve_0p5s")}, ensure_ascii=False, indent=1))
print("onsets:", [o["t"] for o in out["onsets"]])
