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
import { RANDOM_COUNT_RANGE, RANGE_IDS } from '../battle/range.ts';
import type { RangeId } from '../battle/range.ts';

/* ══════════════════ 枚举取值（与代码保持一致） ══════════════════ */

export const QUALITIES = ['fan', 'liang', 'shang', 'ji', 'jue'] as const;

/**
 * 表现层的 4 型特效形状（≠ 战斗层的 10 型范围）。
 * 10 型落在战斗数据层（skills.csv 的 range 列），由 core/battle/range.ts 换算。
 */
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
  /** 品质：决定基础威力（凡10/良20/上35/极55/绝80）与内力消耗 */
  quality: z.enum(QUALITIES),
  /** 功法境界 id：决定境界倍率（见 data/gongfa-power.ts） */
  realm: z.string().min(1),
  /** 招式倍率（乘在功法威力上） */
  multiplier: z.coerce.number().positive('倍率必须大于 0'),
  /** 攻击范围：10 型之一（口径见 05_combat/功法系统.md §6.5） */
  range: z.enum(RANGE_IDS as unknown as [RangeId, ...RangeId[]]),
  /** 仅随机 N 型使用：N ∈ {2,3,4}，留空 = 3 */
  randomCount: optionalNumber,
  /** 连招起势 1~3；留空 = 1（不参与连招链） */
  stanceStart: optionalNumber,
  /** 连招收势 1~3；留空 = 1（不参与连招链） */
  stanceEnd: optionalNumber,
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
  /**
   * 内息：决定内力上限（内息 × 10）与每回合回复（内息 ÷ 10）。
   * 见 GDD 02 §2.1.1-4「内力系统」。
   */
  breath: z.coerce.number().nonnegative(),
  /** 使用的功法 id（必须能在 skills.csv 里找到） */
  skillId: z.string().min(1),
  /** 第 2 门装备套路（可选；连招链的主力） */
  skillIdB: optionalString,
  /** 第 3 门装备套路（可选） */
  skillIdC: optionalString,
});

export type UnitRow = z.infer<typeof unitRowSchema>;

/* ══════════════════ 对战配置 battle.csv ══════════════════ */

export const battleSetupRowSchema = z.object({
  /** 阵营 */
  side: z.enum(['ally', 'enemy']),
  /** 阵法 id（留空 = 本场不使用阵法） */
  formationId: optionalString,
  /** 阵法等级 1~5 */
  formationLevel: optionalNumber,
});

export type BattleSetupRow = z.infer<typeof battleSetupRowSchema>;

/* ══════════════════ 跨表一致性检查 ══════════════════ */

export interface TableIssue {
  file: string;
  row: number;
  field: string;
  message: string;
}

/* ══════════════════ 范围 × 伤害原型：禁配红线 ══════════════════ */

/**
 * 伤害原型档位（由招式倍率推断）与它**允许**的攻击范围。
 *
 * 口径：05_combat/功法系统.md §6.5.4「范围 × 伤害原型：正交 + 合法组合矩阵」
 * 红线：① 单体爆发/常规/连击型**禁止**配排/列/十字/全体
 *       ② 范围大招**禁止**配单体
 * 这条校验是 GDD 3.10.4 明确要求「必须实现」的自动化脚本之一。
 */
export const SINGLE_ONLY_RANGES: readonly RangeId[] = ['single_any', 'single_front', 'single_back'];
export const AOE_ONLY_RANGES: readonly RangeId[] = ['all', 'row_front', 'row_mid', 'row_back', 'cross', 'random_n'];

export const DAMAGE_ARCHETYPES = [
  { id: 'single_burst', name: '单体爆发', multiplier: 1.5, allowed: SINGLE_ONLY_RANGES },
  { id: 'single_normal', name: '单体常规', multiplier: 1.2, allowed: SINGLE_ONLY_RANGES },
  { id: 'combo_hit', name: '连击型', multiplier: 0.8, allowed: SINGLE_ONLY_RANGES },
  { id: 'aoe_normal', name: '范围常规/控制+伤害', multiplier: 1.0, allowed: null },
  { id: 'aoe_ultimate', name: '范围大招', multiplier: 0.7, allowed: AOE_ONLY_RANGES },
] as const;

/**
 * 由倍率推断允许的范围；返回 null 表示**不限**（倍率 1.0 同时覆盖
 * 「范围常规」与「控制+伤害」，两者都允许任意范围）。
 *
 * 用相对容差比较，避免 CSV 里的 1.2 读成 1.2000000000000002 时误判。
 */
export function allowedRangesFor(multiplier: number): readonly RangeId[] | null {
  const hit = DAMAGE_ARCHETYPES.find((a) => Math.abs(a.multiplier - multiplier) < 1e-9);
  return hit ? hit.allowed : null;
}

