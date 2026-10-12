/**
 * 战斗预结算（纯逻辑，禁止依赖 Phaser）
 *
 * ══════════════════════════════════════════════════════════════════
 * 这是本项目最重要的一条架构铁律的落地点：
 *
 *   「战斗**先算完**，表现层照着日志回放」
 *
 * 本函数把一整场战斗算完，产出一份 **BattleLog（战斗日志）**，
 * 里面逐条记录了"谁、在第几回合、用什么招式、打了谁、命中没、伤害多少、死没死"。
 * 表现层（BattleScene）只负责把这份日志"演出来"，不参与任何数值计算。
 *
 * 这样做换来三个能力：
 *   ① 同一种子 → 必然同一结果（可复现 bug）
 *   ② 回放可以 1× / 2× / 4× / 直接跳过，结果都不变
 *   ③ 可以脱离画面跑 1000 场做数值平衡模拟（这正是 GDD M1 的验收标准）
 * ══════════════════════════════════════════════════════════════════
 *
 * 系统接入（都在 core 层，各自独立）：
 *   · 阵法（formation.ts）      —— 站位满足条件 → 全队加成，**可选参数**，不传即零加成
 *   · 范围与选目标（range.ts / targeting.ts）—— 10 型范围 + 战斗倾向决定"打谁"
 *   · 连招（combo.ts）          —— 每方每条列一条链，起势收势匹配 → +30% / +60% + 吸血
 *   · 内力（gongfa-power.ts）   —— 每次释放按品质扣内力，不够就自动普攻
 */

import { computeDamage, groupDecay } from './formula.ts';
import { resolveFormation, describeBonus } from './formation.ts';
import { createRng } from './rng.ts';
import { selectTargets } from './targeting.ts';
import { advanceCombo, emptyChains, normalizeStance } from './combo.ts';
import { colOf, partyScale, rowOf, COL_SLOTS, ROW_SLOTS } from './types.ts';
import { STATUS_DEFS } from '../../data/status.ts';
import { getFormation } from '../../data/formations.ts';
import { BASIC_ATTACK_ATK_MUL } from '../../data/gongfa-power.ts';
import type { Rng } from './rng.ts';
import type { AttackerView, DefenderView, SkillView } from './formula.ts';
import type { MotionGroup } from '../anim/types.ts';
import type { CombatIntent, TargetableUnit } from './targeting.ts';
import type { ComboChain, ComboOutcome } from './combo.ts';
import type { RangeId } from './range.ts';
import type { Quality } from '../../data/gongfa_visual.ts';
import type {
  ColName,
  FormationBonus,
  Placement,
  RequirementResult,
  SlotIndex,
  StatMods,
  StatusId,
} from './types.ts';

/* ══════════════════════ 输入配置 ══════════════════════ */

/** 参战单位的面板数值（全部来自配置表，代码里不写死） */
export interface UnitStats {
  hpMax: number;
  /** 攻击力（已含臂力×3 + 装备） */
  atk: number;
  /** 防御力（已含根骨×1.5 + 装备） */
  def: number;
  /** 出手速度（身法 + 轻功加成），决定行动顺序 */
  spd: number;
  /** 暴击率 0~1 */
  crit: number;
  /** 闪避率 0~1 */
  dodge: number;
  /** 命中率 0~1 */
  hit: number;
  /** 吸血率 0~1 */
  lifesteal: number;
  /** 内力修为（进"修为差距"） */
  innerCultivation: number;
  /** 当前功法类型修为 */
  gongfaCultivation: number;
  /** 内力上限（由内息派生，见 data/gongfa-power.ts toInner） */
  innerMax: number;
  /** 每回合内力回复（由内息派生） */
  innerRegen: number;
}

/** 一门装备中的套路（主动招式） */
export interface SkillConfig {
  id: string;
  name: string;
  /** 品质：决定功法威力与内力消耗的底子 */
  quality: Quality;
  /** 功法威力（来自 data/gongfa-power.ts，已含 ×3） */
  power: number;
  /** 招式倍率 */
  multiplier: number;
  /** 攻击范围：10 型之一（见 core/battle/range.ts） */
  range: RangeId;
  /** 仅随机 N 型使用 */
  randomCount?: number;
  /** 连招起势 1~3（1 且收势为 1 = 辅助型，不参与连招链） */
  stanceStart: number;
  /** 连招收势 1~3 */
  stanceEnd: number;
  /** 释放一次的内力消耗（由品质推导） */
  innerCost: number;
  /** 附带状态（可选） */
  status?: { id: StatusId; chance: number; rounds: number };
}

export interface BattleUnitConfig {
  id: string;
  name: string;
  side: 'ally' | 'enemy';
  /** 九宫格站位 0~8 */
  slot: SlotIndex;
  /** 武器组：决定战斗时播哪一组动作 */
  group: MotionGroup;
  stats: UnitStats;
  /** 装备的套路（最多 3 门，顺序即连招顺序；至少 1 门） */
  skills: SkillConfig[];
}

