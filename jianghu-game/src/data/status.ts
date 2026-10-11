/**
 * 状态效果定义表（22 种）——对齐《烟雨江湖》的 BUFF/状态体系。
 * 数值见 GDD 02_系统设计.md §2.1-9）。
 */
import type { StatusDef, StatusId } from '../core/battle/types.ts';

export const STATUS_DEFS: readonly StatusDef[] = [
  /* ------------------------------------------------ 控制（4） */
  {
    id: 'stun',
    name: '眩晕',
    kind: 'control',
    duration: 1,
    maxStacks: 1,
    dispellable: false,
    blockedBy: 'immuneFirstControl',
    special: '无法行动',
  },
  {
    id: 'seal',
    name: '封穴',
    kind: 'control',
    duration: 2,
    maxStacks: 1,
    dispellable: true,
    special: '无法释放功法，只能普攻',
  },
  {
    id: 'root',
    name: '定身',
    kind: 'control',
    duration: 2,
    maxStacks: 1,
    dispellable: true,
    mods: { dodge: -1 },
    special: '闪避归零（按 -100% 处理）',
  },
  {
    id: 'knockback',
    name: '击退',
    kind: 'control',
    duration: 1,
    maxStacks: 1,
    dispellable: false,
    blockedBy: 'ironWall',
    special: '出手顺位后移 3 位',
  },

  /* ------------------------------------------------ 减益（9） */
  { id: 'defDown', name: '破防', kind: 'debuff', duration: 2, maxStacks: 1, dispellable: true, blockedBy: 'ironWall', mods: { def: -0.3 } },
  { id: 'atkDown', name: '虚弱', kind: 'debuff', duration: 2, maxStacks: 1, dispellable: true, mods: { atk: -0.25 } },
  { id: 'spdDown', name: '迟滞', kind: 'debuff', duration: 2, maxStacks: 1, dispellable: true, mods: { spd: -0.3 } },
  { id: 'innerDown', name: '内伤', kind: 'debuff', duration: 3, maxStacks: 1, dispellable: true, mods: { innerRegen: -0.5 } },
  {
    id: 'poison',
    name: '中毒',
    kind: 'debuff',
    duration: 3,
    maxStacks: 3,
    dispellable: true,
    dot: { percent: 0.05, basis: 'maxHp' },
  },
  {
    id: 'bleed',
    name: '流血',
    kind: 'debuff',
    duration: 2,
    maxStacks: 5,
    dispellable: true,
    dot: { percent: 0.03, basis: 'currentHp' },
  },
  {
    id: 'burn',
    name: '灼烧',
    kind: 'debuff',
    duration: 2,
    maxStacks: 1,
    dispellable: true,
    dot: { percent: 0.04, basis: 'maxHp' },
    mods: { damageTaken: 0.1 },
  },
  { id: 'dodgeDown', name: '减闪避', kind: 'debuff', duration: 2, maxStacks: 1, dispellable: true, mods: { dodge: -0.2 } },
  { id: 'hitDown', name: '乱神', kind: 'debuff', duration: 2, maxStacks: 1, dispellable: true, mods: { hit: -0.25 } },

  /* ------------------------------------------------ 增益（9） */
  { id: 'shield', name: '护体', kind: 'buff', duration: 2, maxStacks: 1, dispellable: false, mods: { damageTaken: -0.25 } },
  { id: 'berserk', name: '狂暴', kind: 'buff', duration: 3, maxStacks: 1, dispellable: false, mods: { atk: 0.3, def: -0.15 } },
  { id: 'haste', name: '疾行', kind: 'buff', duration: 2, maxStacks: 1, dispellable: false, mods: { spd: 0.4 } },
  {
    id: 'regen',
    name: '回春',
    kind: 'buff',
    duration: 3,
    maxStacks: 1,
    dispellable: false,
    dot: { percent: -0.04, basis: 'maxHp' },
    special: '每回合回复 4% 最大气血（dot 为负值 = 治疗）',
  },
  { id: 'ironWall', name: '铁壁', kind: 'buff', duration: 2, maxStacks: 1, dispellable: false, special: '免疫击退与破防' },
  { id: 'swordHeart', name: '剑心', kind: 'buff', duration: 2, maxStacks: 1, dispellable: false, mods: { crit: 0.2 } },
  { id: 'charge', name: '蓄力', kind: 'buff', duration: 1, maxStacks: 1, dispellable: false, mods: { damageDealt: 0.5 }, special: '下次功法伤害 +50%，出手后移除' },
  { id: 'innerFlow', name: '回气', kind: 'buff', duration: 2, maxStacks: 1, dispellable: false, mods: { innerRegen: 1.0 } },
  { id: 'thorns', name: '反震', kind: 'buff', duration: 2, maxStacks: 1, dispellable: false, special: '受击反弹 20% 伤害' },
];

export const STATUS_BY_ID: Record<StatusId, StatusDef> = Object.fromEntries(
  STATUS_DEFS.map((s) => [s.id, s]),
) as Record<StatusId, StatusDef>;

export function getStatus(id: StatusId): StatusDef {
  const s = STATUS_BY_ID[id];
  if (!s) throw new Error(`未定义的状态: ${id}`);
  return s;
}

export const STATUS_STATS = {
  total: STATUS_DEFS.length,
  byKind: {
    control: STATUS_DEFS.filter((s) => s.kind === 'control').length,
    debuff: STATUS_DEFS.filter((s) => s.kind === 'debuff').length,
    buff: STATUS_DEFS.filter((s) => s.kind === 'buff').length,
  },
  stackable: STATUS_DEFS.filter((s) => s.maxStacks > 1).map((s) => s.id),
  dispellable: STATUS_DEFS.filter((s) => s.dispellable).length,
} as const;
