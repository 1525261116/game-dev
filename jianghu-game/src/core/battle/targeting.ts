/**
 * 目标选取 —— 纯逻辑，禁止依赖 Phaser
 *
 * 口径：jianghu-design/05_combat/功法系统.md §6.5.7「目标选取（由战斗倾向决定）」
 *
 * ══════════════════════════════════════════════════════════════════
 * 本作战中**全自动**，玩家不指定目标 —— 所以「选目标」是**战前策略**的
 * 最后一公里：范围决定"能打哪一格"，战斗倾向决定"先打哪一个"。
 *
 * 三步（顺序固定，不可调换）：
 *   ① 生成候选池（按范围的「区域」取格，含边界回退）
 *   ② 池内排序（按战斗倾向）
 *   ③ 取前 C 个（C = 目标上限，见 range.ts）
 *
 * 关键约束：
 *   · 返回的顺序就是**群体伤害递减 a_i 的序位**，第 1 位吃全额（见 formula.groupDecay）
 *   · 「出手瞬间对候选池做快照」—— 返回的数组是快照，结算途中死亡的目标由调用方
 *     跳过且**不递补**（防连锁），所以本文件不感知后续死亡
 * ══════════════════════════════════════════════════════════════════
 */
import { DEFAULT_RANDOM_COUNT, RANGE_TABLE, crossSlots, densestColumn, rangeTargetCap, rowFallbackOrder } from './range.ts';
import { colOf, rowOf } from './types.ts';
import type { RangeArea, RangeId } from './range.ts';
import type { SlotIndex } from './types.ts';
import type { Rng } from './rng.ts';

/* ══════════════════════ 输入 / 输出 ══════════════════════ */

/** 选目标只需要这些字段（避免与本文件耦合 battle 内部状态） */
export interface TargetableUnit {
  id: string;
  side: 'ally' | 'enemy';
  slot: SlotIndex;
  hp: number;
  alive: boolean;
}

/** 战斗倾向（§6.5.7 第二步的排序键） */
export type CombatIntent = 'output' | 'combo';

export interface TargetRequest<T extends TargetableUnit> {
  actor: T;
  /** 场上全部单位（含双方；本函数自行筛出敌对且存活者） */
  units: readonly T[];
  range: RangeId;
  /** 仅 random_n 使用；缺省 3 */
  randomCount?: number;
  intent: CombatIntent;
  /** 可播种随机数（random_n 取样用；铁律 5 禁止 Math.random） */
  rng: Rng;
}

export interface TargetPlan<T extends TargetableUnit = TargetableUnit> {
  /** 有序目标列表：第 1 位 = 主目标（吃全额伤害） */
  targets: T[];
  /** 表现层锚点：cross 的中心格 / column 的首格；其他范围可为 null */
  anchor: SlotIndex | null;
  /** 该区域本身没人，走了"就近回退"（日志与调试用） */
  fallback: boolean;
  /** 实际使用的区域（回退后可能与范围声明的区域不同） */
  usedArea: RangeArea;
}

/* ══════════════════════ ② 池内排序 ══════════════════════ */

/**
 * 战斗倾向 → 排序键：
 *   优先输出：血量升序 → 站位升序（"打最残血，同分最前"）
 *   优先连招：可接续本列连击者优先 → 站位升序
 */
function sortByIntent<T extends TargetableUnit>(
  pool: readonly T[],
  actor: TargetableUnit,
  intent: CombatIntent,
): T[] {
  const actorCol = colOf(actor.slot);
  return [...pool].sort((a, b) => {
    if (intent === 'output') {
      if (a.hp !== b.hp) return a.hp - b.hp;
    } else {
      const sa = colOf(a.slot) === actorCol ? 0 : 1;
      const sb = colOf(b.slot) === actorCol ? 0 : 1;
      if (sa !== sb) return sa - sb;
    }
    return a.slot - b.slot;
  });
}

/* ══════════════════════ ① 候选池 ══════════════════════ */

interface PoolResult<T extends TargetableUnit> {
  pool: T[];
  anchor: SlotIndex | null;
  usedArea: RangeArea;
  fallback: boolean;
}

/** 按区域生成候选池；区域为空时按 §6.5.7 的规则就近回退 */
function buildPool<T extends TargetableUnit>(
  area: RangeArea,
  foes: readonly T[],
  actor: TargetableUnit,
  intent: CombatIntent,
): PoolResult<T> {
  switch (area) {
    case 'any':
    case 'all':
      return { pool: [...foes], anchor: null, usedArea: area, fallback: false };

    case 'front':
    case 'mid':
    case 'back': {
      for (const row of rowFallbackOrder(area)) {
        const pool = foes.filter((u) => rowOf(u.slot) === row);
        if (pool.length > 0) {
          return { pool, anchor: null, usedArea: row, fallback: row !== area };
        }
      }
      return { pool: [...foes], anchor: null, usedArea: 'any', fallback: true };
    }

    case 'column': {
      // "存活敌人最密集的那一列（同分取站位更靠前的列）"
      const col = densestColumn(foes.map((u) => u.slot));
      const pool = foes.filter((u) => colOf(u.slot) === col);
      if (pool.length > 0) {
        return { pool, anchor: pool[0]!.slot, usedArea: 'column', fallback: false };
      }
      return { pool: [...foes], anchor: null, usedArea: 'any', fallback: true };
    }

    case 'cross': {
      // "先取锚点（对池内做一次排序、取第 1 名）定中心，再取该中心的正交十字"
      const anchor = sortByIntent(foes, actor, intent)[0]!.slot;
      const cells = crossSlots(anchor);
      const pool = foes.filter((u) => cells.includes(u.slot));
      if (pool.length > 0) {
        return { pool, anchor, usedArea: 'cross', fallback: false };
      }
      return { pool: [...foes], anchor: null, usedArea: 'any', fallback: true };
    }

    default:
      return { pool: [...foes], anchor: null, usedArea: 'any', fallback: false };
  }
}

/* ══════════════════════ 主入口 ══════════════════════ */

/**
 * 按范围与战斗倾向选出**有序**目标列表。
 *
 * 全场无存活敌人时返回空列表（调用方负责判负，不应继续出手）。
 */
export function selectTargets<T extends TargetableUnit>(req: TargetRequest<T>): TargetPlan<T> {
  const { actor, units, range, intent, rng } = req;
  const spec = RANGE_TABLE[range];

  // 出手瞬间快照：只取"当前存活"的敌人，按站位升序（站位=第二排序键）
  const foes = units
    .filter((u) => u.side !== actor.side && u.alive)
    .sort((a, b) => a.slot - b.slot);
  if (foes.length === 0) {
    return { targets: [], anchor: null, fallback: false, usedArea: spec.area };
  }

  // ① 候选池 + ② 池内排序
  const built = buildPool(spec.area, foes, actor, intent);
  const sorted = sortByIntent(built.pool, actor, intent);

  // column 的锚点取排序后的首格，保证"交叉表现"落在实际主目标上
  const anchor = spec.area === 'column' ? (sorted[0]!.slot ?? built.anchor) : built.anchor;

  // ③ 取前 C（C = 目标上限）；随机 N 先洗牌再无重复取样
  const cap = rangeTargetCap(range, sorted.length, req.randomCount ?? DEFAULT_RANDOM_COUNT);
  const ordered = spec.count === 'n' ? rng.shuffle(sorted) : sorted;
  const targets = ordered.slice(0, cap);

  return {
    targets,
    anchor,
    fallback: built.fallback,
    usedArea: built.usedArea,
  };
}
