/**
 * 部件贴图对位器（fit skin part）
 *
 *   node tools/fit-skin-part.ts 原始图.png --slot=torso --body=male_adult --out=torso.png
 *   node tools/fit-skin-part.ts 原始目录/ --char=ren_dao --body=burly
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么需要它？因为 **AI 生图永远不是你要的尺寸**。
 *
 *   豆包 / 任意生图模型给你的是 1024×1024 或 768×1024，
 *   而骨架要求躯干正好 80×92、上臂正好 24×52，**关节还必须落在枢轴位置**。
 *   手工缩放 + 裁剪 = 每次都差几像素，一摆动作就穿模。
 *
 *   这个工具把"对位"变成一步：
 *     ① 抠底：把纯色背景（AI 常给的纯白/纯灰）变透明
 *     ② 裁边：去掉四周多余空白，得到内容包围盒
 *     ③ 等比缩放：按 slot 的画布尺寸做 contain / 高度 / 宽度适配
 *     ④ **对枢轴**：把"内容包围盒上的枢轴点"钉到"画布上的枢轴点"
 *
 *   第 ④ 步是关键洞察：对每个 slot 来说，**枢轴在内容包围盒上的相对位置
 *   就等于它在画布上的相对位置**（躯干枢轴 = 底边中心 → 就是腰；上臂枢轴 =
 *   顶边中心 → 就是肩）。所以"对齐"可以完全自动化，不需要人眼微调。
 *
 *   产物一定是**精确画布尺寸**，所以 `pnpm skin:gen` 的 BAD_SIZE / BAD_PIVOT
 *   这两类错误在对位阶段就被消灭了。
 * ══════════════════════════════════════════════════════════════════
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import { RIGS, DEFAULT_RIG_ID } from '../src/data/rigs.ts';
import { expectedSkinSize, fitPartGeometry, resolveFitMode } from '../src/core/anim/skin.ts';
import type { PartFitMode } from '../src/core/anim/skin.ts';
import { SLOT_NAMES } from '../src/core/anim/types.ts';
import type { RigDef, SlotName } from '../src/core/anim/types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = join(HERE, '..');
const ASSETS = join(GAME_ROOT, 'assets');

/** 透明判定阈值（0~255）：低于它的像素不算内容 */
const ALPHA_FLOOR = 10;

/* ══════════════════ 参数 ══════════════════ */

interface Options {
  input: string;
  slot: SlotName | null;
  body: string;
  out: string | null;
  char: string | null;
  key: string;
  keyTol: number;
  /** auto = 按 slot 用 DEFAULT_PART_FIT（四肢 fill、其余 contain） */
  fit: PartFitMode | 'auto';
  dry: boolean;
  pad: number;
}

function parseArgs(argv: string[]): Options {
  const flag = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const input = argv.find((a) => !a.startsWith('--')) ?? '';
  return {
    input,
    slot: (flag('slot') as SlotName | undefined) ?? null,
    body: flag('body') ?? DEFAULT_RIG_ID,
    out: flag('out') ?? null,
    char: flag('char') ?? null,
    key: flag('key') ?? 'auto',
    keyTol: Number(flag('key-tol') ?? 36),
    fit: (flag('fit') as Options['fit']) ?? 'auto',
    dry: argv.includes('--dry'),
    pad: Number(flag('pad') ?? 0),
  };
}

/* ══════════════════ 抠底 ══════════════════ */

/**
 * 把接近 `key` 的颜色变透明，带**软过渡**（抗锯齿边缘不会留一圈硬边）。
 * 返回新的 RGBA buffer；`key === 'none'` 时原样返回。
 */
