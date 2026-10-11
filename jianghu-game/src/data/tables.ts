/**
 * 运行时配置表访问层。
 *
 * 这一层是「表格」与「游戏逻辑」之间的唯一桥梁：
 *   data/tables/*.csv  →（tools/import-tables.ts）→  generated/tables.ts
 *                                                        ↓
 *                                                    本文件
 *                                                        ↓
 *                                        core/battle/simulate.ts（战斗）
 *
 * 关键设计：**数值一律在这里从表格翻译成战斗配置**，
 * 战斗代码里不出现任何具体数字，真正实现"改表格就能改游戏"。
 */
import {
  battleSetupRowSchema,
  checkCrossTable,
  skillRowSchema,
  unitRowSchema,
} from '../core/config/schema.ts';
import { BATTLE_SETUP_ROWS, SKILL_ROWS, UNIT_ROWS } from './generated/tables.ts';
import { FORMATIONS } from './formations.ts';
import { gongfaPower } from './gongfa-power.ts';
import type { BattleSetupRow, SkillRow, TableIssue, UnitRow } from '../core/config/schema.ts';
import type {
  BattleUnitConfig,
  FormationChoice,
  SkillConfig,
  UnitStats,
} from '../core/battle/simulate.ts';
import type { MotionGroup } from '../core/anim/types.ts';
import type { SlotIndex } from '../core/battle/types.ts';
import type { Quality, TargetShape } from './gongfa_visual.ts';

/** 功法表：按 id 索引 */
export const SKILLS_BY_ID: Record<string, SkillRow> = Object.fromEntries(
  SKILL_ROWS.map((s) => [s.id, s]),
);

/** 单位表原样导出（只读） */
export const UNITS: readonly UnitRow[] = UNIT_ROWS;

/* ══════════════════ 启动自检 ══════════════════ */

/**
 * 运行时自检：确认生成物没有被手工改坏。
 *
 * 为什么生成物还要再查一遍？
 *   生成文件就在 src/ 里，谁都能顺手改一行。查一遍的成本是毫秒级，
 *   而放过去的代价是"战斗数值莫名其妙"——这种问题最难排查。
 */
export function validateTablesAtRuntime(): { ok: boolean; issues: TableIssue[] } {
  const issues: TableIssue[] = [];

  SKILL_ROWS.forEach((r, i) => {
    const res = skillRowSchema.safeParse(r);
    if (!res.success) {
      for (const e of res.error.issues) {
        issues.push({ file: 'generated/skills', row: i + 1, field: e.path.join('.'), message: e.message });
      }
    }
  });

  UNIT_ROWS.forEach((r, i) => {
    const res = unitRowSchema.safeParse(r);
    if (!res.success) {
      for (const e of res.error.issues) {
        issues.push({ file: 'generated/units', row: i + 1, field: e.path.join('.'), message: e.message });
      }
    }
  });

  BATTLE_SETUP_ROWS.forEach((r, i) => {
    const res = battleSetupRowSchema.safeParse(r);
    if (!res.success) {
      for (const e of res.error.issues) {
        issues.push({
          file: 'generated/battle',
          row: i + 1,
          field: e.path.join('.'),
          message: e.message,
        });
      }
    }
  });

  if (issues.length === 0) {
    issues.push(
      ...checkCrossTable(
        SKILL_ROWS,
        UNIT_ROWS,
        BATTLE_SETUP_ROWS,
        FORMATIONS.map((f) => f.id),
      ),
    );
  }

  return { ok: issues.length === 0, issues };
}

/* ══════════════════ 表格行 → 战斗配置 ══════════════════ */

/**
 * 功法行 → 战斗用招式配置。
 * 注意「功法威力」不是表里写死的，而是由 **品质 × 境界倍率 × 3** 算出来的
 * （见 data/gongfa-power.ts），这样调平衡时只需改品质或境界，无需逐个改威力。
 */
export function toSkillConfig(row: SkillRow): SkillConfig {
  const cfg: SkillConfig = {
    id: row.id,
    name: row.name,
    power: gongfaPower(row.quality as Quality, row.realm),
    multiplier: row.multiplier,
    targets: row.targets as TargetShape,
  };
  if (row.statusId && row.statusChance !== undefined && row.statusRounds !== undefined) {
    cfg.status = { id: row.statusId, chance: row.statusChance, rounds: row.statusRounds };
  }
  return cfg;
}

/** 单位行 → 战斗用单位配置 */
export function toUnitConfig(row: UnitRow): BattleUnitConfig {
  const skill = SKILLS_BY_ID[row.skillId];
  if (!skill) {
    throw new Error(
      `单位「${row.name}」引用了不存在的功法「${row.skillId}」——请检查 data/tables/units.csv 与 skills.csv`,
    );
  }

  const stats: UnitStats = {
    hpMax: row.hpMax,
    atk: row.atk,
    def: row.def,
    spd: row.spd,
    crit: row.crit,
    dodge: row.dodge,
    hit: row.hit,
    lifesteal: row.lifesteal,
    innerCultivation: row.innerCultivation,
    gongfaCultivation: row.gongfaCultivation,
  };

  return {
    id: row.id,
    name: row.name,
    side: row.side,
    slot: row.slot as SlotIndex,
    group: row.group as MotionGroup,
    stats,
    skill: toSkillConfig(skill),
  };
}

/** 取某一方的全部单位（按站位排序，保证顺序稳定） */
export function buildParty(side: 'ally' | 'enemy'): BattleUnitConfig[] {
  return UNIT_ROWS.filter((u) => u.side === side)
    .sort((a, b) => a.slot - b.slot)
    .map(toUnitConfig);
}

/** 把一套阵容转成可读文本（调试与战报显示用） */
export function describeUnit(row: UnitRow): string {
  const skill = SKILLS_BY_ID[row.skillId];
  return `${row.name}（气血 ${row.hpMax}／攻 ${row.atk}／防 ${row.def}／速 ${row.spd}）招式：${skill?.name ?? row.skillId}`;
}

/**
 * 取某一方配置的阵法。
 * battle.csv 里留空则返回 undefined，表示本场不使用阵法（不加任何加成）。
 */
export function getFormationChoice(side: 'ally' | 'enemy'): FormationChoice | undefined {
  const row: BattleSetupRow | undefined = BATTLE_SETUP_ROWS.find((b) => b.side === side);
  if (!row?.formationId || row.formationLevel === undefined) return undefined;
  return { id: row.formationId, level: row.formationLevel };
}

/** 阵法配置原样导出（UI 显示阵法名用） */
export const BATTLE_SETUPS: readonly BattleSetupRow[] = BATTLE_SETUP_ROWS;
