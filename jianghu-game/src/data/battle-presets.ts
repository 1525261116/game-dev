/**
 * 默认对战配置。
 *
 * ⚠️ 本文件**不再存放任何数值**。
 *    数值全部来自配置表：data/tables/units.csv 与 skills.csv。
 *    要改阵容或数值，请改 CSV 后运行 `pnpm tables:import`。
 *
 * 保留这个文件的意义：给"默认打一场"提供一个稳定的入口，
 * 以后多关卡就是多个这样的入口（每个关卡一套阵容来源）。
 */
import { buildParty } from './tables.ts';
import type { BattleUnitConfig } from '../core/battle/simulate.ts';

/** 我方阵容（来自 units.csv 中 side=ally 的行） */
export const ALLY_PARTY: BattleUnitConfig[] = buildParty('ally');

/** 敌方阵容（来自 units.csv 中 side=enemy 的行） */
export const ENEMY_PARTY: BattleUnitConfig[] = buildParty('enemy');

/** 默认对战（供 BattleScene 与批量模拟器共用） */
export const DEFAULT_BATTLE = {
  allies: ALLY_PARTY,
  enemies: ENEMY_PARTY,
} as const;
