/**
 * 战斗伤害公式（纯函数，禁止依赖 Phaser）
 *
 * 数值口径来源：jianghu-design/GDD/03_数值框架.md §3.1.2（定稿）
 *              jianghu-design/08_balance/战斗数值.md §二、§三
 *
 * ┌─ 结算顺序（固定，不可调换）────────────────────────────────┐
 * │ 命中判定 → 暴击判定 → 基础伤害 → 减伤 → 增伤 → 群体递减 → 吸血 │
 * └──────────────────────────────────────────────────────────┘
 *
 * 为什么把这个文件写成"纯函数"？
 *   因为它可以用 GDD 文档里的示例数值**逐行验算**。文档写"≈263"，
 *   这里就必须算出 263，算不出来测试立刻红 —— 数值错了不可能溜过去。
 */

/** 攻方在**本次出手时**的数值（已含装备与状态修正） */
export interface AttackerView {
  /** 攻击力 = 臂力 × 3 + 装备攻击 */
  atk: number;
  /** 暴击率 0~1（上限 0.75） */
  crit: number;
  /** 暴击伤害倍率（基础 1.5，上限 3.0） */
  critDamage: number;
  /** 命中率 0~1（5%~95%） */
  hit: number;
  /** 吸血率 0~1 */
  lifesteal: number;
  /** 内力修为（进入伤害公式的"修为差距"第一项） */
  innerCultivation: number;
  /** 当前攻击功法类型的修为（第二项） */
  gongfaCultivation: number;
  /** 增伤来源之和：连招 + 词条 + 天赋 + 境界（相加，非相乘） */
  bonusDamage: number;
}

/** 守方在**被攻击时**的数值 */
export interface DefenderView {
  /** 防御力 = 根骨 × 1.5 + 装备防御 */
  def: number;
  /** 闪避率 0~1（上限 0.6） */
  dodge: number;
  innerCultivation: number;
  gongfaCultivation: number;
  /** 受到伤害修正：负值 = 减伤（来自"铁壁"等状态），正值 = 易伤 */
  damageTaken: number;
}

/** 本次使用的招式 */
export interface SkillView {
  /** 功法威力（来自 data/gongfa-power.ts，**已含 ×3**） */
  power: number;
  /** 招式倍率（主动招式自带的倍率，例如重击 1.5） */
  multiplier: number;
}

export interface DamageInput {
  attacker: AttackerView;
  defender: DefenderView;
  skill: SkillView;
  /**
   * 群体递减系数 a_i（多目标时按序位取）。
   * 单体攻击传 1，或省略。
   */
  groupDecay?: number;
  /**
   * 随机判定值 —— 由调用方用可播种 RNG 生成后传入。
   * 这样做的好处：本函数没有任何随机性，测试可以精确断言"这一刀必暴击"。
   */
  hitRoll: number;
  critRoll: number;
}

/** 伤害明细：出问题时能一眼看出是哪一项算错了 */
export interface DamageDetail {
  /** 攻击力 */
  attackPower: number;
  /** 修为差距（已按"合计为负则 ÷2"处理） */
  cultivationDiff: number;
  /** 功法威力 × 招式倍率 */
  skillPower: number;
  /** 基础伤害 = 攻击力 + 修为差距 + 功法威力 */
  base: number;
  /** 减伤后的值 */
  afterReduction: number;
  /** 减伤系数 */
  reduction: number;
  /** 暴击倍率（未暴击为 1） */
  critMul: number;
  /** 增伤系数 */
  bonusMul: number;
  /** 群体递减系数 */
  decay: number;
  /** 最终伤害 */
  final: number;
}

export interface DamageResult {
  /** 是否命中（未命中则伤害为 0） */
  hit: boolean;
  /** 是否暴击 */
  crit: boolean;
  /** 最终伤害（整数，至少 1 点） */
  damage: number;
  /** 吸回的气血（未命中或吸血率为 0 时为 0） */
  lifesteal: number;
  detail: DamageDetail;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/* ══════════════════════ 各因子 ══════════════════════ */

/**
 * 命中率 = 自身命中 − 目标闪避，钳制在 [5%, 95%]
 * 依据：GDD 03 §3.1.1「身法 → 命中 / 闪避」注明命中区间 5%~95%、闪避上限 60%
 */
export function hitChance(attackerHit: number, defenderDodge: number): number {
  return clamp(attackerHit - defenderDodge, 0.05, 0.95);
}

/**
 * 减伤修正 = 1 − 防御力 ÷（防御力 + 150）
 * 参考曲线：防御 0→0% ／ 50→25% ／ 100→40% ／ 150→50% ／ 300→66.7% ／ 600→80%
 */
export function damageReduction(def: number): number {
  const d = Math.max(0, def);
  return 1 - d / (d + 150);
}

/**
 * 群体递减系数 a_i = max(0.40, 1 − 0.15 × (i − 1))
 * 序位 i 从 1 开始；只作用于伤害，治疗/增益/阵法不递减。
 */
export function groupDecay(i: number): number {
  return Math.max(0.4, 1 - 0.15 * (Math.max(1, i) - 1));
}

/**
 * 修为差距 = 内力修为差距 + 功法类型修为差距
 * **合计为负时 ÷ 2**（弱者不会被打得过分惨，防止滚雪球）
 */
export function cultivationDiff(a: AttackerView, d: DefenderView): number {
  const total = a.innerCultivation - d.innerCultivation + (a.gongfaCultivation - d.gongfaCultivation);
  return total < 0 ? total / 2 : total;
}

/* ══════════════════════ 主结算 ══════════════════════ */

export function computeDamage(input: DamageInput): DamageResult {
  const { attacker: a, defender: d, skill } = input;
  const decay = input.groupDecay ?? 1;

  const attackPower = a.atk;
  const skillPower = skill.power * skill.multiplier;
  const diff = cultivationDiff(a, d);
  const base = attackPower + diff + skillPower;
  const reduction = damageReduction(d.def);

  /** 未命中：本次攻击落空，结算结束 */
  if (input.hitRoll >= hitChance(a.hit, d.dodge)) {
    return {
      hit: false,
      crit: false,
      damage: 0,
      lifesteal: 0,
      detail: {
        attackPower,
        cultivationDiff: diff,
        skillPower,
        base,
        afterReduction: 0,
        reduction,
        critMul: 1,
        bonusMul: 1,
        decay,
        final: 0,
      },
    };
  }

  const crit = input.critRoll < a.crit;
  const critMul = crit ? a.critDamage : 1;
  // 增伤 = 1 + 攻方增伤之和 + 守方受伤修正（受伤修正为负即减伤）
  const bonusMul = Math.max(0, 1 + a.bonusDamage + d.damageTaken);

  const afterReduction = base * reduction;
  const raw = afterReduction * critMul * bonusMul * decay;
  const final = Math.max(1, Math.round(raw)); // 命中至少造成 1 点，避免"打了等于没打"

  const lifesteal = a.lifesteal > 0 ? Math.round(final * a.lifesteal) : 0;

  return {
    hit: true,
    crit,
    damage: final,
    lifesteal,
    detail: {
      attackPower,
      cultivationDiff: diff,
      skillPower,
      base,
      afterReduction,
      reduction,
      critMul,
      bonusMul,
      decay,
      final,
    },
  };
}
