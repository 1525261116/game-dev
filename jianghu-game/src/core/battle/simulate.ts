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
 * 阵法系统：
 *   阵法是「按站位满足条件 → 给全队加成」的机制。它让九宫格的位次有了意义，
 *   也是玩家愿意反复调整阵容的动力。加成的求解在 core/battle/formation.ts，
 *   表在 data/formations.ts —— 本文件只负责把结果**应用**到战斗中。
 *
 *   注意：`allyFormation` / `enemyFormation` 都是**可选**参数。
 *         不传阵法时，战斗行为与接入阵法之前完全一致（向后兼容）。
 */
import { computeDamage, groupDecay } from './formula.ts';
import { resolveFormation, describeBonus } from './formation.ts';
import { createRng } from './rng.ts';
import { colOf, partyScale, rowOf, COL_SLOTS, ROW_SLOTS } from './types.ts';
import { STATUS_DEFS } from '../../data/status.ts';
import { getFormation } from '../../data/formations.ts';
import type { Rng } from './rng.ts';
import type { AttackerView, DefenderView, SkillView } from './formula.ts';
import type { MotionGroup } from '../anim/types.ts';
import type {
  FormationBonus,
  Placement,
  RequirementResult,
  SlotIndex,
  StatMods,
  StatusId,
} from './types.ts';
import type { TargetShape } from '../../data/gongfa_visual.ts';

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
}

/** 本场使用的主动招式 */
export interface SkillConfig {
  id: string;
  name: string;
  /** 功法威力（来自 data/gongfa-power.ts，已含 ×3） */
  power: number;
  /** 招式倍率 */
  multiplier: number;
  /** 打击范围：决定打几个 / 打哪些 */
  targets: TargetShape;
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
  skill: SkillConfig;
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
}

/* ══════════════════════ 输出：战斗日志 ══════════════════════ */

export type BattleEvent =
  /** 战斗开始：记录双方初始状态 */
  | { type: 'battleStart'; units: { id: string; name: string; side: 'ally' | 'enemy'; slot: SlotIndex; group: MotionGroup; hpMax: number }[] }
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
  /** 某单位出手 */
  | { type: 'act'; actorId: string; actorName: string; skillId: string; skillName: string; targetIds: string[] }
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
  /** 汇总统计，便于做数值平衡分析 */
  stats: {
    totalDamage: number;
    allyDamage: number;
    enemyDamage: number;
    deaths: number;
    /** 反弹造成的总伤害（用于校验阵法效果真的生效） */
    reflectDamage: number;
  };
  /** 本场生效的阵法（无阵法时为 null） */
  formations: {
    ally: { id: string; name: string; level: number; result: RequirementResult } | null;
    enemy: { id: string; name: string; level: number; result: RequirementResult } | null;
  };
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

