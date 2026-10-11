/**
 * 功法威力与属性换算表（数值口径全部来自 GDD，禁止自行发明）
 *
 * 来源：jianghu-design/GDD/03_数值框架.md §3.1.4
 *       jianghu-design/08_balance/战斗数值.md §一、§二
 *
 * 这里只放**数值**，公式在 core/battle/formula.ts，两者分开是为了：
 *   调平衡时只改本文件，不需要看懂任何公式代码。
 */
import type { Quality } from './gongfa_visual.ts';

/* ══════════════════════ 一级属性 → 二级属性 ══════════════════════ */

/** 攻击力 = 臂力 × 3 + 装备攻击 */
export function toAtk(armStrength: number, equipAtk = 0): number {
  return armStrength * 3 + equipAtk;
}

/** 防御力 = 根骨 × 1.5 + 装备防御 */
export function toDef(bone: number, equipDef = 0): number {
  return bone * 1.5 + equipDef;
}

/** 气血 = 根骨 × 20 + 装备气血 + 内功气血 */
export function toHpMax(bone: number, equipHp = 0, innerHp = 0): number {
  return bone * 20 + equipHp + innerHp;
}

/** 内力 = 内息 × 10 + 内功内力 */
export function toInner(breath: number, innerBonus = 0): number {
  return breath * 10 + innerBonus;
}

/** 命中 / 闪避：每 10 点身法 = +1%（即 身法 × 0.001） */
export function agilityToRate(agility: number): number {
  return (agility / 10) * 0.01;
}

/**
 * 暴击率 = 5% + 臂力/10% + 装备/词条
 * 注意上限 75%（GDD 03 §3.1.1）
 */
export const CRIT_RATE_CAP = 0.75;

/** 暴击伤害倍率上限 300% */
export const CRIT_DAMAGE_CAP = 3.0;

/** 闪避上限 60% */
export const DODGE_CAP = 0.6;

/** 命中区间 5% ~ 95% */
export const HIT_RANGE = { min: 0.05, max: 0.95 } as const;

/* ══════════════════════ 功法威力 ══════════════════════ */

/**
 * 品质基础威力（GDD 03 §3.1.4）
 * 凡品 10 ／ 良品 20 ／ 上品 35 ／ 极品 55 ／ 绝世 80
 */
export const QUALITY_POWER: Record<Quality, number> = {
  fan: 10,
  liang: 20,
  shang: 35,
  ji: 55,
  jue: 80,
};

/** 品质中文名（UI 显示用） */
export const QUALITY_NAME: Record<Quality, string> = {
  fan: '凡品',
  liang: '良品',
  shang: '上品',
  ji: '极品',
  jue: '绝世',
};

/**
 * 功法境界十档与倍率（GDD 03 §3.1.4）
 * 平衡意图：凡品练满（80）= 绝世未练（80），勤奋可弥补品质；
 *           但高品质天花板始终更高（绝世满 640）。
 */
export const GONGFA_REALMS = [
  { id: 'chujiao', name: '初窥门径', multiplier: 1.0 },
  { id: 'lveyou', name: '略有小成', multiplier: 1.2 },
  { id: 'dengtang', name: '登堂入室', multiplier: 1.5 },
  { id: 'ronghui', name: '融会贯通', multiplier: 1.9 },
  { id: 'luhuo', name: '炉火纯青', multiplier: 2.6 },
  { id: 'dengfeng', name: '登峰造极', multiplier: 3.3 },
  { id: 'chushen', name: '出神入化', multiplier: 4.3 },
  { id: 'daqiao', name: '大巧若拙', multiplier: 5.4 },
  { id: 'chaofan', name: '超凡入圣', multiplier: 6.6 },
  { id: 'tianren', name: '天人合一', multiplier: 8.0 },
] as const;

export type GongfaRealmId = (typeof GONGFA_REALMS)[number]['id'];

/** 按 id 取境界倍率；找不到时兜底为最低档 ×1.0 */
export function realmMultiplier(realmId: string): number {
  return GONGFA_REALMS.find((r) => r.id === realmId)?.multiplier ?? 1.0;
}

/**
 * 功法威力（**已含 ×3，可直接进伤害公式**）
 *
 * 公式：最终威力 = 品质基础威力 × 境界倍率；入伤害公式时再 ×3。
 * 例：上品·登峰造极 = 35 × 3.3 × 3 = 346.5
 */
export function gongfaPower(quality: Quality, realmId: string): number {
  return QUALITY_POWER[quality] * realmMultiplier(realmId) * 3;
}
