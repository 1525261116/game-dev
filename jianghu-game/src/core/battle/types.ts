/**
 * 战斗核心类型：阵法、状态效果、编队。
 * 纯逻辑，禁止依赖 Phaser。
 *
 * 对齐说明见 jianghu-design/05_combat/烟雨江湖战斗对齐.md。
 */

/* ------------------------------------------------------------ 九宫格 */

/** 九宫格索引 0~8 对应站位编号 1~9（0=前排上，8=后排下） */
export type SlotIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const ALL_SLOTS: readonly SlotIndex[] = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;

export type RowName = 'front' | 'mid' | 'back';
export type ColName = 'left' | 'center' | 'right';

/** 行：前排 0/1/2，中排 3/4/5，后排 6/7/8 */
export const ROW_SLOTS: Record<RowName, readonly SlotIndex[]> = {
  front: [0, 1, 2],
  mid: [3, 4, 5],
  back: [6, 7, 8],
};

/** 列：左 0/3/6，中 1/4/7，右 2/5/8 */
export const COL_SLOTS: Record<ColName, readonly SlotIndex[]> = {
  left: [0, 3, 6],
  center: [1, 4, 7],
  right: [2, 5, 8],
};

/** 四角 */
export const CORNER_SLOTS: readonly SlotIndex[] = [0, 2, 6, 8] as const;

/** 阵型布置：每个格子放一个单位 id（或空） */
export type Placement = readonly (string | null)[];

export function countOccupied(p: Placement): number {
  return p.filter((x) => x !== null).length;
}

export function rowOf(slot: SlotIndex): RowName {
  return slot <= 2 ? 'front' : slot <= 5 ? 'mid' : 'back';
}

export function colOf(slot: SlotIndex): ColName {
  return slot % 3 === 0 ? 'left' : slot % 3 === 1 ? 'center' : 'right';
}

/** 同列单位（用于列连击/锋矢阵/敌方同列集火） */
export function sameColumn(slot: SlotIndex): readonly SlotIndex[] {
  return COL_SLOTS[colOf(slot)];
}

/* ------------------------------------------------------------ 编队系数 */

/**
 * 编队系数（对齐烟雨江湖的 3→4→5 人成长）：
 * 以 4 人为基准，敌方气血按此系数缩放，保证 TTK 恒定。
 */
export const PARTY_SCALE_BASE = 4;

export function partyScale(memberCount: number): number {
  if (memberCount < 1) throw new Error('编队人数至少为 1');
  return Math.round((memberCount / PARTY_SCALE_BASE) * 100) / 100;
}

/** 上阵人数成长的解锁条件（与 GDD 2.1 一致） */
export interface RosterTier {
  members: number;
  unlock: string;
  /** 声望门槛 */
  reputation?: number;
  /** 门派等级门槛 */
  sectLevel?: number;
}

export const ROSTER_TIERS: readonly RosterTier[] = [
  { members: 3, unlock: '初始' },
  { members: 4, unlock: '自创门派（阶段 3）', reputation: 500 },
  { members: 5, unlock: '门派等级 ≥ 3（阶段 4~5）', sectLevel: 3 },
  { members: 6, unlock: '门派战（含战斗型弟子）', sectLevel: 3 },
] as const;

/** 根据进度求当前上阵上限（常规战斗；门派战另算） */
export function maxPartySize(state: { reputation: number; sectLevel: number; isSectWar?: boolean }): number {
  if (state.isSectWar) return state.sectLevel >= 3 ? 6 : 4;
  if (state.sectLevel >= 3) return 5;
  if (state.reputation >= 500) return 4;
  return 3;
}

/* ------------------------------------------------------------ 状态效果 */

export type StatusId =
  // 控制
  | 'stun'
  | 'seal'
  | 'root'
  | 'knockback'
  // 减益
  | 'defDown'
  | 'atkDown'
  | 'spdDown'
  | 'innerDown'
  | 'poison'
  | 'bleed'
  | 'burn'
  | 'dodgeDown'
  | 'hitDown'
  // 增益
  | 'shield'
  | 'berserk'
  | 'haste'
  | 'regen'
  | 'ironWall'
  | 'swordHeart'
  | 'charge'
  | 'innerFlow'
  | 'thorns';

export type StatusKind = 'control' | 'debuff' | 'buff';

/** 属性修正（百分比，+0.3 = +30%） */
export interface StatMods {
  atk: number;
  def: number;
  hpMax: number;
  spd: number;
  crit: number;
  dodge: number;
  hit: number;
  innerRegen: number;
  /** 受到的伤害修正（负值 = 减伤） */
  damageTaken: number;
  /** 造成的伤害修正 */
  damageDealt: number;
  lifesteal: number;
}

export const ZERO_MODS: StatMods = {
  atk: 0,
  def: 0,
  hpMax: 0,
  spd: 0,
  crit: 0,
  dodge: 0,
  hit: 0,
  innerRegen: 0,
  damageTaken: 0,
  damageDealt: 0,
  lifesteal: 0,
};

export interface DotEffect {
  /** 每回合损失比例（0.05 = 5%） */
  percent: number;
  /** 基于最大气血还是当前气血 */
  basis: 'maxHp' | 'currentHp';
}

export interface StatusDef {
  id: StatusId;
  name: string;
  kind: StatusKind;
  /** 持续回合 */
  duration: number;
  /** 最大层数（1 = 不叠加） */
  maxStacks: number;
  dispellable: boolean;
  /** 对该状态的免疫标记（如守境阵免疫首次控制） */
  blockedBy?: 'immuneFirstControl' | 'ironWall';
  mods?: Partial<StatMods>;
  dot?: DotEffect;
  /** 特殊说明（无法用数值表达的效果，由战斗逻辑特判） */
  special?: string;
}

/* ------------------------------------------------------------ 阵法 */

export type FormationQuality = 'fan' | 'liang' | 'shang' | 'ji' | 'jue';

/** 站位要求 */
export type FormationRequirement =
  | { kind: 'any' }
  | { kind: 'minMembers'; count: number }
  | { kind: 'frontFull' }
  | { kind: 'rowFull'; row: RowName }
  | { kind: 'corners' }
  | { kind: 'allThreeRows' }
  | { kind: 'singleColumn'; count: number }
  | { kind: 'frontOneBackThree' };

/** 单级加成 */
export interface FormationBonus {
  mods?: Partial<StatMods>;
  /** 特殊效果（连招威力、反弹等），由战斗逻辑处理 */
  special?: {
    comboPower?: number;
    reflect?: number;
    columnDamage?: number;
    backRowDamage?: number;
    frontRowTaken?: number;
    immuneFirstControl?: boolean;
  };
}

export interface FormationDef {
  id: string;
  name: string;
  quality: FormationQuality;
  requirement: FormationRequirement;
  /** 1~5 级加成 */
  bonuses: readonly [FormationBonus, FormationBonus, FormationBonus, FormationBonus, FormationBonus];
  source: string;
  desc: string;
}

/** 站位校验结果 */
export type RequirementResult = 'ok' | 'partial' | 'fail';

export const FORMATION_MAX_LEVEL = 5;