/** 阵法选择：用哪个阵法、练到几级（1~5） */
export interface FormationChoice {
  id: string;
  level: number;
}

export interface BattleSetup {
  allies: BattleUnitConfig[];
  enemies: BattleUnitConfig[];
  /** 随机种子：同种子必然同结果 */
  seed: number | string;
  /** 回合上限，超过判负（GDD 失衡红线：> 30 回合视为数值缺陷） */
  maxRounds?: number;
  /** 我方阵法（可选；不传则无阵法加成） */
  allyFormation?: FormationChoice;
  /** 敌方阵法（可选） */
  enemyFormation?: FormationChoice;
  /** 我方战斗倾向（优先输出 / 优先连招）；缺省 = 优先输出 */
  allyIntent?: CombatIntent;
  /** 敌方战斗倾向；缺省 = 优先输出（设计：敌方 AI 默认点残血） */
  enemyIntent?: CombatIntent;
}

/* ══════════════════════ 输出：战斗日志 ══════════════════════ */

export type BattleEvent =
  /** 战斗开始：记录双方初始状态 */
  | {
      type: 'battleStart';
      units: {
        id: string;
        name: string;
        side: 'ally' | 'enemy';
        slot: SlotIndex;
        group: MotionGroup;
        hpMax: number;
        innerMax: number;
      }[];
    }
  /** 阵法生效情况（开局公布） */
  | {
      type: 'formation';
      side: 'ally' | 'enemy';
      formationId: string;
      formationName: string;
      level: number;
      /** ok = 全额生效 / partial = 加成减半 / fail = 未生效 */
      result: RequirementResult;
      /** 人类可读的加成说明 */
      description: string;
    }
  /** 回合开始 */
  | { type: 'roundStart'; round: number }
  /**
   * 某单位出手。
   * `basic = true` 表示内力不足（或被封穴）改用普攻：无招式、无消耗、不参与连招。
   */
  | {
      type: 'act';
      actorId: string;
      actorName: string;
      skillId: string;
      skillName: string;
      /** 本次使用的范围（普攻为 single_any） */
      range: RangeId;
      targetIds: string[];
      basic: boolean;
      /** 本次消耗的内力（普攻为 0） */
      cost: number;
      /** 出手后的内力余量（UI 内力条直接用这个值） */
      innerAfter: number;
      /** 连招段位：1 = 起手 / 2 = 连招 / 3 = 三连 */
      comboStage: 1 | 2 | 3;
      /** 连招增伤（0 / 0.3 / 0.6） */
      comboBonus: number;
    }
  /** 被控制，跳过回合 */
  | { type: 'skip'; actorId: string; reason: string }
  /** 免疫了一次控制（守境阵） */
  | { type: 'immune'; targetId: string; statusId: StatusId }
  /** 命中并造成伤害 */
  | { type: 'damage'; targetId: string; value: number; crit: boolean; hpAfter: number; lifesteal: number }
  /** 未命中 */
  | { type: 'miss'; targetId: string }
  /** 被施加状态 */
  | { type: 'statusApplied'; targetId: string; statusId: StatusId; rounds: number }
  /** 持续伤害（中毒/流血/灼烧） */
  | { type: 'dot'; targetId: string; statusId: StatusId; value: number; hpAfter: number }
  /** 持续回复（回春：百分比为负的持续效果） */
  | { type: 'heal'; targetId: string; statusId: StatusId; value: number; hpAfter: number }
  /** 受击反弹（天罡北斗阵） */
  | { type: 'reflect'; targetId: string; value: number; hpAfter: number; sourceName: string }
  /** 单位死亡 */
  | { type: 'death'; unitId: string; unitName: string }
  /** 战斗结束 */
  | { type: 'battleEnd'; winner: 'ally' | 'enemy' | 'draw'; rounds: number; allyAlive: number; enemyAlive: number };

export interface BattleLog {
  seed: number | string;
  winner: 'ally' | 'enemy' | 'draw';
  rounds: number;
  events: BattleEvent[];
  /** 结束时各单位的剩余气血 */
  finalHp: Record<string, number>;
  /** 结束时各单位的剩余内力 */
  finalInner: Record<string, number>;
  /** 汇总统计，便于做数值平衡分析 */
  stats: {
    totalDamage: number;
    allyDamage: number;
    enemyDamage: number;
    deaths: number;
    /** 反弹造成的总伤害（用于校验阵法效果真的生效） */
    reflectDamage: number;
    /** 连招第 2 段次数（验收"连招真的触发了"） */
    comboStage2: number;
    /** 三连次数 */
    comboStage3: number;
    /** 因内力不足 / 被封穴而改用普攻的次数 */
    basicAttacks: number;
  };
  /** 本场生效的阵法（无阵法时为 null） */
  formations: {
    ally: { id: string; name: string; level: number; result: RequirementResult } | null;
    enemy: { id: string; name: string; level: number; result: RequirementResult } | null;
  };
  /** 本场使用的战斗倾向 */
  intents: { ally: CombatIntent; enemy: CombatIntent };
}

