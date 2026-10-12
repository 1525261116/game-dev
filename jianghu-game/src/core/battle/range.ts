/**
 * 攻击范围（10 型）—— 纯逻辑，禁止依赖 Phaser
 *
 * 数值与语义口径：jianghu-design/05_combat/功法系统.md §6.5（定稿）
 *
 * ┌─ 双轴存储模型（§6.5.1）────────────────────────────────────┐
 * │ 范围 = 「目标数量 count」×「命中区域 area」                    │
 * │   数量：1（单体）/ n（随机 N 个）/ all（区域内全部）              │
 * │   区域：any / front / mid / back / column / cross / all        │
 * └──────────────────────────────────────────────────────────┘
 *
 * 为什么要把「打几个」和「打哪些」拆成两个轴？
 *   因为 10 型范围只是这两个轴上的 10 个合法组合。将来若要加型
 *  （例如"单体中排"），只需在 RANGE_TABLE 里补一行，选目标算法与
 *   伤害递减逻辑**一行都不用改**。
 *
 * 注意：本文件只回答"哪些格子"和"最多打几个"，**不回答"打谁"**。
 *   真正的选目标（候选池 → 战斗倾向排序 → 取前 C）在 targeting.ts，
 *   因为那一步依赖单位血量、站位分布与连招链状态。
 */
import { ALL_SLOTS, COL_SLOTS, ROW_SLOTS, colOf, rowOf } from './types.ts';
import type { ColName, RowName, SlotIndex } from './types.ts';

/* ══════════════════════ 10 型枚举 ══════════════════════ */

/**
 * 10 型范围 id（顺序与功法系统 §6.5.2 的编号一致）。
 * ⚠️ 这是**战斗数据层**的枚举；表现层用的 4 型形状在 data/gongfa_visual.ts，
 *    两者通过 toVisualShape() 换算（§6.5.8）。
 */
export const RANGE_IDS = [
  'single_any',
  'single_front',
  'single_back',
  'all',
  'row_front',
  'row_mid',
  'row_back',
  'column',
  'cross',
  'random_n',
] as const;

export type RangeId = (typeof RANGE_IDS)[number];

/** 目标数量轴 */
export type RangeCount = '1' | 'n' | 'all';
/** 区域轴 */
export type RangeArea = 'any' | 'front' | 'mid' | 'back' | 'column' | 'cross' | 'all';

export interface RangeSpec {
  count: RangeCount;
  area: RangeArea;
}

/**
 * 10 型 → (数量, 区域)
 *
 * 来源：功法系统 §6.5.2 枚举表（逐行对照，不得改动）：
 *   1 single_any  1×any     2 single_front 1×front   3 single_back 1×back
 *   4 all         all×all   5 row_front  all×front   6 row_mid  all×mid
 *   7 row_back    all×back  8 column   all×column    9 cross    all×cross
 *  10 random_n    n×any
 */
export const RANGE_TABLE: Record<RangeId, RangeSpec> = {
  single_any: { count: '1', area: 'any' },
  single_front: { count: '1', area: 'front' },
  single_back: { count: '1', area: 'back' },
  all: { count: 'all', area: 'all' },
  row_front: { count: 'all', area: 'front' },
  row_mid: { count: 'all', area: 'mid' },
  row_back: { count: 'all', area: 'back' },
  column: { count: 'all', area: 'column' },
  cross: { count: 'all', area: 'cross' },
  random_n: { count: 'n', area: 'any' },
};

export function isRangeId(v: string): v is RangeId {
  return (RANGE_IDS as readonly string[]).includes(v);
}

/* ══════════════════════ 随机 N 的 N ══════════════════════ */

/** 随机 N 的 N ∈ {2,3,4}（§6.5.3 ②），常用 3 */
export const RANDOM_COUNT_RANGE = { min: 2, max: 4 } as const;
export const DEFAULT_RANDOM_COUNT = 3;

/* ══════════════════════ 区域 → 格子集合 ══════════════════════ */

const ROW_AREA: Partial<Record<RangeArea, RowName>> = {
  front: 'front',
  mid: 'mid',
  back: 'back',
};

/**
 * 动态正交十字（§6.5.3 ①）：以 center 为中心，取上下左右四邻，**不取对角**。
 *   角 → 3 格（0 → {0,1,3}）
 *   边中 → 4 格（1 → {1,0,2,4}）
 *   正中 → 5 格（4 → {4,1,3,5,7}）
 */