/** 逐行检查「伤害原型 × 范围」是否踩红线（GDD 3.10.4） */
export function checkRangeMultiplierMatrix(skills: readonly SkillRow[]): TableIssue[] {
  const issues: TableIssue[] = [];
  skills.forEach((s, i) => {
    const allowed = allowedRangesFor(s.multiplier);
    if (!allowed || allowed.includes(s.range)) return;
    const archetype = DAMAGE_ARCHETYPES.find((a) => Math.abs(a.multiplier - s.multiplier) < 1e-9);
    issues.push({
      file: 'skills.csv',
      row: i + 1,
      field: 'range',
      message:
        `「${s.name}」倍率 ${s.multiplier}（${archetype?.name ?? '未识别原型'}）` +
        `不允许搭配范围「${s.range}」，只允许 ${allowed.join(' / ')}`,
    });
  });
  return issues;
}

/**
 * 跨表校验：单表校验管不住的问题在这里兜底。
 *  ① 单位引用的功法必须存在（防止拼错 id）—— 三个装备位都要查
 *  ② 同一阵营的站位不能重复（防止两个角色站同一格）
 *  ③ 每方至少要有一个单位（否则战斗无法开始）
 *  ④ 功法「伤害原型 × 范围」不得踩禁配红线（GDD 3.10.4）
 *  ⑤ 随机 N 的 N 必须在 {2,3,4}；连招起收势必须在 1~3
 */
export function checkCrossTable(
  skills: SkillRow[],
  units: UnitRow[],
  battleSetups: BattleSetupRow[] = [],
  knownFormationIds: readonly string[] = [],
): TableIssue[] {
  const issues: TableIssue[] = [];
  const skillIds = new Set(skills.map((s) => s.id));

  issues.push(...checkRangeMultiplierMatrix(skills));

  /* 功法表内部一致性：随机 N 的 N、连招编号取值范围 */
  skills.forEach((s, i) => {
    const fieldRow = { file: 'skills.csv', row: i + 1 } as const;
    if (s.range === 'random_n') {
      // 留空允许（按默认 N=3 处理）；填了就必须落在区间内
      if (s.randomCount !== undefined
        && (s.randomCount < RANDOM_COUNT_RANGE.min || s.randomCount > RANDOM_COUNT_RANGE.max)) {
        issues.push({
          ...fieldRow,
          field: 'randomCount',
          message: `「${s.name}」随机 N 的 N=${s.randomCount} 越界，允许范围 ${RANDOM_COUNT_RANGE.min}~${RANDOM_COUNT_RANGE.max}`,
        });
      }
    } else if (s.randomCount !== undefined) {
      issues.push({
        ...fieldRow,
        field: 'randomCount',
        message: `「${s.name}」范围是 ${s.range}，不是随机 N，randomCount 必须留空`,
      });
    }
    for (const field of ['stanceStart', 'stanceEnd'] as const) {
      const v = s[field];
      if (v !== undefined && (v < 1 || v > 3)) {
        issues.push({
          ...fieldRow,
          field,
          message: `「${s.name}」${field}=${v} 越界，连招编号只能是 1~3`,
        });
      }
    }
  });

  units.forEach((u, i) => {
    for (const field of ['skillId', 'skillIdB', 'skillIdC'] as const) {
      const ref = u[field];
      if (ref && !skillIds.has(ref)) {
        issues.push({
          file: 'units.csv',
          row: i + 1,
          field,
          message: `${u.name} 引用了不存在的功法「${ref}」，请检查 skills.csv`,
        });
      }
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

  /* 阵法配置校验：id 必须存在、等级必须在 1~5、每方最多一条 */
  const formationSet = new Set(knownFormationIds);
  const seenSide = new Set<string>();
  battleSetups.forEach((b, i) => {
    if (seenSide.has(b.side)) {
      issues.push({
        file: 'battle.csv',
        row: i + 1,
        field: 'side',
        message: `${b.side} 阵营出现了多条配置，每方只允许一条`,
      });
    }
    seenSide.add(b.side);

    if (b.formationId && formationSet.size > 0 && !formationSet.has(b.formationId)) {
      issues.push({
        file: 'battle.csv',
        row: i + 1,
        field: 'formationId',
        message: `不存在的阵法「${b.formationId}」，请在 data/formations.ts 中核对 id`,
      });
    }
    if (b.formationId && b.formationLevel === undefined) {
      issues.push({
        file: 'battle.csv',
        row: i + 1,
        field: 'formationLevel',
        message: `已指定阵法 ${b.formationId}，但没有填阵法等级（1~5）`,
      });
    }
    if (b.formationLevel !== undefined && (b.formationLevel < 1 || b.formationLevel > 5)) {
      issues.push({
        file: 'battle.csv',
        row: i + 1,
        field: 'formationLevel',
        message: `阵法等级 ${b.formationLevel} 越界，允许范围 1~5`,
      });
    }
  });

  return issues;
}