/* ══════════════════════ 阵法加成摘要 ══════════════════════ */

/** 某一方的阵法生效结果（已摊平成方便使用的形式） */
interface SideBonus {
  id: string;
  name: string;
  level: number;
  result: RequirementResult;
  mods: Partial<StatMods>;
  special: NonNullable<FormationBonus['special']>;
  description: string;
}

/** 某一方的运行时状态 */
interface SideState {
  /** 记录"免疫首次控制"是否已被消耗 */
  immuneUsed: boolean;
  /** 战斗倾向（决定"放哪门功法"与"打谁"） */
  intent: CombatIntent;
  /** 每列一条连招链（列连击：同列三人跨位接力） */
  chains: Record<ColName, ComboChain>;
}

/* ══════════════════════ 运行时状态 ══════════════════════ */

interface StatusInstance {
  id: StatusId;
  remaining: number;
  stacks: number;
  /**
   * 施加于第几回合。
   * 作用：避免"控制类状态在施加的当回合末就被 −1 清掉"这个经典 bug ——
   * 否则 1 回合的眩晕会永远不生效（施加 → 回合末清零 → 对方照样行动）。
   * 规则：只有 currentRound > appliedRound 的状态才在回合末倒计时。
   */
  appliedRound: number;
}

/**
 * 运行时单位。
 * 刻意把 id / side / slot / hp / alive **摊平**：这样它天然满足
 * targeting.TargetableUnit，选目标函数可以泛型直接返回 UnitState，
 * 无需在"视图"与"真实状态"之间来回映射（少一层出错的机会）。
 */
interface UnitState extends TargetableUnit {
  cfg: BattleUnitConfig;
  id: string;
  side: 'ally' | 'enemy';
  slot: SlotIndex;
  hp: number;
  hpMax: number;
  /** 当前内力 */
  inner: number;
  statuses: StatusInstance[];
  alive: boolean;
}

const STATUS_BY_ID = new Map(STATUS_DEFS.map((s) => [s.id, s]));

/** 汇总一个单位身上所有状态带来的属性修正（百分比相加） */
function collectMods(unit: UnitState): StatMods {
  const out: StatMods = {
    atk: 0, def: 0, hpMax: 0, spd: 0, crit: 0, dodge: 0, hit: 0,
    innerRegen: 0, damageTaken: 0, damageDealt: 0, lifesteal: 0,
  };
  for (const st of unit.statuses) {
    const def = STATUS_BY_ID.get(st.id);
    if (!def?.mods) continue;
    for (const [k, v] of Object.entries(def.mods)) {
      out[k as keyof StatMods] += (v as number) * st.stacks;
    }
  }
  return out;
}

/** 是否处于"无法行动"状态（当前实现：眩晕） */
function isIncapacitated(unit: UnitState): string | null {
  for (const st of unit.statuses) {
    const def = STATUS_BY_ID.get(st.id);
    if (def?.kind === 'control' && def.id === 'stun') return def.name;
  }
  return null;
}

/** 封穴：只能普攻（设计 §3.1「无法释放套路（只能普攻），内力回复 −50%」） */
function isSealed(unit: UnitState): boolean {
  return unit.statuses.some((s) => s.id === 'seal');
}

/** 定身：不参与同列连击（设计 §3.1 定身备注） */
function isRooted(unit: UnitState): boolean {
  return unit.statuses.some((s) => s.id === 'root');
}

/**
 * 把「状态修正」与「阵法修正」合并成最终的属性倍率。
 * 两者都是百分比，直接相加（GDD：增伤各来源相加）。
 */
function mergedMods(unit: UnitState, bonus: SideBonus | null): StatMods {
  const m = collectMods(unit);
  const f = bonus?.mods ?? {};
  return {
    atk: m.atk + (f.atk ?? 0),
    def: m.def + (f.def ?? 0),
    hpMax: m.hpMax + (f.hpMax ?? 0),
    spd: m.spd + (f.spd ?? 0),
    crit: m.crit + (f.crit ?? 0),
    dodge: m.dodge + (f.dodge ?? 0),
    hit: m.hit + (f.hit ?? 0),
    innerRegen: m.innerRegen + (f.innerRegen ?? 0),
    damageTaken: m.damageTaken + (f.damageTaken ?? 0),
    damageDealt: m.damageDealt + (f.damageDealt ?? 0),
    lifesteal: m.lifesteal + (f.lifesteal ?? 0),
  };
}

