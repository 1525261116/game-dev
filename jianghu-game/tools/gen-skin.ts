/**
 * 皮肤导入器（skin generator）
 *
 *   pnpm skin:gen              # 扫描全部角色，校验并生成 skin.json
 *   pnpm skin:gen --check      # 只校验不写盘（CI 用）
 *   node tools/gen-skin.ts ren_dao --body=burly   # 单个角色 / 指定体型
 *
 * ══════════════════════════════════════════════════════════════════
 * 它解决美术最痛的三件事：
 *   ① **缺件**：17 个部件少画一个，导入期就报"缺少必需部件 torso"
 *   ② **尺寸/枢轴画错**：画布不是骨架盒的 2×、枢轴不在关节中心 —— 这两个错
 *      在游戏里表现为"穿模"，事后极难查，所以必须在这里拦住
 *   ③ **手工登记**：不需要任何人在代码里写资源列表 ——
 *      `assets/chars/<charId>/parts/<slot>.png` 的**文件名就是登记**
 *
 * 设计：本工具**零第三方依赖**（PNG 尺寸自己读文件头），因为它要能在
 *       CI 与你的笔记本上无脑跑通。
 * ══════════════════════════════════════════════════════════════════
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RIGS, DEFAULT_RIG_ID } from '../src/data/rigs.ts';
import {
  expectedSkinPivot,
  requiredSkinSlots,
  skinErrors,
  validateSkin,
  weaponSkinFile,
} from '../src/core/anim/skin.ts';
import { SLOT_NAMES } from '../src/core/anim/types.ts';
import type { SkinDef, SkinIssue, SkinPart } from '../src/core/anim/skin.ts';
import type { RigDef, SlotName } from '../src/core/anim/types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = join(HERE, '..');
const ASSETS_DIR = join(GAME_ROOT, 'assets');
const CHARS_DIR = join(ASSETS_DIR, 'chars');

/* ══════════════════ PNG 尺寸读取（零依赖） ══════════════════ */

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * 从 PNG 文件头取宽高。
 * PNG 结构固定：8 字节签名 + IHDR 块（4 字节长度 + "IHDR" + 宽 4 + 高 4）。
 * 所以宽在高在偏移 16 / 20，大端序 —— 不需要解码整张图。
 */