function removeBackground(
  rgba: Buffer,
  w: number,
  h: number,
  key: string,
  tol: number,
): { buf: Buffer; keyed: boolean; keyColor: string | null } {
  if (key === 'none') return { buf: rgba, keyed: false, keyColor: null };

  let kr: number, kg: number, kb: number;
  if (key === 'auto') {
    // 取四角像素的中位数颜色作为背景色（AI 图多半是四角同色的纯背景）
    const corners = [
      [0, 0],
      [w - 1, 0],
      [0, h - 1],
      [w - 1, h - 1],
    ] as const;
    const samples = corners.map(([x, y]) => {
      const i = (y * w + x) * 4;
      return [rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0, rgba[i + 3] ?? 0];
    });
    // 四角必须都不透明且彼此接近，才敢认为是"纯色背景"
    const opaque = samples.every((s) => s[3]! > 200);
    const spread = Math.max(
      ...samples.map((s) => Math.abs(s[0]! - samples[0]![0]!) + Math.abs(s[1]! - samples[0]![1]!) + Math.abs(s[2]! - samples[0]![2]!)),
    );
    if (!opaque || spread > 60) return { buf: rgba, keyed: false, keyColor: null };
    const avg = (i: number) => Math.round(samples.reduce((a, s) => a + s[i]!, 0) / samples.length);
    kr = avg(0);
    kg = avg(1);
    kb = avg(2);
  } else {
    const hex = key.replace('#', '');
    kr = Number.parseInt(hex.slice(0, 2), 16);
    kg = Number.parseInt(hex.slice(2, 4), 16);
    kb = Number.parseInt(hex.slice(4, 6), 16);
  }

  const out = Buffer.from(rgba); // 复制一份，不改原数据
  const half = tol / 2;
  for (let i = 0; i < out.length; i += 4) {
    const dr = (out[i] ?? 0) - kr;
    const dg = (out[i + 1] ?? 0) - kg;
    const db = (out[i + 2] ?? 0) - kb;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist <= half) {
      out[i + 3] = 0;
    } else if (dist < tol) {
      // 软过渡：距离越近越透明，避免锯齿白边
      const t = (dist - half) / half;
      out[i + 3] = Math.round((out[i + 3] ?? 0) * t);
    }
  }
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return { buf: out, keyed: true, keyColor: `#${hex(kr)}${hex(kg)}${hex(kb)}` };
}

/* ══════════════════ 内容包围盒 ══════════════════ */