/** 本次出手的额外加成（连招 / 普攻衰减） */
interface AttackOptions {
  /** 连招增伤（相加进增伤项） */
  extraDamage?: number;
  /** 三连额外吸血 */
  extraLifesteal?: number;
  /** 攻击力倍率（普攻 = 0.5） */
  atkMul?: number;
}

/**
 * 把单位转成伤害公式需要的"攻方视图"。
 * 这里同时处理两种**依赖站位**的阵法效果：
 *   · 锋矢阵 columnDamage：与目标同列时增伤
 *   · 雁行阵 backRowDamage：站后排时增伤
 * 以及本轮的两种新加成：连招增伤、普攻攻击力减半。
 */
function toAttacker(
  unit: UnitState,
  bonus: SideBonus | null,
  target: UnitState,
  opts: AttackOptions = {},
): AttackerView {
  const m = mergedMods(unit, bonus);
  const sp = bonus?.special ?? {};

  let bonusDamage = m.damageDealt + (opts.extraDamage ?? 0);
  if (sp.columnDamage && colOf(unit.slot) === colOf(target.slot)) {
    bonusDamage += sp.columnDamage;
  }
  if (sp.backRowDamage && rowOf(unit.slot) === 'back') {
    bonusDamage += sp.backRowDamage;
  }

  return {
    atk: unit.cfg.stats.atk * (1 + m.atk) * (opts.atkMul ?? 1),
    crit: Math.min(0.75, unit.cfg.stats.crit * (1 + m.crit)),
    critDamage: 1.5,
    hit: Math.min(0.95, unit.cfg.stats.hit * (1 + m.hit)),
    lifesteal: unit.cfg.stats.lifesteal + m.lifesteal + (opts.extraLifesteal ?? 0),
    innerCultivation: unit.cfg.stats.innerCultivation,
    gongfaCultivation: unit.cfg.stats.gongfaCultivation,
    bonusDamage,
  };
}

/**
 * 守方视图；两种特殊处理：
 *   · "定身"状态把闪避压到 0（GDD：闪避归零）
 *   · 雁行阵 frontRowTaken：站前排时少受伤害
 */
function toDefender(unit: UnitState, bonus: SideBonus | null): DefenderView {
  const m = mergedMods(unit, bonus);
  const sp = bonus?.special ?? {};
  const rooted = isRooted(unit);

  let damageTaken = m.damageTaken;
  if (sp.frontRowTaken && rowOf(unit.slot) === 'front') {
    damageTaken += sp.frontRowTaken; // 该值为负数，表示少受伤害
  }

  const rawDodge = unit.cfg.stats.dodge * (1 + m.dodge);
  return {
    def: Math.max(0, unit.cfg.stats.def * (1 + m.def)),
    dodge: rooted ? 0 : Math.min(0.6, rawDodge),
    innerCultivation: unit.cfg.stats.innerCultivation,
    gongfaCultivation: unit.cfg.stats.gongfaCultivation,
    damageTaken,
  };
}

/* ══════════════════════ 阵法求解 ══════════════════════ */

/** 由单位配置构造九宫格站位表（Placement = 9 格，每格一个单位 id 或 null） */
function toPlacement(cfgs: BattleUnitConfig[]): Placement {
  const p: (string | null)[] = new Array<string | null>(9).fill(null);
  for (const c of cfgs) p[c.slot] = c.id;
  return p;
}

/**
 * 求出某一方的阵法加成。
 *
 * 三种结果：
 *   ok      → 全额加成
 *   partial → 加成减半（站位接近但不完全符合）
 *   fail    → 完全没有加成
 * 这让玩家有"再挪一格就凑成阵了"的动机，而不是只有成/不成两种体验。
 */
function resolveSideBonus(
  cfgs: BattleUnitConfig[],
  choice: FormationChoice | undefined,
): SideBonus | null {
  if (!choice) return null;
  const def = getFormation(choice.id);
  const res = resolveFormation(def, toPlacement(cfgs), choice.level);

  return {
    id: def.id,
    name: def.name,
    level: res.level,
    result: res.result,
    mods: res.effective.mods ?? {},
    special: res.effective.special ?? {},
    description: describeBonus(res.effective),
  };
}

/* ══════════════════════ 选招（放哪门功法） ══════════════════════ */

/**
 * 由战斗倾向挑一门本次出手的套路。
 *
 *   优先输出：取 威力 × 倍率 最高且内力够用的那一门
 *   优先连招：若本列链还有期待起势，**优先挑能续链的那一门**，否则退化为优先输出
 *
 * 返回 null = 内力不足（或没有套路），调用方改用普攻。
 */
