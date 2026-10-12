# video-analysis · 无 ffmpeg 环境下的视频分析工具链

> 本机没有可用 ffmpeg（系统未装；剪映内置 `ffmpeg` 启动即 SIGTRAP），pip 环境也无 cv2 / imageio。
> 因此按 macOS 原生能力自建了这条链路：**AVFoundation 抽帧/取音 + Python(numpy/Pillow) 分析 + 输出报告素材**。

## 文件

| 文件 | 语言 | 作用 |
|------|------|------|
| `vprobe.m` | Objective-C | `info` 轨道探测 ｜ `range` 精确抽帧(JPEG) ｜ `pcm` 抽 float32 单声道 PCM |
| `analyze_frames.py` | Python | 镜头切分、亮度/饱和/暖度/边缘密度、**接触表（contact sheet）** |
| `analyze_motion.py` | Python | 打击峰值、闪白、**黑白立绘演出检测**、视觉节拍自相关、时间轴 PNG |
| `analyze_audio.py` | Python | 响度包络、起音检测、BPM、频谱质心/滚降/平坦度、静音段 |
| `spectrogram.py` | Python | 频谱图+波形+RMS 图、频段能量占比、起音间隔(IOI)直方图、chroma |
| `vprobe.swift` | Swift | 早期版本，**当前 SDK 与工具链版本不匹配无法编译**，仅留档 |

## 编译与使用

```bash
cd jianghu-tools/video-analysis
clang -fobjc-arc -fmodules-cache-path=./build/modulecache -o build/vprobe vprobe.m \
  -framework Foundation -framework AVFoundation -framework CoreMedia \
  -framework CoreGraphics -framework AppKit

# 探测
./build/vprobe info <video>
# 抽帧: range <video> <outDir> <start> <end> <fps> <maxWidth> [exact 0|1]
./build/vprobe range <video> out/frames_3fps  0 41.4 3  640 0     # 概览
./build/vprobe range <video> out/frames_12fps 0 41.4 12 320 0     # 运动分析
./build/vprobe range <video> out/frames_full  16.5 16.5 1 1280 1  # 关键帧全分辨率
# 取音（mono float32）
./build/vprobe pcm <video> out/audio_22050.raw 22050

# 分析（PY = 项目自带 python: $DSH 运行时 python，含 numpy/Pillow）
$PY analyze_frames.py out/frames_3fps  out/analysis
$PY analyze_motion.py out/frames_12fps out/analysis
$PY analyze_audio.py  out/audio_22050.raw 22050 out/analysis/audio.json
$PY spectrogram.py    out/audio_22050.raw 22050 out/analysis/spectrogram.png
```

`out/` 与 `build/` 已被根 `.gitignore` 忽略（抽帧产物很大，不入库）。

## 已产出的报告

- `jianghu-references/07_style/战斗演出风格分析_2026-10/`（横版自动回合制战斗演出风格）

## 已知限制

- `AVAssetImageGenerator` 在 `exact=0` 时允许 ±20 ms 误差（换取 3–5× 速度），做节拍量化足够；需精确帧用 `exact=1`。
- 音频只能定性判断（源为 AAC mono 49 kbps）。
- BPM 估计用起音包络自相关，对"打击音效密集"的素材会偏弱，需与 IOI 直方图交叉验证。