export function crossSlots(center: SlotIndex): SlotIndex[] {
  const r = Math.floor(center / 3);
  const c = center % 3;
  const out: SlotIndex[] = [center];
  if (r > 0) out.push(((r - 1) * 3 + c) as SlotIndex);
  if (r < 2) out.push(((r + 1) * 3 + c) as SlotIndex);
  if (c > 0) out.push((r * 3 + (c - 1)) as SlotIndex);
  if (c < 2) out.push((r * 3 + (c + 1)) as SlotIndex);
  return out;
}

/**
 * 某个区域覆盖的全部格子（受击方视角）。
 *
 * column / cross 需要一个 anchor（锚点格）：
 *   · column：由调用方先选"存活敌人最密集的那一列"，anchor 取该列任意一格
 *   · cross ：anchor = 候选池按战斗倾向排序后的第 1 名（见 targeting.ts）
 */
export function areaSlots(area: RangeArea, anchor: SlotIndex = 4): readonly SlotIndex[] {
  const row = ROW_AREA[area];
  if (row) return ROW_SLOTS[row];
  if (area === 'column') return COL_SLOTS[colOf(anchor)];
  if (area === 'cross') return crossSlots(anchor);
  return ALL_SLOTS; // any / all
}

/**
 * 就近回退顺序（§6.5.7 边界处理）：
 *   前排无人 → 退中排 → 再退后排
 *   后排无人 → 退中排 → 再退前排
 *   中排无人 → 退前排（更靠敌）→ 再退后排
 */
export function rowFallbackOrder(row: RowName): readonly RowName[] {
  if (row === 'front') return ['front', 'mid', 'back'];
  if (row === 'back') return ['back', 'mid', 'front'];
  return ['mid', 'front', 'back'];
}

/** 按「生存者最密集」挑一列；同分取**更靠前**的列（列内最小站位更小者） */
export function densestColumn(slots: readonly SlotIndex[]): ColName {
  const order: readonly ColName[] = ['left', 'center', 'right'];
  let best: ColName = 'left';
  let bestCount = -1;
  for (const col of order) {
    const count = slots.filter((s) => colOf(s) === col).length;
    const firstSlot = COL_SLOTS[col][0]!;
    const bestFirst = COL_SLOTS[best][0]!;
    // 严格大于才替换 → 同分时保留 order 里更靠前的列（left < center < right）
    if (count > bestCount || (count === bestCount && firstSlot < bestFirst)) {
      best = col;
      bestCount = count;
    }
  }
  return best;
}

/* ══════════════════════ 目标上限 C ══════════════════════ */

/**
 * 目标上限 C（§6.5.5）：
 *   单体 → 1；随机 N → N（钳到存活数）；区域全部 → 区域内存活数（不额外封顶）
 */
export function rangeTargetCap(
  range: RangeId,
  poolSize: number,
  randomCount: number = DEFAULT_RANDOM_COUNT,
): number {
  const { count } = RANGE_TABLE[range];
  if (count === '1') return Math.min(1, poolSize);
  if (count === 'n') return Math.min(Math.max(1, randomCount), poolSize);
  return poolSize;
}

/* ══════════════════════ 与表现层对齐（§6.5.8） ══════════════════════ */

/** 表现层的 4 型特效形状（与 data/gongfa_visual.ts 的 TargetShape 同值） */
export type VisualShape = 'single' | 'row' | 'column' | 'all';

/**
 * 10 型战斗范围 → 表现形状。
 * 多个范围共用一种特效（§6.5.8）：cross 用 single（以 anchor 播十字，后续再独立），
 * random_n 用 row（散射表现）。
 */
export function toVisualShape(range: RangeId): VisualShape {
  switch (RANGE_TABLE[range].area) {
    case 'front':
    case 'mid':
    case 'back':
      return RANGE_TABLE[range].count === '1' ? 'single' : 'row';
    case 'column':
      return 'column';
    case 'all':
      return 'all';
    case 'cross':
      return 'single';
    default:
      return RANGE_TABLE[range].count === 'n' ? 'row' : 'single';
  }
}

/** 中文名（UI 与日志用） */
export const RANGE_NAME: Record<RangeId, string> = {
  single_any: '单体',
  single_front: '单体前排',
  single_back: '单体后排',
  all: '全体',
  row_front: '前排范围',
  row_mid: '中排范围',
  row_back: '后排范围',
  column: '整列',
  cross: '十字',
  random_n: '随机 N',
};

/** 供 UI/日志描述：某站位属于哪一排（复用 rowOf，避免各处重复实现） */
export function rowLabel(slot: SlotIndex): string {
  const map = { front: '前排', mid: '中排', back: '后排' } as const;
  return map[rowOf(slot)];
}