function chooseSkill(
  actor: UnitState,
  chain: ComboChain,
  intent: CombatIntent,
): SkillConfig | null {
  const skills = actor.cfg.skills;
  if (skills.length === 0) return null;
  const affordable = skills.filter((s) => actor.inner >= s.innerCost);
  if (affordable.length === 0) return null;

  if (intent === 'combo' && chain.length > 0 && chain.expectedStart !== null) {
    const continues = affordable.find(
      (s) => normalizeStance(s.stanceStart) === chain.expectedStart,
    );
    if (continues) return continues;
  }

  let best = affordable[0]!;
  for (const s of affordable) {
    if (s.power * s.multiplier > best.power * best.multiplier) best = s;
  }
  return best;
}

/** 没有连招加成时的中性结果 */
const NEUTRAL_OUTCOME: ComboOutcome = {
  stage: 1,
  bonusDamage: 0,
  lifestealBonus: 0,
  interrupted: false,
};

/* ══════════════════════ 主流程 ══════════════════════ */

/**
 * 实例化一个单位。
 * 气血上限在此处应用两类修正：编队系数（敌方随我方人数缩放）+ 阵法 hpMax 加成。
 */
function instantiate(cfg: BattleUnitConfig, hpScale: number, bonus: SideBonus | null): UnitState {
  const hpBonus = bonus?.mods.hpMax ?? 0;
  const hpMax = Math.max(1, Math.round(cfg.stats.hpMax * hpScale * (1 + hpBonus)));
  return {
    id: cfg.id,
    side: cfg.side,
    slot: cfg.slot,
    cfg,
    hp: hpMax,
    hpMax,
    inner: cfg.stats.innerMax,
    statuses: [],
    alive: true,
  };
}

