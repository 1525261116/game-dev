/**
 * 默认对战配置。
 *
 * ⚠️ 本文件**不存放任何数值**，全部来自配置表：
 *    · 阵容与面板数值 → data/tables/units.csv
 *    · 功法与倍率      → data/tables/skills.csv
 *    · 阵法与等级      → data/tables/battle.csv
 *
 * 要改这些，编辑 CSV 后运行 `pnpm tables:import`。
 * 保留本文件的意义：给"默认打一场"提供一个稳定入口；
 * 以后多关卡就是多个这样的入口（每关一套阵容 + 阵法来源）。
 */
import { buildParty, getFormationChoice } from './tables.ts';
import type { BattleUnitConfig } from '../core/battle/simulate.ts';

/** 我方阵容（units.csv 中 side=ally 的行） */
export const ALLY_PARTY: BattleUnitConfig[] = buildParty('ally');

/** 敌方阵容（units.csv 中 side=enemy 的行） */
export const ENEMY_PARTY: BattleUnitConfig[] = buildParty('enemy');

/** 我方阵法（battle.csv 中 side=ally 的行；留空则无阵法） */
export const ALLY_FORMATION = getFormationChoice('ally');

/** 敌方阵法 */
export const ENEMY_FORMATION = getFormationChoice('enemy');

/** 默认对战（供 BattleScene 与批量模拟器共用） */
export const DEFAULT_BATTLE = {
  allies: ALLY_PARTY,
  enemies: ENEMY_PARTY,
  ...(ALLY_FORMATION ? { allyFormation: ALLY_FORMATION } : {}),
  ...(ENEMY_FORMATION ? { enemyFormation: ENEMY_FORMATION } : {}),
};
