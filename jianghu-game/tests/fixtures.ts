/**
 * 测试夹具（不是测试文件本身：文件名不以 .test.ts 结尾，所以不会被 node --test 收集）
 *
 * 为什么需要它？
 *   新功能（10 型范围 / 连招 / 内力）需要**精确可控**的输入才能断言：
 *   "换一个范围只改变打谁，不改变别的"、"同一发伤害在链内必须是链外的 1.3 倍"。
 *   用配置表里的真实阵容做不到这种隔离 —— 面板不同、防御不同、站位不同。
 *   所以这里提供"数值可完全指定"的最小单位。
 */
import type { BattleUnitConfig, SkillConfig, UnitStats } from '../src/core/battle/simulate.ts';
import type { MotionGroup } from '../src/core/anim/types.ts';
import type { RangeId } from '../src/core/battle/range.ts';
import type { SlotIndex } from '../src/core/battle/types.ts';

/** 默认面板：命中 1 / 闪避 0 / 暴击 0，让结果只剩"我们想测的那一个变量" */
export function makeStats(over: Partial<UnitStats> = {}): UnitStats {
  return {
    hpMax: 10_000,
    atk: 300,
    def: 0,
    spd: 50,
    crit: 0,
    dodge: 0,
    hit: 1,
    lifesteal: 0,
    innerCultivation: 0,
    gongfaCultivation: 0,
    innerMax: 10_000,
    innerRegen: 0,
    ...over,
  };
}

export function makeSkill(over: Partial<SkillConfig> = {}): SkillConfig {
  return {
    id: 'S_test',
    name: '测试招式',
    quality: 'fan',
    power: 100,
    multiplier: 1,
    range: 'single_any',
    stanceStart: 1,
    stanceEnd: 1,
    innerCost: 10,
    ...over,
  };
}

export interface MakeUnitInput extends Partial<Omit<BattleUnitConfig, 'id' | 'slot'>> {
  id: string;
  slot: SlotIndex;
}

export function makeUnit(input: MakeUnitInput): BattleUnitConfig {
  const { id, slot, ...rest } = input;
  return {
    id,
    name: id,
    side: 'ally',
    group: 'dao' as MotionGroup,
    charId: 'base_male',
    stats: makeStats(),
    skills: [makeSkill()],
    ...rest,
    slot,
  };
}

/** 只改范围的便捷构造 */
export function skillOfRange(range: RangeId, over: Partial<SkillConfig> = {}): SkillConfig {
  return makeSkill({ range, ...over });
}

/** 三方全同的敌人（用于精确验证群体递减：唯一变量只剩"序位"） */
export function mirrorEnemies(slots: readonly SlotIndex[] = [0, 1, 2]): BattleUnitConfig[] {
  return slots.map((slot, i) =>
    makeUnit({ id: `foe_${i}`, slot, side: 'enemy', stats: makeStats({ atk: 1, hpMax: 1_000_000 }) }),
  );
}
