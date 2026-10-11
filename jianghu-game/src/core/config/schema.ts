/**
 * 配置表契约（zod schema，纯逻辑）
 *
 * 作用：**在表格进入游戏之前**就把脏数据挡在门外。
 *
 * 为什么必须做这一步？
 *   表格是给人手改的，人手一定会打错：把 0.15 写成 15、把 slot 写成 12、
 *   把功法 id 拼错。如果不校验，这些错误会一路溜到战斗里，
 *   表现为"伤害莫名其妙"或"技能不出手"——排查起来极其痛苦。
 *   在这里挡下来，报错会直接告诉你"第 5 行第 3 列写错了"。
 *
 * 注意：本文件属于 core 层，**禁止 import Phaser**。
 */
import { z } from 'zod';
import { MOTION_GROUPS } from '../anim/types.ts';

/* ══════════════════ 枚举取值（与代码保持一致） ══════════════════ */

export const QUALITIES = ['fan', 'liang', 'shang', 'ji', 'jue'] as const;
export const TARGET_SHAPES = ['single', 'column', 'row', 'all'] as const;

/** 状态 id 白名单：与 src/data/status.ts 的 STATUS_DEFS 保持一致 */
export const STATUS_IDS = [
  'stun', 'seal', 'root', 'knockback',
  'defDown', 'atkDown', 'spdDown', 'innerDown', 'poison', 'bleed', 'burn', 'dodgeDown', 'hitDown',
  'shield', 'berserk', 'haste', 'regen', 'ironWall', 'swordHeart', 'charge', 'innerFlow', 'thorns',
] as const;

/* ══════════════════ 工具：CSV 空字符串 → undefined ══════════════════ */

/**
 * CSV 里的空单元格读出来是 ''，但业务上它表示"没有这个字段"。
 * 这个小工具负责转换，避免把 '' 当成有效值传下去。
 */
const emptyToUndefined = (v: unknown): unknown =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

/** 可选数字：空 → undefined，否则强制转数字 */
const optionalNumber = z.preprocess(
  emptyToUndefined,
  z.coerce.number().optional(),
);

/** 可选字符串：空 → undefined */
const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

/* ══════════════════ 功法表 skills.csv ══════════════════ */

export const skillRowSchema = z.object({
  /** 功法唯一 id（单位表通过它引用） */
  id: z.string().min(1, 'id 不能为空'),
  /** 显示名 */
  name: z.string().min(1, 'name 不能为空'),
  /** 品质：决定基础威力（凡10/良20/上35/极55/绝80） */
  quality: z.enum(QUALITIES),
  /** 功法境界 id：决定境界倍率（见 data/gongfa-power.ts） */
  realm: z.string().min(1),
  /** 招式倍率（乘在功法威力上） */
  multiplier: z.coerce.number().positive('倍率必须大于 0'),
  /** 打击范围 */
  targets: z.enum(TARGET_SHAPES),
  /** 附带状态 id（可选） */
  statusId: z.preprocess(emptyToUndefined, z.enum(STATUS_IDS).optional()),
  /** 状态触发概率 0~1 */
  statusChance: optionalNumber,
  /** 状态持续回合 */
  statusRounds: optionalNumber,
});

export type SkillRow = z.infer<typeof skillRowSchema>;

/* ══════════════════ 单位表 units.csv ══════════════════ */

export const unitRowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** 阵营 */
  side: z.enum(['ally', 'enemy']),
  /** 九宫格站位 0~8 */
  slot: z.coerce.number().int('站位必须是整数').min(0, '站位最小 0').max(8, '站位最大 8'),
  /** 武器组：决定战斗时播哪一组动作 */
  group: z.enum(MOTION_GROUPS as unknown as [string, ...string[]]),
  /** 气血上限 */
  hpMax: z.coerce.number().positive('气血必须大于 0'),
  /** 攻击力（已含臂力 × 3 + 装备攻击） */
  atk: z.coerce.number().nonnegative(),
  /** 防御力（已含根骨 × 1.5 + 装备防御） */
  def: z.coerce.number().nonnegative(),
  /** 出手速度 */
  spd: z.coerce.number().positive('速度必须大于 0'),
  /** 暴击率 0~1（上限 0.75） */
  crit: z.coerce.number().min(0).max(0.75, '暴击率上限为 0.75'),
  /** 闪避率 0~1（上限 0.6） */
  dodge: z.coerce.number().min(0).max(0.6, '闪避率上限为 0.6'),
  /** 命中率 0~1（5%~95%） */
  hit: z.coerce.number().min(0.05, '命中率最低 5%').max(0.95, '命中率最高 95%'),
  /** 吸血率 0~1 */
  lifesteal: z.coerce.number().min(0).max(1),
  /** 内力修为 */
  innerCultivation: z.coerce.number(),
  /** 当前功法类型修为 */
  gongfaCultivation: z.coerce.number(),
  /** 使用的功法 id（必须能在 skills.csv 里找到） */
  skillId: z.string().min(1),
});

export type UnitRow = z.infer<typeof unitRowSchema>;

/* ══════════════════ 跨表一致性检查 ══════════════════ */

export interface TableIssue {
  file: string;
  row: number;
  field: string;
  message: string;
}

/**
 * 跨表校验：单表校验管不住的问题在这里兜底。
 *  ① 单位引用的功法必须存在（防止拼错 id）
 *  ② 同一阵营的站位不能重复（防止两个角色站同一格）
 *  ③ 每方至少要有一个单位（否则战斗无法开始）
 */
export function checkCrossTable(skills: SkillRow[], units: UnitRow[]): TableIssue[] {
  const issues: TableIssue[] = [];
  const skillIds = new Set(skills.map((s) => s.id));

  units.forEach((u, i) => {
    if (!skillIds.has(u.skillId)) {
      issues.push({
        file: 'units.csv',
        row: i + 1,
        field: 'skillId',
        message: `${u.name} 引用了不存在的功法「${u.skillId}」，请检查 skills.csv`,
      });
    }
  });

  for (const side of ['ally', 'enemy'] as const) {
    const ofSide = units.filter((u) => u.side === side);
    if (ofSide.length === 0) {
      issues.push({ file: 'units.csv', row: 0, field: 'side', message: `${side} 阵营没有任何单位` });
    }
    const used = new Map<number, string>();
    for (const u of ofSide) {
      const prev = used.get(u.slot);
      if (prev) {
        issues.push({
          file: 'units.csv',
          row: 0,
          field: 'slot',
          message: `${side} 阵营的站位 ${u.slot} 被「${prev}」和「${u.name}」重复占用`,
        });
      }
      used.set(u.slot, u.name);
    }
  }

  return issues;
}
