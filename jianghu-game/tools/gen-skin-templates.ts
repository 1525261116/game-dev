/**
 * 枢轴模板生成器（pivot guide templates）
 *
 *   pnpm skin:templates          # 生成 3 体型 × 17 部件的对齐模板
 *
 * ══════════════════════════════════════════════════════════════════
 * 它解决 AI 生图最大的落地难点：**枢轴（关节旋转中心）对不准**。
 *
 *   贴图能不能用，尺寸只占一半，另一半是"关节在画布里的位置"。
 *   枢轴错了，游戏里一摆动作就穿模，而且事后极难修 —— 只能重画。
 *
 *   所以这里对每个 slot 生成一张**带十字准星与刻度**的模板 PNG：
 *     ① 画布尺寸 = 骨架绘制盒 × 2（与最终贴图完全一致）
 *     ② 十字交点 = 必须放关节的位置（如躯干是"底部中心"= 腰）
 *     ③ 圆环 = 关节旋转半径参考
 *     ④ 左上角标注 slot 名 / 尺寸 / 枢轴百分比
 *
 *   用法：在 Photoshop / 剪映 / 任何编辑器里把这张模板当**底层**，
 *   把 AI 生成的角色部件放到上层，缩放并平移，**让关节落在十字上**，
 *   然后裁切到画布尺寸、隐藏模板层、导出为 <slot>.png。
 *
 *   模板只用于对齐，**不参与游戏运行**，产物放在 `templates/`（不是 assets/）。
 * ══════════════════════════════════════════════════════════════════
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import { RIGS } from '../src/data/rigs.ts';
import { ART_SCALE, expectedSkinSize } from '../src/core/anim/skin.ts';
import type { SlotName } from '../src/core/anim/types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = join(HERE, '..');
const OUT_DIR = join(GAME_ROOT, 'templates', 'skin');

const force = process.argv.includes('--force');
const PIVOT_COLOR = '#ff2d95';

/**
 * 模板放大倍数。
 *
 * 为什么不是 1×？因为有些部件画布只有 14×112（武器）、24×52（上臂）——
 * 那个尺寸下文字不可读、十字准星也只有 1px 粗，**没法用来目视对齐**。
 * 放大 4× 后仍然"归一化枢轴"不变（枢轴是百分比坐标，缩放不影响），
 * 所以对齐结果按 1/4 缩放回去依然精确。
 */
const ZOOM = 4;

/** slot → 中文名（模板标注用；ASCII 之外的字符在部分渲染环境会变方框，所以画在上方的小字里） */
const SLOT_HINT: Record<SlotName, string> = {
  pelvis: 'hip root, center',
  torso: 'waist, bottom center',
  head: 'neck, bottom center',
  upperArmL: 'shoulder L, top',
  upperArmR: 'shoulder R, top',
  forearmL: 'elbow L, top',
  forearmR: 'elbow R, top',
  handL: 'wrist L, top',
  handR: 'wrist R, top',
  thighL: 'hip L, top',
  thighR: 'hip R, top',
  shinL: 'knee L, top',
  shinR: 'knee R, top',
  footL: 'ankle L, 25% / mid',
  footR: 'ankle R, 25% / mid',
  cloak: 'neck back, top 5%',
  weapon: 'grip, top 12%',
};

/**
 * 生成一张对齐模板。
 *
 * 画布与最终贴图**完全同尺寸**，这样"对齐 → 裁切 → 导出"不需要再做任何换算，
 * 也就不会在缩放上引入误差。
 */