/** 记录某一方"免疫首次控制"是否已被消耗 */
interface SideState {
  immuneUsed: boolean;
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

interface UnitState {
  cfg: BattleUnitConfig;
  hp: number;
  hpMax: number;
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

/**
 * 把单位转成伤害公式需要的"攻方视图"。
 * 这里同时处理两种**依赖站位**的阵法效果：
 *   · 锋矢阵 columnDamage：与目标同列时增伤
 *   · 雁行阵 backRowDamage：站后排时增伤
 */
function toAttacker(unit: UnitState, bonus: SideBonus | null, target: UnitState): AttackerView {
  const m = mergedMods(unit, bonus);
  const sp = bonus?.special ?? {};

  let bonusDamage = m.damageDealt;
  if (sp.columnDamage && colOf(unit.cfg.slot) === colOf(target.cfg.slot)) {
    bonusDamage += sp.columnDamage;
  }
  if (sp.backRowDamage && rowOf(unit.cfg.slot) === 'back') {
    bonusDamage += sp.backRowDamage;
  }

  return {
    atk: unit.cfg.stats.atk * (1 + m.atk),
    crit: Math.min(0.75, unit.cfg.stats.crit * (1 + m.crit)),
    critDamage: 1.5,
    hit: Math.min(0.95, unit.cfg.stats.hit * (1 + m.hit)),
    lifesteal: unit.cfg.stats.lifesteal + m.lifesteal,
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
  const rooted = unit.statuses.some((s) => s.id === 'root');

  let damageTaken = m.damageTaken;
  if (sp.frontRowTaken && rowOf(unit.cfg.slot) === 'front') {
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

/* ══════════════════════ 目标选择 ══════════════════════ */

/**
 * 按招式范围挑出**有序**目标列表（第 1 位 = 主目标，吃全额伤害）。
 * 排序规则：站位编号升序（前排优先）。
 */
function selectTargets(actor: UnitState, all: UnitState[], shape: TargetShape): UnitState[] {
  const foes = all
    .filter((u) => u.cfg.side !== actor.cfg.side && u.alive)
    .sort((a, b) => a.cfg.slot - b.cfg.slot);
  if (foes.length === 0) return [];

  switch (shape) {
    case 'single':
      return [foes[0]!];
    case 'all':
      return foes;
    case 'column': {
      const col = colOf(actor.cfg.slot);
      const inCol = foes.filter((u) => colOf(u.cfg.slot) === col);
      // 若该列无人（常见于 3v3 时站位不齐），退化为单体，保证动作不会"空放"
      return inCol.length > 0 ? inCol : [foes[0]!];
    }
    case 'row': {
      const row = rowOf(actor.cfg.slot);
      const inRow = foes.filter((u) => rowOf(u.cfg.slot) === row);
      return inRow.length > 0 ? inRow : [foes[0]!];
    }
    default:
      return [foes[0]!];
  }
}

/* ══════════════════════ 主流程 ══════════════════════ */

/**
 * 实例化一个单位。
 * 气血上限在此处应用两类修正：编队系数（敌方随我方人数缩放）+ 阵法 hpMax 加成。
 */
function instantiate(cfg: BattleUnitConfig, hpScale: number, bonus: SideBonus | null): UnitState {
  const hpBonus = bonus?.mods.hpMax ?? 0;
  const hpMax = Math.max(1, Math.round(cfg.stats.hpMax * hpScale * (1 + hpBonus)));
  return { cfg, hp: hpMax, hpMax, statuses: [], alive: true };
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

  const sideState: Record<'ally' | 'enemy', SideState> = {
    ally: { immuneUsed: false },
    enemy: { immuneUsed: false },
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

  const stats = { totalDamage: 0, allyDamage: 0, enemyDamage: 0, deaths: 0, reflectDamage: 0 };

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
        events.push({ type: 'skip', actorId: actor.cfg.id, reason: incap });
        continue;
      }

      const targets = selectTargets(actor, units, actor.cfg.skill.targets);
      if (targets.length === 0) continue;

      events.push({
        type: 'act',
        actorId: actor.cfg.id,
        actorName: actor.cfg.name,
        skillId: actor.cfg.skill.id,
        skillName: actor.cfg.skill.name,
        targetIds: targets.map((t) => t.cfg.id),
      });

      const skill: SkillView = {
        power: actor.cfg.skill.power,
        multiplier: actor.cfg.skill.multiplier,
      };

      // 逐目标结算：每个目标独立走完 命中 → 暴击 → 伤害 → 递减
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i]!;
        if (!target.alive) continue;

        const result = computeDamage({
          attacker: toAttacker(actor, bonusOf(actor.cfg.side), target),
          defender: toDefender(target, bonusOf(target.cfg.side)),
          skill,
          groupDecay: groupDecay(i + 1), // 第 i+1 个目标的递减系数
          hitRoll: rng.next(),
          critRoll: rng.next(),
        });

        if (!result.hit) {
          events.push({ type: 'miss', targetId: target.cfg.id });
          continue;
        }

        target.hp = Math.max(0, target.hp - result.damage);
        stats.totalDamage += result.damage;
        if (actor.cfg.side === 'ally') stats.allyDamage += result.damage;
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
          targetId: target.cfg.id,
          value: result.damage,
          crit: result.crit,
          hpAfter: target.hp,
          lifesteal: healed,
        });

        // ── 受击反弹（天罡北斗阵）：被打的人按比例弹回去 ──
        const reflectRate = bonusOf(target.cfg.side)?.special.reflect ?? 0;
        if (reflectRate > 0 && result.damage > 0) {
          const back = Math.max(1, Math.round(result.damage * reflectRate));
          actor.hp = Math.max(0, actor.hp - back);
          stats.totalDamage += back;
          stats.reflectDamage += back;
          if (actor.cfg.side === 'ally') stats.enemyDamage += back;
          else stats.allyDamage += back;
          events.push({
            type: 'reflect',
            targetId: actor.cfg.id,
            value: back,
            hpAfter: actor.hp,
            sourceName: target.cfg.name,
          });
          if (actor.hp <= 0) {
            actor.alive = false;
            stats.deaths++;
            events.push({ type: 'death', unitId: actor.cfg.id, unitName: actor.cfg.name });
          }
        }

        // 施加状态：命中的目标按概率中招（控制类同样掷骰）
        const statusCfg = actor.cfg.skill.status;
        if (statusCfg && target.hp > 0 && rng.chance(statusCfg.chance)) {
          applyStatus(target, statusCfg.id, statusCfg.rounds, events, round, sideState, bonusOf);
        }

        if (target.hp <= 0 && target.alive) {
          target.alive = false;
          stats.deaths++;
          events.push({ type: 'death', unitId: target.cfg.id, unitName: target.cfg.name });
        }
      }

