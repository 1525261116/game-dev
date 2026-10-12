/**
 * 皮肤注册表（SkinRegistry）—— 表现层的"选角表"。
 *
 * 它把两样东西接起来：
 *   · 磁盘上的美术资源（assets/chars/<角色>/skin.json + PNG，由 `pnpm skin:gen` 生成）
 *   · 战斗单位（units.csv 里的 charId + 武器组/品质）
 *
 * 关键约定：**纹理 key 就是资源相对路径**（如 `chars/base_male/parts/torso.png`）。
 *   好处：① 多套皮肤复用同一批 PNG 时天然共享纹理，不会重复加载
 *        ② 调试时看 key 就知道是哪张图，不用来回查表
 *
 * 加载方式：PreloadScene 用 Vite 的 `import.meta.glob` 把 assets/ 下的
 * 全部 skin.json 与 PNG 收进来（构建期静态分析，零运行时请求开销）。
 *
 * 注意：注释里不要写 glob（`星号 + 斜杠`）—— 那正好是块注释的结束符，
 * 会把后面的代码一起吃掉。踩过一次，写在这里提醒。
 */
import { weaponSkinFile } from '../../core/anim/skin.ts';
import type { SkinDef } from '../../core/anim/skin.ts';
import type { SlotName } from '../../core/anim/types.ts';

/** 已经解析好的皮肤：slot → 纹理 key */
export interface ResolvedSkin {
  id: string;
  name?: string;
  body: string;
  /** slot → 纹理 key（缺该 slot = 用色块占位回退） */
  parts: Partial<Record<SlotName, string>>;
  /** slot → 着色（0xffffff = 不换色） */
  tint: Partial<Record<SlotName, number>>;
  /** 武器组（有值时会按品质换成 weapons/ 下的共享贴图） */
  weaponGroup?: string;
}

/** 资源相对路径（assets/ 之后的部分）→ 纹理 key */
export function textureKey(relPath: string): string {
  return relPath;
}

const registry = new Map<string, ResolvedSkin>();

/** 把 Vite glob 出来的路径规范化成"相对 assets/"的形式：`chars/x/parts/y.png` */
export function toAssetRelPath(globKey: string): string {
  const marker = '/assets/';
  const i = globKey.lastIndexOf(marker);
  return i >= 0 ? globKey.slice(i + marker.length) : globKey.replace(/^\.\//, '');
}

/**
 * 注册全部皮肤。由 PreloadScene 在 preload() 阶段调用（此时纹理还没加载完，
 * 但 key 是路径推导出来的，不依赖加载结果）。
 */
export function registerSkins(defs: readonly SkinDef[], assetPaths: ReadonlySet<string>): void {
  registry.clear();
  for (const def of defs) {
    const parts: Partial<Record<SlotName, string>> = {};
    for (const [slot, part] of Object.entries(def.parts)) {
      if (!part) continue;
      // 只登记"真的有这张图"的部件，其余交给色块回退
      if (assetPaths.size > 0 && !assetPaths.has(part.file)) continue;
      parts[slot as SlotName] = textureKey(part.file);
    }

    const tint: Partial<Record<SlotName, number>> = {};
    for (const [slot, hex] of Object.entries(def.palette ?? {})) {
      if (!hex) continue;
      tint[slot as SlotName] = Number.parseInt(hex.replace('#', ''), 16);
    }

    registry.set(def.id, {
      id: def.id,
      ...(def.name ? { name: def.name } : {}),
      body: def.body,
      parts,
      tint,
      ...(def.weaponGroup ? { weaponGroup: def.weaponGroup } : {}),
    });
  }
}

export function getSkin(id: string | undefined): ResolvedSkin | null {
  if (!id) return null;
  return registry.get(id) ?? null;
}

export function listSkinIds(): string[] {
  return [...registry.keys()].sort();
}

/**
 * 取武器贴图的纹理 key。
 *
 * 设计：武器按「武器组 × 品质」共享（rig-spec §5）——
 * 玩家认知自然（"这是一把宝器剑"），且是外观付费的切入点。
 * 找不到对应品质的图时返回 null，由调用方退回角色自带的 weapon 部件。
 */
export function weaponTextureKey(group: string | undefined, quality: string | undefined): string | null {
  if (!group || !quality) return null;
  const file = weaponSkinFile(group, quality);
  return file ? textureKey(file) : null;
}

/**
 * 拿到"某个单位实际要用的皮肤"：角色皮肤 + 按品质换过的武器。
 *
 * @param charId  单位表里的 charId
 * @param group   武器组（来自单位表）
 * @param quality 主要功法的品质（决定武器外观档次）
 */
export function resolveUnitSkin(
  charId: string | undefined,
  group: string | undefined,
  quality: string | undefined,
): ResolvedSkin | null {
  const base = getSkin(charId);
  if (!base) return null;
  const weapon = weaponTextureKey(base.weaponGroup ?? group, quality);
  if (!weapon) return base;
  return { ...base, parts: { ...base.parts, weapon } };
}