export function simulateBattle(setup: BattleSetup): BattleLog {
  const rng: Rng = createRng(setup.seed);
  const maxRounds = setup.maxRounds ?? 30;
  const events: BattleEvent[] = [];

  // ① 先算两边的阵法（必须在实例化之前，因为阵法会影响气血上限）
  const allyBonus = resolveSideBonus(setup.allies, setup.allyFormation);
  const enemyBonus = resolveSideBonus(setup.enemies, setup.enemyFormation);
  const bonusOf = (side: 'ally' | 'enemy'): SideBonus | null =>
    side === 'ally' ? allyBonus : enemyBonus;

  const intents: Record<'ally' | 'enemy', CombatIntent> = {
    ally: setup.allyIntent ?? 'output',
    enemy: setup.enemyIntent ?? 'output',
  };

  const sideState: Record<'ally' | 'enemy', SideState> = {
    ally: { immuneUsed: false, intent: intents.ally, chains: emptyChains() },
    enemy: { immuneUsed: false, intent: intents.enemy, chains: emptyChains() },
  };

  // ② 实例化双方。敌方气血按我方人数缩放（GDD：以 4 人为基准，保证 TTK 恒定）
  const allyScale = partyScale(setup.allies.length);
  const units: UnitState[] = [
    ...setup.allies.map((c) => instantiate(c, 1, allyBonus)),
    ...setup.enemies.map((c) => instantiate(c, allyScale, enemyBonus)),
  ];

  events.push({
    type: 'battleStart',
    units: units.map((u) => ({
      id: u.cfg.id,
      name: u.cfg.name,
      side: u.cfg.side,
      slot: u.cfg.slot,
      group: u.cfg.group,
      hpMax: u.hpMax,
      innerMax: u.cfg.stats.innerMax,
    })),
  });

  // 阵法在开局公布一次（让玩家/日志能明确看到"阵起作用了没有"）
  for (const side of ['ally', 'enemy'] as const) {
    const b = bonusOf(side);
    if (!b) continue;
    events.push({
      type: 'formation',
      side,
      formationId: b.id,
      formationName: b.name,
      level: b.level,
      result: b.result,
      description: b.description,
    });
  }

  const aliveOf = (side: 'ally' | 'enemy'): UnitState[] =>
    units.filter((u) => u.cfg.side === side && u.alive);

  const stats = {
    totalDamage: 0,
    allyDamage: 0,
    enemyDamage: 0,
    deaths: 0,
    reflectDamage: 0,
    comboStage2: 0,
    comboStage3: 0,
    basicAttacks: 0,
  };

  let round = 0;
  let winner: 'ally' | 'enemy' | 'draw' = 'draw';

  /* ────────────── 回合循环 ────────────── */
  for (round = 1; round <= maxRounds; round++) {
    events.push({ type: 'roundStart', round });

    // 行动顺序：按当前有效速度降序（速度受状态与阵法影响，所以每回合重排）
    const order = units
      .filter((u) => u.alive)
      .sort((a, b) => {
        const sa = a.cfg.stats.spd * (1 + mergedMods(a, bonusOf(a.cfg.side)).spd);
        const sb = b.cfg.stats.spd * (1 + mergedMods(b, bonusOf(b.cfg.side)).spd);
        return sb - sa;
      });

    for (const actor of order) {
      if (!actor.alive) continue;

      // 控制检查
      const incap = isIncapacitated(actor);
      if (incap) {
        events.push({ type: 'skip', actorId: actor.id, reason: incap });
        continue;
      }

      const side = actor.side;
      const intent = sideState[side].intent;
      const column = colOf(actor.slot);
      const chain = sideState[side].chains[column];
      const rooted = isRooted(actor);

      // ① 选招：封穴只能普攻；内力不足自动普攻（设计 §2.1.1-4）
      const skill = isSealed(actor) ? null : chooseSkill(actor, chain, intent);

      // ② 连招推进（定身不参与同列连击：不读不写链）
      let outcome: ComboOutcome = NEUTRAL_OUTCOME;
      if (!rooted && skill) {
        const advanced = advanceCombo(chain, skill);
        sideState[side].chains[column] = advanced.chain;
        outcome = advanced.outcome;
      }

      // ③ 目标选取：范围 + 战斗倾向 → 有序目标（第 1 位吃全额）
      const range: RangeId = skill ? skill.range : 'single_any';
      const plan = selectTargets({
        actor,
        units,
        range,
        ...(skill?.randomCount !== undefined ? { randomCount: skill.randomCount } : {}),
        intent,
        rng,
      });
      const targets = plan.targets;
      if (targets.length === 0) continue;

      // ④ 扣内力（普攻不消耗）
      const cost = skill ? skill.innerCost : 0;
      if (cost > 0) actor.inner = Math.max(0, actor.inner - cost);
      if (outcome.stage === 2) stats.comboStage2++;
      if (outcome.stage === 3) stats.comboStage3++;
      if (!skill) stats.basicAttacks++;

      events.push({
        type: 'act',
        actorId: actor.id,
        actorName: actor.cfg.name,
        skillId: skill?.id ?? 'basic',
        skillName: skill?.name ?? '普攻',
        range,
        targetIds: targets.map((t) => t.id),
        basic: !skill,
        cost,
        innerAfter: actor.inner,
        comboStage: outcome.stage,
        comboBonus: outcome.bonusDamage,
      });

      const skillView: SkillView = skill
        ? { power: skill.power, multiplier: skill.multiplier }
        : { power: 0, multiplier: 1 };

      // 逐目标结算：每个目标独立走完 命中 → 暴击 → 伤害 → 递减
      // 注意：targets 是**出手瞬间的快照**，途中死亡的目标跳过且不递补
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i]!;
        if (!target.alive) continue;

        const attackOpts: AttackOptions = { extraDamage: outcome.bonusDamage };
        if (outcome.lifestealBonus > 0) attackOpts.extraLifesteal = outcome.lifestealBonus;
        if (!skill) attackOpts.atkMul = BASIC_ATTACK_ATK_MUL;

        const result = computeDamage({
          attacker: toAttacker(actor, bonusOf(side), target, attackOpts),
          defender: toDefender(target, bonusOf(target.side)),
          skill: skillView,
          groupDecay: groupDecay(i + 1), // 第 i+1 个目标的递减系数
          hitRoll: rng.next(),
          critRoll: rng.next(),
        });

        if (!result.hit) {
          events.push({ type: 'miss', targetId: target.id });
          continue;
        }

        target.hp = Math.max(0, target.hp - result.damage);
        stats.totalDamage += result.damage;
        if (actor.side === 'ally') stats.allyDamage += result.damage;
        else stats.enemyDamage += result.damage;

        // 吸血（不超过气血上限，GDD 明确要求）
        let healed = 0;
        if (result.lifesteal > 0) {
          const before = actor.hp;
          actor.hp = Math.min(actor.hpMax, actor.hp + result.lifesteal);
          healed = actor.hp - before;
        }

        events.push({
          type: 'damage',
          targetId: target.id,
          value: result.damage,
          crit: result.crit,
          hpAfter: target.hp,
          lifesteal: healed,
        });

        // ── 受击反弹（天罡北斗阵）：被打的人按比例弹回去 ──
        const reflectRate = bonusOf(target.side)?.special.reflect ?? 0;
        if (reflectRate > 0 && result.damage > 0) {
          const back = Math.max(1, Math.round(result.damage * reflectRate));
          actor.hp = Math.max(0, actor.hp - back);
          stats.totalDamage += back;
          stats.reflectDamage += back;
          if (actor.side === 'ally') stats.enemyDamage += back;
          else stats.allyDamage += back;
          events.push({
            type: 'reflect',
            targetId: actor.id,
            value: back,
            hpAfter: actor.hp,
            sourceName: target.cfg.name,
          });
          if (actor.hp <= 0) {
            actor.alive = false;
            stats.deaths++;
            events.push({ type: 'death', unitId: actor.id, unitName: actor.cfg.name });
          }
        }

        // 施加状态：命中的目标按概率中招（控制类同样掷骰）
        const statusCfg = skill?.status;
        if (statusCfg && target.hp > 0 && rng.chance(statusCfg.chance)) {
          applyStatus(target, statusCfg.id, statusCfg.rounds, events, round, sideState, bonusOf);
        }

        if (target.hp <= 0 && target.alive) {
          target.alive = false;
          stats.deaths++;
          events.push({ type: 'death', unitId: target.id, unitName: target.cfg.name });
        }
      }

      // 每次出手后立刻判断胜负，避免"死了还在打"
      if (aliveOf('ally').length === 0 || aliveOf('enemy').length === 0) break;
    }

    // 回合末：持续伤害 / 回复 → 内力回复 → 状态倒计时
    tickEndOfRound(units, events, stats, round, bonusOf);

    if (aliveOf('ally').length === 0 || aliveOf('enemy').length === 0) break;
  }

  /* ────────────── 判定结果 ────────────── */
  const allyAlive = aliveOf('ally').length;
  const enemyAlive = aliveOf('enemy').length;
  if (allyAlive > 0 && enemyAlive === 0) winner = 'ally';
  else if (enemyAlive > 0 && allyAlive === 0) winner = 'enemy';
  else winner = 'draw'; // 双方存活但回合耗尽 → 判平（GDD：> 30 回合视为数值缺陷）

  const finalRounds = Math.min(round, maxRounds);
  events.push({ type: 'battleEnd', winner, rounds: finalRounds, allyAlive, enemyAlive });

  const summaryOf = (b: SideBonus | null) =>
    b ? { id: b.id, name: b.name, level: b.level, result: b.result } : null;

  return {
    seed: setup.seed,
    winner,
    rounds: finalRounds,
    events,
    finalHp: Object.fromEntries(units.map((u) => [u.id, u.hp])),
    finalInner: Object.fromEntries(units.map((u) => [u.id, u.inner])),
    stats,
    formations: { ally: summaryOf(allyBonus), enemy: summaryOf(enemyBonus) },
    intents,
  };
}