export function readPngSize(buf: Buffer): { w: number; h: number } {
  if (buf.length < 24) throw new Error('文件太小，不是合法 PNG');
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('不是 PNG（签名不匹配）');
  if (buf.subarray(12, 16).toString('ascii') !== 'IHDR') throw new Error('PNG 缺少 IHDR 块');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/* ══════════════════ 文件扫描 ══════════════════ */

/** 递归收集 assets/ 下全部文件（相对 assets/ 的路径，统一用 / 分隔） */
export function collectAssetFiles(dir: string = ASSETS_DIR): Set<string> {
  const out = new Set<string>();
  if (!existsSync(dir)) return out;
  const walk = (cur: string): void => {
    for (const name of readdirSync(cur)) {
      const full = join(cur, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.add(relative(ASSETS_DIR, full).split(/[\\/]/).join('/'));
    }
  };
  walk(dir);
  return out;
}

/** 列出 assets/chars 下的角色目录 */
function listCharIds(): string[] {
  if (!existsSync(CHARS_DIR)) return [];
  return readdirSync(CHARS_DIR)
    .filter((n) => statSync(join(CHARS_DIR, n)).isDirectory())
    .sort();
}

/* ══════════════════ 组装一份皮肤 ══════════════════ */

function readExisting(skinPath: string): Partial<SkinDef> {
  if (!existsSync(skinPath)) return {};
  try {
    return JSON.parse(readFileSync(skinPath, 'utf8')) as Partial<SkinDef>;
  } catch (e) {
    throw new Error(`${skinPath} 不是合法 JSON：${(e as Error).message}`);
  }
}

interface BuildResult {
  skin: SkinDef;
  issues: SkinIssue[];
}

/**
 * 由目录内容组装皮肤定义。
 *
 * @param charId  角色 id
 * @param bodyOverride 命令行 `--body=` 覆盖（新角色首次导入时用）
 * @param files   assets/ 下真实存在的文件集合
 */
export function buildSkin(charId: string, bodyOverride: string | undefined, files: Set<string>): BuildResult {
  const issues: SkinIssue[] = [];
  const skinPath = join(CHARS_DIR, charId, 'skin.json');
  const existing = readExisting(skinPath);

  const body = bodyOverride ?? existing.body ?? DEFAULT_RIG_ID;
  const rig: RigDef | undefined = RIGS[body];
  if (!rig) {
    throw new Error(`未知体型「${body}」（可用：${Object.keys(RIGS).join(' / ')}）`);
  }

  // 贴图来源：显式 art 复用别人，否则用自己的 parts/
  const artSource = existing.art ?? charId;
  const partsDir = join(CHARS_DIR, artSource, 'parts');
  const localPartsDir = join(CHARS_DIR, charId, 'parts');

  if (!existsSync(partsDir)) {
    issues.push({
      level: 'error',
      code: 'NO_PARTS_DIR',
      message: `找不到贴图目录 assets/chars/${artSource}/parts/（应为每个 slot 放一个 PNG）`,
    });
    return { skin: { id: charId, body, parts: {} }, issues };
  }

  const parts: Partial<Record<SlotName, SkinPart>> = {};
  const slotSet = new Set<string>(SLOT_NAMES);
  const seen = new Set<string>();

  for (const name of readdirSync(partsDir).sort()) {
    const ext = extname(name).toLowerCase();
    const stem = basename(name, ext);
    if (ext !== '.png') {
      issues.push({
        level: 'warn',
        code: 'NOT_PNG',
        message: `忽略非 PNG 文件：${name}（部件贴图必须是带透明通道的 PNG）`,
      });
      continue;
    }
    if (!slotSet.has(stem)) {
      issues.push({
        level: 'warn',
        code: 'UNKNOWN_FILE',
        message: `${artSource}/parts/${name}：文件名「${stem}」不是已注册 slot，可能拼错了`,
      });
      continue;
    }
    seen.add(stem);
    const slot = stem as SlotName;
    const relPath = relative(ASSETS_DIR, join(partsDir, name)).split(/[\\/]/).join('/');

    let size: { w: number; h: number };
    try {
      size = readPngSize(readFileSync(join(partsDir, name)));
    } catch (e) {
      issues.push({ level: 'error', code: 'BAD_PNG', message: `${relPath}：${(e as Error).message}` });
      continue;
    }

    const pivot = expectedSkinPivot(rig, slot) ?? [0.5, 0.5];
    parts[slot] = { file: relPath, w: size.w, h: size.h, pivot };
  }

  const skin: SkinDef = {
    id: charId,
    ...(existing.name ? { name: existing.name } : {}),
    body,
    ...(existing.art ? { art: existing.art } : {}),
    ...(existing.palette ? { palette: existing.palette } : {}),
    ...(existing.weaponGroup ? { weaponGroup: existing.weaponGroup } : {}),
    parts,
  };

  // 骨架级校验（缺件 / 尺寸 / 枢轴 / 文件存在）
  issues.push(...validateSkin(skin, rig, files));

  // 复用了别人的图，但自己也放了图 → 提醒（容易让人误以为生效了）
  if (existing.art && existsSync(localPartsDir) && readdirSync(localPartsDir).length > 0) {
    issues.push({
      level: 'warn',
      code: 'SHADOWED_PARTS',
      message: `${charId} 声明了 art=${existing.art}，本地 parts/ 里的 ${readdirSync(localPartsDir).length} 个文件会被忽略`,
    });
  }

  // 武器贴图检查（按「武器组 × 品质」共享）
  if (skin.weaponGroup) {
    for (const q of ['fan', 'liang', 'shang', 'ji', 'jue']) {
      const f = weaponSkinFile(skin.weaponGroup, q);
      if (f && !files.has(f)) {
        issues.push({
          level: 'warn',
          code: 'WEAPON_SKIN_MISSING',
          message: `缺武器贴图 assets/${f}（该品质的角色会退回手臂贴图）`,
        });
      }
    }
  }

  return { skin, issues };
}

/* ══════════════════ 主流程 ══════════════════ */

function main(): void {
  const argv = process.argv.slice(2);
  const checkOnly = argv.includes('--check');
  const bodyArg = argv.find((a) => a.startsWith('--body='))?.slice('--body='.length);
  const targets = argv.filter((a) => !a.startsWith('-'));

  console.log('=== 皮肤导入 ===');
  console.log(`资源根目录：${relative(GAME_ROOT, ASSETS_DIR)}/`);

  const files = collectAssetFiles();
  const charIds = targets.length > 0 ? targets : listCharIds();

  if (charIds.length === 0) {
    console.log('');
    console.log('assets/chars/ 下还没有任何角色目录。');
    console.log('约定：assets/chars/<charId>/parts/<slot>.png（文件名严格等于 slot 名）');
    console.log('可先跑 `node tools/gen-placeholder-art.ts` 生成一套占位贴图看效果。');
    return;
  }

  let errors = 0;
  let warns = 0;
  let wrote = 0;

  for (const charId of charIds) {
    const { skin, issues } = buildSkin(charId, bodyArg, files);
    const errs = skinErrors(issues);
    errors += errs.length;
    warns += issues.length - errs.length;

    const required = requiredSkinSlots(RIGS[skin.body]!);
    const have = Object.keys(skin.parts).length;
    console.log('');
    console.log(`── ${charId}（体型 ${skin.body}）${have}/${required.length + 2} 个部件`);
    for (const i of issues) {
      console.log(`   ${i.level === 'error' ? '✗' : '!'} [${i.code}] ${i.message}`);
    }
    if (errs.length === 0) {
      console.log(`   ✓ 通过`);
      if (!checkOnly) {
        const out = join(CHARS_DIR, charId, 'skin.json');
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, `${JSON.stringify(skin, null, 2)}\n`, 'utf8');
        console.log(`   → 已写入 ${relative(GAME_ROOT, out)}`);
        wrote++;
      }
    }
  }

  console.log('');
  if (errors > 0) {
    console.log(`✗ 有 ${errors} 个错误、${warns} 个警告 —— 未写盘（先把图改对）`);
    process.exitCode = 1;
    return;
  }
  console.log(
    checkOnly
      ? `✓ 校验通过（--check 模式，未写盘）｜警告 ${warns} 个`
      : `✓ 全部通过｜已生成 ${wrote} 份 skin.json｜警告 ${warns} 个`,
  );
  if (wrote > 0) console.log('提示：skin.json 由本工具生成，**请勿手工修改**（下次导入会覆盖）。');
}

// 仅在被直接执行时跑 main（被测试 import 时不跑）
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
