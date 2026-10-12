#!/usr/bin/env bash
# 把真实画面渲染成 PNG 序列（视觉验证 / 画面回归）
#
# 用法：
#   tools/ci/render_frames.sh [场景路径] [帧数] [输出目录] [分辨率]
#
# 关键：**不能加 --headless**（headless 会强制 dummy 渲染驱动，不出图）。
#       Godot 可在无交互桌面会话下渲染，因此可用于 CI 与 AI 自动验证。
set -euo pipefail

GODOT="${GODOT_BIN:-/Applications/Godot.app/Contents/MacOS/Godot}"
if [ ! -x "$GODOT" ]; then
  # 常见备选位置
  for c in "$HOME/Downloads/Godot.app/Contents/MacOS/Godot" \
           "/Applications/Godot.app/Contents/MacOS/Godot"; do
    [ -x "$c" ] && GODOT="$c" && break
  done
fi
[ -x "$GODOT" ] || { echo "找不到 Godot 可执行文件，请设置 GODOT_BIN"; exit 1; }

SCENE="${1:-}"
FRAMES="${2:-24}"
OUT_DIR="${3:-build/frames}"
RES="${4:-1280x720}"

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
rm -rf "$PROJECT_DIR/$OUT_DIR"
mkdir -p "$PROJECT_DIR/$OUT_DIR"

ARGS=(--path "$PROJECT_DIR" --write-movie "$PROJECT_DIR/$OUT_DIR/frame.png"
      --quit-after "$FRAMES" --resolution "$RES" --disable-vsync)
[ -n "$SCENE" ] && ARGS+=(--scene "$SCENE")

echo "▶ 渲染 ${FRAMES} 帧 → ${OUT_DIR}（${RES}）"
"$GODOT" "${ARGS[@]}" 2>&1 | grep -vE "editor_settings|resource_format_text" | tail -8

COUNT=$(ls "$PROJECT_DIR/$OUT_DIR"/*.png 2>/dev/null | wc -l | tr -d ' ')
echo "✅ 产出 ${COUNT} 张 PNG → ${OUT_DIR}"