function guideSvg(slot: SlotName, baseW: number, baseH: number, px: number, py: number): string {
  // 画在放大后的画布上，但标注写**真实尺寸**，避免被 4× 误导
  const w = baseW * ZOOM;
  const h = baseH * ZOOM;
  const cx = w * px;
  const cy = h * py;
  const ring = Math.max(6, Math.min(w, h) * 0.18);
  const tick = 10;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.86"/>
      <stop offset="1" stop-color="#dfe3e8" stop-opacity="0.86"/>
    </linearGradient>
  </defs>
  <!-- 半透明底：既能看清图形，又方便直接叠在 AI 图上层对齐 -->
  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="url(#bg)" stroke="#8792a2" stroke-width="1"/>

  <!-- 九宫格参考线（每 10%）-->
  ${[1, 2, 3, 4, 5, 6, 7, 8, 9]
    .map((i) => `<line x1="${(w * i) / 10}" y1="0" x2="${(w * i) / 10}" y2="${h}" stroke="#9aa4b2" stroke-width="0.5" stroke-dasharray="3 5"/>`)
    .join('\n  ')}
  ${[1, 2, 3, 4, 5, 6, 7, 8, 9]
    .map((i) => `<line x1="0" y1="${(h * i) / 10}" x2="${w}" y2="${(h * i) / 10}" stroke="#9aa4b2" stroke-width="0.5" stroke-dasharray="3 5"/>`)
    .join('\n  ')}

  <!-- 枢轴十字准星 -->
  <line x1="${cx}" y1="0" x2="${cx}" y2="${h}" stroke="${PIVOT_COLOR}" stroke-width="1.4" stroke-opacity="0.9"/>
  <line x1="0" y1="${cy}" x2="${w}" y2="${cy}" stroke="${PIVOT_COLOR}" stroke-width="1.4" stroke-opacity="0.9"/>
  <circle cx="${cx}" cy="${cy}" r="${ring}" fill="none" stroke="${PIVOT_COLOR}" stroke-width="1.2" stroke-opacity="0.75"/>
  <circle cx="${cx}" cy="${cy}" r="2.4" fill="${PIVOT_COLOR}"/>
  <!-- 四角刻度：提示"部件可以略微超出画布 8~12px 用于重叠" -->
  <line x1="${cx - tick}" y1="${cy}" x2="${cx + tick}" y2="${cy}" stroke="#ffffff" stroke-width="2.6" stroke-opacity="0.8"/>
  <line x1="${cx}" y1="${cy - tick}" x2="${cx}" y2="${cy + tick}" stroke="#ffffff" stroke-width="2.6" stroke-opacity="0.8"/>
  <line x1="${cx - tick}" y1="${cy}" x2="${cx + tick}" y2="${cy}" stroke="${PIVOT_COLOR}" stroke-width="1"/>
  <line x1="${cx}" y1="${cy - tick}" x2="${cx}" y2="${cy + tick}" stroke="${PIVOT_COLOR}" stroke-width="1"/>

  <!-- 标注：窄画布（如武器 14px）也放得下，所以分两行写 -->
  <rect x="0" y="0" width="${w}" height="15" fill="#1c1c20" fill-opacity="0.78"/>
  <text x="4" y="10" font-family="Menlo, monospace" font-size="9" fill="#f4f6f8">${slot}　${baseW}x${baseH}px　pivot=${px},${py}　(guide ${ZOOM}x)</text>
  <text x="4" y="${h - 6}" font-family="Menlo, monospace" font-size="9" fill="#3b4350">${SLOT_HINT[slot]}　|　关节必须落在粉色十字</text>
</svg>`;
}

async function main(): Promise<void> {
  console.log('=== 枢轴对齐模板生成 ===');
  console.log(`输出目录：${OUT_DIR.replace(`${GAME_ROOT}/`, '')}/`);

  let count = 0;
  for (const [bodyId, rig] of Object.entries(RIGS)) {
    const dir = join(OUT_DIR, bodyId);
    mkdirSync(dir, { recursive: true });
    console.log(`\n── ${bodyId}（身高 ${rig.height}px）`);
    for (const bone of rig.bones) {
      const size = expectedSkinSize(rig, bone.slot);
      if (!size) continue;
      const px = bone.pivot?.x ?? 0.5;
      const py = bone.pivot?.y ?? 0.5;
      const file = join(dir, `${bone.slot}.png`);
      if (!force && existsSync(file)) continue;
      await sharp(Buffer.from(guideSvg(bone.slot, size.w, size.h, px, py)))
        .png({ compressionLevel: 9 })
        .toFile(file);
      count++;
      console.log(`  + ${bone.slot}.png  画布 ${size.w}×${size.h}（导出版本 ${size.w * ZOOM}×${size.h * ZOOM}）  枢轴 ${px},${py}`);
    }
  }

  const readme = `# 枢轴对齐模板（skin templates）

> 由 \`pnpm skin:templates\` 生成，**请勿手工修改**（要重生成加 \`--force\`）。

## 这是什么

每个 slot 一张模板 PNG：**粉色十字交点 = 关节必须落在这里的位置**。

⚠️ 模板是 **${ZOOM}× 放大版**（画布太小没法目视对齐：武器只有 14×112、上臂 24×52）。
枢轴是百分比坐标，缩放不影响它 —— 所以用放大版对齐后，整体缩到 **1/${ZOOM}** 导出即可，
误差 <1 px。**文件里标注的尺寸是真实画布尺寸**，不是模板文件尺寸。

| 目录 | 对应体型 |
|------|----------|
| \`male_adult/\` | 成年男（148px） |
| \`female_adult/\` | 成年女（139px） |
| \`burly/\` | 魁梧 / BOSS（166px） |

真实画布 = 骨架绘制盒 × ${ART_SCALE}（@${ART_SCALE}× 作画规范，见 \`docs/rig-spec.md\` §4）；
模板文件 = 真实画布 × ${ZOOM}。

> 更省事的做法：用 \`node tools/fit-skin-part.ts\` —— 它自动抠底、裁边、
> 缩放并把关节对到枢轴上，一步产出**精确尺寸**的 PNG。模板留给"手调"和"核对"。

## 怎么用（对齐 → 裁切 → 导出）

1. 在编辑器里打开对应体型、对应 slot 的模板
2. 把 AI 生成的部件放到**上一层**，缩放/平移，直到**关节正好压在粉色十字**上
   （躯干 = 腰部在底部中心；上臂 = 肩膀在顶部中心；脚 = 踝在距左端 25% 处……模板左下角写了该 slot 的关节位置）
3. 裁切 / 导出为与画布**完全同尺寸**的 PNG，隐藏模板层、保留透明背景
4. 命名严格等于 slot 名，覆盖到 \`jianghu-game/assets/chars/<角色>/parts/<slot>.png\`
5. 跑 \`pnpm skin:gen\` —— 尺寸或枢轴不对会直接报错并告诉你应该是多少

## 两条容易忘的规则

| 规则 | 原因 |
|------|------|
| 部件可**略微超出画布**（相邻部件重叠 8~12px） | 旋转时露缝；模板的九宫格线只作参考，不是硬边界 |
| 统一**面向右** 3/4 视角 | 朝左由程序镜像，省一半贴图 |

> 只画了一部分也能试穿：在 \`skin.json\` 里声明 \`art\`（底图角色），
> 没画的部件会自动继承底图 —— 见 \`docs/asset-pipeline.md\`。
`;
  writeFileSync(join(OUT_DIR, 'README.md'), readme, 'utf8');

  console.log('');
  console.log(`完成：生成 ${count} 张模板（已存在且未加 --force 的会跳过）。`);
  console.log('用法：把模板垫在底层 → 让关节落在粉色十字上 → 裁切导出同名 PNG。');
}

void main();
