/**
 * 阵法站位校验与加成计算（纯逻辑）。
 * 规则：站位完全符合 → 全额加成；部分符合 → 加成减半（partial）；完全不符 → 失效（fail）。
 */
import {
  COL_SLOTS,
  CORNER_SLOTS,
  ROW_SLOTS,
  countOccupied,
} from './types.ts';
import type {
  FormationDef,
  FormationRequirement,
  FormationBonus,
  Placement,
  RequirementResult,
  SlotIndex,
} from './types.ts';

function occupiedSet(p: Placement): Set<SlotIndex> {
  const s = new Set<SlotIndex>();
  p.forEach((v, i) => {
    if (v !== null && v !== undefined) s.add(i as SlotIndex);
  });
  return s;
}

function occupiedIn(p: Placement, slots: readonly SlotIndex[]): number {
  return slots.reduce((n, s) => n + (p[s] ? 1 : 0), 0);
}

/** 最高可达成的同类要求（用于 partial 判定） */
export function evaluateRequirement(req: FormationRequirement, p: Placement): RequirementResult {
  const occ = occupiedSet(p);
  const total = countOccupied(p);

  switch (req.kind) {
    case 'any':
      return 'ok';

    case 'minMembers':
      return total >= req.count ? 'ok' : total >= req.count - 1 ? 'partial' : 'fail';

    case 'frontFull': {
      const n = occupiedIn(p, ROW_SLOTS.front);
      return n === 3 ? 'ok' : n === 2 ? 'partial' : 'fail';
    }

    case 'rowFull': {
      const n = occupiedIn(p, ROW_SLOTS[req.row]);
      return n === 3 ? 'ok' : n === 2 ? 'partial' : 'fail';
    }

    case 'corners': {
      const n = CORNER_SLOTS.reduce((acc, s) => acc + (occ.has(s) ? 1 : 0), 0);
      return n >= 4 ? 'ok' : n === 3 ? 'partial' : 'fail';
    }

    case 'allThreeRows': {
      const rows = (['front', 'mid', 'back'] as const).filter((r) => occupiedIn(p, ROW_SLOTS[r]) > 0);
      return rows.length === 3 ? 'ok' : rows.length === 2 ? 'partial' : 'fail';
    }

    case 'singleColumn': {
      let best = 0;
      for (const col of Object.values(COL_SLOTS)) {
        best = Math.max(best, occupiedIn(p, col));
      }
      return best >= req.count ? 'ok' : best >= req.count - 1 ? 'partial' : 'fail';
    }

    case 'frontOneBackThree': {
      const front = occupiedIn(p, ROW_SLOTS.front);
      const back = occupiedIn(p, ROW_SLOTS.back);
      if (front === 1 && back >= 3) return 'ok';
      if (front <= 2 && back >= 3) return 'partial';
      return 'fail';
    }

    default: {
      const never: never = req;
      throw new Error(`未知的阵法要求: ${JSON.stringify(never)}`);
    }
  }
}

/** 部分符合时的加成折扣 */
export const PARTIAL_DISCOUNT = 0.5;

function applyDiscount(bonus: FormationBonus, k: number): FormationBonus {
  if (k === 1) return bonus;
  const out: FormationBonus = {};
  if (bonus.mods) {
    out.mods = Object.fromEntries(
      Object.entries(bonus.mods).map(([key, v]) => [key, (v as number) * k]),
    ) as FormationBonus['mods'];
  }
  if (bonus.special) {
    out.special = Object.fromEntries(
      Object.entries(bonus.special).map(([key, v]) => [
        key,
        typeof v === 'boolean' ? v : v * k,
      ]),
    ) as FormationBonus['special'];
  }
  return out;
}

export interface FormationResolution {
  formationId: string;
  level: number;
  result: RequirementResult;
  /** 实际生效的加成（已按 result 折扣） */
  effective: FormationBonus;
}

/** 计算某阵法在某站位下、某等级的最终加成 */
export function resolveFormation(
  def: FormationDef,
  placement: Placement,
  level: number,
): FormationResolution {
  const lv = Math.max(1, Math.min(5, Math.round(level)));
  const result = evaluateRequirement(def.requirement, placement);
  const base = def.bonuses[lv - 1]!;
  const effective =
    result === 'ok' ? base : result === 'partial' ? applyDiscount(base, PARTIAL_DISCOUNT) : {};
  return { formationId: def.id, level: lv, result, effective };
}

/** 把阵法加成转成人类可读的文案（用于 UI） */
export function describeBonus(b: FormationBonus): string {
  const parts: string[] = [];
  const label: Record<string, string> = {
    atk: '攻击',
    def: '防御',
    hpMax: '气血上限',
    spd: '速度',
    crit: '暴击率',
    dodge: '闪避',
    hit: '命中',
    innerRegen: '内力回复',
    damageTaken: '受到伤害',
    damageDealt: '造成伤害',
    lifesteal: '吸血',
  };
  for (const [k, v] of Object.entries(b.mods ?? {})) {
    const pct = Math.round((v as number) * 1000) / 10;
    parts.push(`${label[k] ?? k} ${pct >= 0 ? '+' : ''}${pct}%`);
  }
  const sp = b.special ?? {};
  if (sp.comboPower) parts.push(`连招威力 +${Math.round(sp.comboPower * 100)}%`);
  if (sp.reflect) parts.push(`受击反弹 ${Math.round(sp.reflect * 100)}%`);
  if (sp.columnDamage) parts.push(`该列伤害 +${Math.round(sp.columnDamage * 100)}%`);
  if (sp.backRowDamage) parts.push(`后排输出 +${Math.round(sp.backRowDamage * 100)}%`);
  if (sp.frontRowTaken) parts.push(`前排承伤 ${Math.round(sp.frontRowTaken * 100)}%`);
  if (sp.immuneFirstControl) parts.push('免疫首次控制');
  return parts.join('，');
}

/** 校验站位是否满足（供 UI 实时提示） */
export function checkPlacement(def: FormationDef, placement: Placement): RequirementResult {
  return evaluateRequirement(def.requirement, placement);
}