function contentBox(rgba: Buffer, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((rgba[(y * w + x) * 4 + 3] ?? 0) >= ALPHA_FLOOR) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/* ══════════════════ 核心：对位 ══════════════════ */

export interface FitReport {
  slot: SlotName;
  srcSize: string;
  contentBox: string;
  scale: number;
  outputSize: string;
  keyed: string;
  anchor: string;
}

/**
 * 把一张原始图对位成"精确画布尺寸 + 枢轴正确"的部件贴图。
 *
 * @returns 输出 PNG 的字节 + 一份人类可读的报告
 */
export async function fitPart(
  rawPath: string,
  slot: SlotName,
  rig: RigDef,
  opts: Pick<Options, 'key' | 'keyTol' | 'fit' | 'pad'>,
): Promise<{ png: Buffer; report: FitReport }> {
  const size = expectedSkinSize(rig, slot);
  if (!size) throw new Error(`体型 ${rig.id} 没有「${slot}」这个部件`);
  const bone = rig.bones.find((b) => b.slot === slot)!;
  const px = bone.pivot?.x ?? 0.5;
  const py = bone.pivot?.y ?? 0.5;

  const targetW = size.w;
  const targetH = size.h;

  // ① 读原图 → RGBA
  const src = sharp(readFileSync(rawPath)).ensureAlpha();
  const meta = await src.metadata();
  const sw = meta.width ?? 0;
  const sh = meta.height ?? 0;
  const { data } = await src.raw().toBuffer({ resolveWithObject: true });

  // ② 抠底
  const { buf: keyedBuf, keyed, keyColor } = removeBackground(data, sw, sh, opts.key, opts.keyTol);

  // ③ 内容包围盒
  const box = contentBox(keyedBuf, sw, sh);
  if (!box) throw new Error(`${basename(rawPath)}：抠底后没有任何不透明内容（背景色判断错了？试试 --key=none）`);

  // ④⑤⑥ 缩放 + 对枢轴（几何在 core 里，可零依赖测试）
  const mode = resolveFitMode(slot, opts.fit);
  const fit = fitPartGeometry({ w: box.w, h: box.h }, { w: targetW, h: targetH }, { x: px, y: py }, mode);
  const { destW, destH } = fit;

  // ⑤ 裁到内容盒 → 缩放到目标尺寸（lanczos 保细节）
  const part = await sharp(keyedBuf, { raw: { width: sw, height: sh, channels: 4 } })
    .extract({ left: box.x, top: box.y, width: box.w, height: box.h })
    .resize(destW, destH, { kernel: 'lanczos3', fit: 'fill' })
    .raw()
    .toBuffer();

  const left = fit.left;
  const top = fit.top;

  // ⑦ 画布 + blit（带裁剪，允许部件略微超出画布 —— 相邻部件本来就要重叠）
  const canvas = Buffer.alloc(targetW * targetH * 4, 0);
  const srcLeft = Math.max(0, -left);
  const srcTop = Math.max(0, -top);
  const dstLeft = Math.max(0, left);
  const dstTop = Math.max(0, top);
  const copyW = Math.min(destW - srcLeft, targetW - dstLeft);
  const copyH = Math.min(destH - srcTop, targetH - dstTop);
  for (let y = 0; y < copyH; y++) {
    const from = ((srcTop + y) * destW + srcLeft) * 4;
    const to = ((dstTop + y) * targetW + dstLeft) * 4;
    part.copy(canvas, to, from, from + copyW * 4);
  }

  const png = await sharp(canvas, { raw: { width: targetW, height: targetH, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();

  return {
    png,
    report: {
      slot,
      srcSize: `${sw}×${sh}`,
      contentBox: `${box.w}×${box.h} @${box.x},${box.y}`,
      scale: Math.round(fit.scale * 1000) / 1000,
      outputSize: `${targetW}×${targetH}`,
      keyed: keyed ? `是（${keyColor}，tol=${opts.keyTol}）` : '否',
      anchor: `[${mode}] 枢轴 ${px},${py} → 画布 (${Math.round(px * targetW)}, ${Math.round(py * targetH)}) 已钉住`,
    },
  };
}

/* ══════════════════ CLI ══════════════════ */

function printReport(name: string, r: FitReport): void {
  console.log(`  · ${name}`);
  console.log(`      原始 ${r.srcSize}　内容 ${r.contentBox}　缩放 ${r.scale}×　→ 输出 ${r.outputSize}`);
  console.log(`      抠底：${r.keyed}　${r.anchor}`);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const rig = RIGS[opts.body];
  if (!rig) throw new Error(`未知体型「${opts.body}」（可用：${Object.keys(RIGS).join(' / ')}）`);

  console.log('=== 部件贴图对位 ===');
  console.log(`体型 ${opts.body}　抠底 ${opts.key}　适配 ${opts.fit}（auto = 四肢 fill、其余 contain）`);

  // ── 单个文件模式 ──
  if (!opts.char) {
    if (!opts.input || !opts.slot || !opts.out) {
      console.log('');
      console.log('用法：');
      console.log('  node tools/fit-skin-part.ts 原始图.png --slot=torso --body=male_adult --out=输出/torso.png');
      console.log('  node tools/fit-skin-part.ts 原始目录/ --char=ren_dao --body=burly [--dry]');
      console.log('');
      console.log('可选参数：--key=auto|none|#rrggbb（默认 auto）　--key-tol=36　--fit=auto|contain|height|width|fill');
      return;
    }
    if (!SLOT_NAMES.includes(opts.slot)) throw new Error(`未知 slot：${opts.slot}`);
    const { png, report } = await fitPart(opts.input, opts.slot, rig, opts);
    if (!opts.dry) {
      mkdirSync(dirname(opts.out), { recursive: true });
      writeFileSync(opts.out, png);
    }
    printReport(relative(GAME_ROOT, opts.input), report);
    console.log('');
    console.log(opts.dry ? '（--dry：未写盘）' : `✓ 已写出 ${relative(GAME_ROOT, opts.out)}`);
    return;
  }

  // ── 批量模式：原始目录里放 <slot>.png ──
  if (!existsSync(opts.input)) throw new Error(`找不到目录：${opts.input}`);
  const outDir = join(ASSETS, 'chars', opts.char, 'parts');
  const files = readdirSync(opts.input).filter((f) => extname(f).toLowerCase() === '.png');
  if (files.length === 0) throw new Error(`${opts.input} 里没有 PNG`);

  console.log(`原始目录 ${relative(GAME_ROOT, opts.input)} → 目标 assets/chars/${opts.char}/parts/`);
  console.log('');

  let ok = 0;
  const skipped: string[] = [];
  for (const file of files.sort()) {
    const slot = basename(file, extname(file)) as SlotName;
    if (!SLOT_NAMES.includes(slot)) {
      skipped.push(`${file}（文件名不是已注册 slot）`);
      continue;
    }
    if (!rig.bones.some((b) => b.slot === slot)) {
      skipped.push(`${file}（体型 ${rig.id} 没有这个部件）`);
      continue;
    }
    try {
      const { png, report } = await fitPart(join(opts.input, file), slot, rig, opts);
      if (!opts.dry) {
        mkdirSync(outDir, { recursive: true });
        writeFileSync(join(outDir, file), png);
      }
      printReport(file, report);
      ok++;
    } catch (e) {
      skipped.push(`${file}：${(e as Error).message}`);
    }
  }

  console.log('');
  console.log(`完成：对位 ${ok} 张${opts.dry ? '（--dry：未写盘）' : `，已写入 ${relative(GAME_ROOT, outDir)}`}`);
  if (skipped.length > 0) {
    console.log('跳过：');
    for (const s of skipped) console.log(`  ! ${s}`);
  }
  console.log('');
  console.log('下一步：pnpm skin:gen（校验 + 生成 skin.json）→ 刷新浏览器');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main();
}