/* ══════════════════════ 状态处理 ══════════════════════ */

function applyStatus(
  target: UnitState,
  id: StatusId,
  rounds: number,
  events: BattleEvent[],
  currentRound: number,
  sideState: Record<'ally' | 'enemy', SideState>,
  bonusOf: (side: 'ally' | 'enemy') => SideBonus | null,
): void {
  const def = STATUS_BY_ID.get(id);
  if (!def) return;

  // 免疫检查 ①：目标身上有能挡下该状态的护体效果（例如"铁壁"挡"破防"）
  if (def.blockedBy === 'ironWall' && target.statuses.some((s) => s.id === 'ironWall')) return;

  // 免疫检查 ②：守境阵「首次受制可免」—— 只免第一次，之后照常中招
  const sideBonus = bonusOf(target.side);
  if (def.kind === 'control' && sideBonus?.special.immuneFirstControl) {
    const st = sideState[target.side];
    if (!st.immuneUsed) {
      st.immuneUsed = true;
      events.push({ type: 'immune', targetId: target.id, statusId: id });
      return;
    }
  }

  const existing = target.statuses.find((s) => s.id === id);
  if (existing) {
    // 已有该状态：叠层（不超过上限）并刷新持续回合。
    // 注意**不刷新 appliedRound**，否则反复叠层会让持续伤害被无限推迟。
    existing.stacks = Math.min(def.maxStacks, existing.stacks + 1);
    existing.remaining = Math.max(existing.remaining, rounds);
  } else {
    target.statuses.push({ id, remaining: rounds, stacks: 1, appliedRound: currentRound });
  }
  events.push({ type: 'statusApplied', targetId: target.id, statusId: id, rounds });
}

/**
 * 回合末结算，顺序固定：
 *   ① 持续效果（中毒/流血/灼烧扣血；**回春回血**）
 *   ② 内力回复（内息 ÷ 10 ×（1 + 状态/阵法加成）；封穴减半）
 *   ③ 所有状态剩余回合 −1 并清理到期状态
 *
 * 注意：持续伤害/回复在**施加当回合不结算**，从下一回合起生效 ——
 * 避免"刚被施加就立刻吃一次伤害"的体感问题。
 */