      // 每次出手后立刻判断胜负，避免"死了还在打"
      if (aliveOf('ally').length === 0 || aliveOf('enemy').length === 0) break;
    }

    // 回合末：持续伤害 → 状态倒计时
    tickEndOfRound(units, events, stats, round);

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
    finalHp: Object.fromEntries(units.map((u) => [u.cfg.id, u.hp])),
    stats,
    formations: { ally: summaryOf(allyBonus), enemy: summaryOf(enemyBonus) },
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
  const sideBonus = bonusOf(target.cfg.side);
  if (def.kind === 'control' && sideBonus?.special.immuneFirstControl) {
    const st = sideState[target.cfg.side];
    if (!st.immuneUsed) {
      st.immuneUsed = true;
      events.push({ type: 'immune', targetId: target.cfg.id, statusId: id });
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
  events.push({ type: 'statusApplied', targetId: target.cfg.id, statusId: id, rounds });
}

/** 回合末结算：先跳持续伤害，再让所有状态减一回合并清理到期状态 */
function tickEndOfRound(
  units: UnitState[],
  events: BattleEvent[],
  stats: { totalDamage: number },
  currentRound: number,
): void {
  for (const u of units) {
    if (!u.alive) continue;

    // ① 持续伤害（施加当回合不结算，从下一回合起生效）
    for (const st of u.statuses) {
      const def = STATUS_BY_ID.get(st.id);
      if (!def?.dot) continue;
      if (st.appliedRound >= currentRound) continue;
      const basis = def.dot.basis === 'maxHp' ? u.hpMax : u.hp;
      const dmg = Math.max(1, Math.round(basis * def.dot.percent * st.stacks));
      u.hp = Math.max(0, u.hp - dmg);
      stats.totalDamage += dmg;
      events.push({ type: 'dot', targetId: u.cfg.id, statusId: st.id, value: dmg, hpAfter: u.hp });
      if (u.hp <= 0) {
        u.alive = false;
        events.push({ type: 'death', unitId: u.cfg.id, unitName: u.cfg.name });
        break;
      }
    }

    // ② 状态倒计时（当回合刚施加的不减，保证 1 回合的控制真的能控住一次）
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
  const roundHistogram: Record<number, number> = {};

  for (let i = 0; i < runs; i++) {
    const log = simulateBattle({ ...setup, seed: `sim-${i}` });
    if (log.winner === 'ally') allyWins++;
    totalRounds += log.rounds;
    totalAllyDmg += log.stats.allyDamage;
    totalEnemyDmg += log.stats.enemyDamage;
    totalReflect += log.stats.reflectDamage;
    roundHistogram[log.rounds] = (roundHistogram[log.rounds] ?? 0) + 1;
  }

  return {
    runs,
    allyWinRate: allyWins / runs,
    avgRounds: totalRounds / runs,
    avgAllyDamage: totalAllyDmg / runs,
    avgEnemyDamage: totalEnemyDmg / runs,
    avgReflectDamage: totalReflect / runs,
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
