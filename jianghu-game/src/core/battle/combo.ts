/**
 * 连招（起势 / 收势）—— 纯逻辑，禁止依赖 Phaser
 *
 * 口径：jianghu-design/05_combat/连招系统.md + GDD 02 §2.1.1「列连击」+ GDD 03 §3.1.7 附
 *
 * ══════════════════════════════════════════════════════════════════
 * 规则（一份数据，两处引用）：
 *   套路一收势 = 套路二起势  → 连招成功，**套路二威力 +30%**
 *   套路二收势 = 套路三起势  → 三连成功，**套路三威力 +60%，触发吸血 +10%**
 *   不匹配                   → 不增不减，正常释放（**无惩罚**）
 *   辅助型（起收势 1/1）     → 自身不吃加成，且**中断本列连招链**
 *   定身                     → **不参与同列连击**（由调用方跳过，见 simulate.ts）
 *
 * 链挂在「哪一路」上？
 *   **每方 × 每列（left / center / right）一条链** —— 依据 GDD 02：「同一列
 *   （同一位、跨前中后）的三人若套路起势/收势匹配，可跨位触发列连击」。
 *   这个模型同时满足两种玩法：同列三人接力（列连击）、以及同一单位连续出手
 *   （它自己就在这条列上）。
 * ══════════════════════════════════════════════════════════════════
 */
import { colOf } from './types.ts';
import type { ColName, SlotIndex } from './types.ts';

/* ══════════════════════ 数值 ══════════════════════ */

/** 连招段位加成（GDD 03 §3.1.7 附：第 2 段 +30%、第 3 段 +60%） */
export const COMBO_BONUS = { stage2: 0.3, stage3: 0.6 } as const;

/** 三连额外吸血（GDD 03：触发吸血（+10%）） */
export const TRIPLE_LIFESTEAL_BONUS = 0.1;

/** 连招编号取值范围 1~3 */
export const STANCE_RANGE = { min: 1, max: 3 } as const;

/** 辅助型的起收势（不参与连招链） */
export const SUPPORT_STANCE = 1;

/* ══════════════════════ 类型 ══════════════════════ */

/** 只依赖起收势两个字段，便于测试与复用 */
export interface StanceLike {
  stanceStart?: number;
  stanceEnd?: number;
}

export interface ComboChain {
  /** 现在"期待"的起势编号；null = 链是空的（下一次出手必为第 1 段） */
  expectedStart: number | null;
  /** 当前链长：0 = 空 / 1 = 已出第 1 段 / 2 = 已出第 2 段 */
  length: 0 | 1 | 2;
}

export interface ComboOutcome {
  /** 本次出手属于链的第几段 */
  stage: 1 | 2 | 3;
  /** 本次出手的增伤（0 / 0.3 / 0.6），落在"增伤修正"阶段 */
  bonusDamage: number;
  /** 三连时额外获得的吸血率 */
  lifestealBonus: number;
  /**
   * 本次出手是否**打断**了所在列的链（辅助型 / 普攻）。
   * 注意"接不上"（起势收势不匹配）不算打断 —— 设计明确"不增不减，无惩罚"，
   * 本次按第 1 段正常释放并从自己重新起势。
   */
  interrupted: boolean;
}

/* ══════════════════════ 工具 ══════════════════════ */

/** 起收势钳制到 1~3；缺省视为 1（= 不参与连招） */
export function normalizeStance(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v)) return SUPPORT_STANCE;
  return Math.min(STANCE_RANGE.max, Math.max(STANCE_RANGE.min, Math.round(v)));
}

/** 辅助型：起势 1 且收势 1（§7.6「辅助型起势/收势均为 1/1」） */
export function isSupportSkill(skill: StanceLike): boolean {
  return normalizeStance(skill.stanceStart) === SUPPORT_STANCE
    && normalizeStance(skill.stanceEnd) === SUPPORT_STANCE;
}

/** 链挂在「方 × 列」上 */
export function chainKey(side: 'ally' | 'enemy', slot: SlotIndex): string {
  return `${side}:${colOf(slot)}`;
}

/** 某方三条链的初始状态（按列建桶） */
export function emptyChains(): Record<ColName, ComboChain> {
  return {
    left: emptyChain(),
    center: emptyChain(),
    right: emptyChain(),
  };
}

export function emptyChain(): ComboChain {
  return { expectedStart: null, length: 0 };
}

/* ══════════════════════ 推进 ══════════════════════ */

/**
 * 推进一步连招链（**纯函数**：不改入参，返回新链与新结果）。
 *
 * 传 `null` 表示本次是普攻（或其它没有套路收势的出手）→ 视为打断。
 */
export function advanceCombo(
  chain: ComboChain,
  skill: StanceLike | null,
): { chain: ComboChain; outcome: ComboOutcome } {
  const neutral: ComboOutcome = {
    stage: 1,
    bonusDamage: 0,
    lifestealBonus: 0,
    interrupted: false,
  };

  // 普攻 / 辅助型：无收势可接，链中断（不惩罚，只是重新起势）
  if (skill === null || isSupportSkill(skill)) {
    return { chain: emptyChain(), outcome: { ...neutral, interrupted: true } };
  }

  const start = normalizeStance(skill.stanceStart);
  const end = normalizeStance(skill.stanceEnd);

  // 第 1 段：链是空的，起势不校验，出手后留下自己的收势
  if (chain.length === 0) {
    return { chain: { expectedStart: end, length: 1 }, outcome: neutral };
  }

  // 续链：本次起势接上链期待的收势
  if (start === chain.expectedStart) {
    if (chain.length >= 2) {
      // 三连达成 → 给 +60% 与吸血，然后**重新起势**（下一门从头开始）
      return {
        chain: emptyChain(),
        outcome: {
          stage: 3,
          bonusDamage: COMBO_BONUS.stage3,
          lifestealBonus: TRIPLE_LIFESTEAL_BONUS,
          interrupted: false,
        },
      };
    }
    return {
      chain: { expectedStart: end, length: 2 },
      outcome: { stage: 2, bonusDamage: COMBO_BONUS.stage2, lifestealBonus: 0, interrupted: false },
    };
  }

  // 接不上：不惩罚，本次按第 1 段正常释放，并从自己重新起势
  return { chain: { expectedStart: end, length: 1 }, outcome: neutral };
}