function tickEndOfRound(
  units: UnitState[],
  events: BattleEvent[],
  stats: { totalDamage: number },
  currentRound: number,
  bonusOf: (side: 'ally' | 'enemy') => SideBonus | null,
): void {
  for (const u of units) {
    if (!u.alive) continue;

    // ① 持续效果
    for (const st of u.statuses) {
      const def = STATUS_BY_ID.get(st.id);
      if (!def?.dot) continue;
      if (st.appliedRound >= currentRound) continue;
      const basis = def.dot.basis === 'maxHp' ? u.hpMax : u.hp;
      const raw = Math.round(basis * def.dot.percent * st.stacks);

      if (raw < 0) {
        // percent 为负 = 治疗（回春）。修掉"回春反而扣 1 点血"的老问题。
        const before = u.hp;
        u.hp = Math.min(u.hpMax, u.hp + Math.abs(raw));
        const healed = u.hp - before;
        if (healed > 0) {
          events.push({ type: 'heal', targetId: u.id, statusId: st.id, value: healed, hpAfter: u.hp });
        }
        continue;
      }

      const dmg = Math.max(1, raw);
      u.hp = Math.max(0, u.hp - dmg);
      stats.totalDamage += dmg;
      events.push({ type: 'dot', targetId: u.id, statusId: st.id, value: dmg, hpAfter: u.hp });
      if (u.hp <= 0) {
        u.alive = false;
        events.push({ type: 'death', unitId: u.id, unitName: u.cfg.name });
        break;
      }
    }
    if (!u.alive) continue;

    // ② 内力回复
    const regenMul = 1 + mergedMods(u, bonusOf(u.side)).innerRegen;
    const sealPenalty = isSealed(u) ? 0.5 : 1;
    const gain = u.cfg.stats.innerRegen * Math.max(0, regenMul) * sealPenalty;
    u.inner = Math.min(u.cfg.stats.innerMax, u.inner + Math.max(0, Math.round(gain)));

    // ③ 状态倒计时（当回合刚施加的不减，保证 1 回合的控制真的能控住一次）
    u.statuses = u.statuses
      .map((s) => (s.appliedRound < currentRound ? { ...s, remaining: s.remaining - 1 } : s))
      .filter((s) => s.remaining > 0);
  }
}

/* ══════════════════════ 模拟器（数值平衡用） ══════════════════════ */

export interface SimulationSummary {
  runs: number;
  allyWinRate: number;
  avgRounds: number;
  avgAllyDamage: number;
  avgEnemyDamage: number;
  avgReflectDamage: number;
  /** 场均连招第 2 段次数（用来验证"连招真的在触发"，而不是纸面机制） */
  avgComboStage2: number;
  /** 场均三连次数 */
  avgComboStage3: number;
  /** 场均因内力不足/被封穴而改用普攻的次数 */
  avgBasicAttacks: number;
  /** 回合数分布，用来发现"秒杀"或"打不完"的失衡 */
  roundHistogram: Record<number, number>;
}

/**
 * 批量模拟若干场（不同种子），用于数值平衡验收。
 * GDD M1 的验收标准之一就是"100 场自动模拟战斗通过"。
 */
export function simulateMany(setup: Omit<BattleSetup, 'seed'>, runs: number): SimulationSummary {
  let allyWins = 0;
  let totalRounds = 0;
  let totalAllyDmg = 0;
  let totalEnemyDmg = 0;
  let totalReflect = 0;
  let totalCombo2 = 0;
  let totalCombo3 = 0;
  let totalBasic = 0;
  const roundHistogram: Record<number, number> = {};

  for (let i = 0; i < runs; i++) {
    const log = simulateBattle({ ...setup, seed: `sim-${i}` });
    if (log.winner === 'ally') allyWins++;
    totalRounds += log.rounds;
    totalAllyDmg += log.stats.allyDamage;
    totalEnemyDmg += log.stats.enemyDamage;
    totalReflect += log.stats.reflectDamage;
    totalCombo2 += log.stats.comboStage2;
    totalCombo3 += log.stats.comboStage3;
    totalBasic += log.stats.basicAttacks;
    roundHistogram[log.rounds] = (roundHistogram[log.rounds] ?? 0) + 1;
  }

  return {
    runs,
    allyWinRate: allyWins / runs,
    avgRounds: totalRounds / runs,
    avgAllyDamage: totalAllyDmg / runs,
    avgEnemyDamage: totalEnemyDmg / runs,
    avgReflectDamage: totalReflect / runs,
    avgComboStage2: totalCombo2 / runs,
    avgComboStage3: totalCombo3 / runs,
    avgBasicAttacks: totalBasic / runs,
    roundHistogram,
  };
}

/** 供 UI 显示：某站位属于哪一排哪一列 */
export function describeSlot(slot: SlotIndex): string {
  const rowName = { front: '前排', mid: '中排', back: '后排' } as const;
  const colName = { left: '左', center: '中', right: '右' } as const;
  return `${rowName[rowOf(slot)]}${colName[colOf(slot)]}`;
}

/** 便于外部做范围校验（避免误用不存在的列/排） */
export const SLOT_GROUPS = { ROW_SLOTS, COL_SLOTS };
