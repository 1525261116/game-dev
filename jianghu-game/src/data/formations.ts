/**
 * 阵法表（12 个）——对齐《烟雨江湖》的阵法系统。
 * 数值见 GDD 02_系统设计.md §2.1-8）；站位校验逻辑见 ./formation.ts。
 */
import type { FormationDef, FormationBonus } from '../core/battle/types.ts';

/** 便捷构造：把单级加成按等级线性放大（1 级 → 5 级） */
function scale(b: FormationBonus, k: number): FormationBonus {
  const mods = b.mods
    ? Object.fromEntries(Object.entries(b.mods).map(([key, v]) => [key, Math.round(v * k * 1000) / 1000]))
    : undefined;
  // 注意：special 的值可能是 boolean（例如"免疫首次控制"），而 boolean 不能参与乘法，
  // 必须与下面 tiers() 里的写法保持一致，先判断类型再计算。
  const special = b.special
    ? Object.fromEntries(
        Object.entries(b.special).map(([key, v]) => [
          key,
          typeof v === 'boolean' ? v : Math.round(v * k * 1000) / 1000,
        ]),
      )
    : undefined;
  return { ...(mods ? { mods } : {}), ...(special ? { special } : {}) } as FormationBonus;
}

/** 用 1 级模板 × 等级倍率生成 1~5 级（倍率 1 / 2 / 3 / 4 / 5 的等分：0.33/0.67/1/1.33/1.67 归一） */
function tiers(base: FormationBonus, top: FormationBonus): FormationDef['bonuses'] {
  // 1 级 = base，5 级 = top，中间线性
  const at = (k: number): FormationBonus => {
    const mods: Record<string, number> = {};
    const keys = new Set([...Object.keys(base.mods ?? {}), ...Object.keys(top.mods ?? {})]);
    for (const key of keys) {
      const a = (base.mods as Record<string, number> | undefined)?.[key] ?? 0;
      const b = (top.mods as Record<string, number> | undefined)?.[key] ?? 0;
      mods[key] = Math.round((a + (b - a) * k) * 1000) / 1000;
    }
    const special: Record<string, number | boolean> = {};
    const sKeys = new Set([...Object.keys(base.special ?? {}), ...Object.keys(top.special ?? {})]);
    for (const key of sKeys) {
      const a = (base.special as Record<string, number | boolean> | undefined)?.[key];
      const b = (top.special as Record<string, number | boolean> | undefined)?.[key];
      if (typeof a === 'boolean' || typeof b === 'boolean') {
        special[key] = k >= 1 ? Boolean(b) : Boolean(a);
      } else {
        special[key] = Math.round(((a ?? 0) + ((b ?? 0) - (a ?? 0)) * k) * 1000) / 1000;
      }
    }
    return {
      ...(Object.keys(mods).length ? { mods } : {}),
      ...(Object.keys(special).length ? { special } : {}),
    } as FormationBonus;
  };
  return [at(0), at(0.25), at(0.5), at(0.75), at(1)];
}

export const FORMATIONS: readonly FormationDef[] = [
  {
    id: 'FM_changshe',
    name: '一字长蛇阵',
    quality: 'fan',
    requirement: { kind: 'frontFull' },
    bonuses: tiers({ mods: { def: 0.08 } }, { mods: { def: 0.24 } }),
    source: '初始',
    desc: '前排 3 格满员，以阵如长蛇，守御绵密',
  },
  {
    id: 'FM_erlong',
    name: '二龙出水阵',
    quality: 'fan',
    requirement: { kind: 'singleColumn', count: 2 },
    bonuses: tiers({ mods: { atk: 0.06 } }, { mods: { atk: 0.18 } }),
    source: '中原·双王镇',
    desc: '两列各 2 人，双龙出水，攻势锋锐',
  },
  {
    id: 'FM_sancai',
    name: '三才阵',
    quality: 'fan',
    requirement: { kind: 'allThreeRows' },
    bonuses: tiers(
      { mods: { atk: 0.04, def: 0.04 } },
      { mods: { atk: 0.12, def: 0.12 } },
    ),
    source: '初始',
    desc: '前中后各据一人，天地人三才相济',
  },
  {
    id: 'FM_sixiang',
    name: '四象阵',
    quality: 'liang',
    requirement: { kind: 'corners' },
    bonuses: tiers({ mods: { lifesteal: 0.06 } }, { mods: { lifesteal: 0.18 } }),
    source: '江南·剑冢',
    desc: '四人分据四角，四象轮转，饮血自养',
  },
  {
    id: 'FM_wuxing',
    name: '五行阵',
    quality: 'liang',
    requirement: { kind: 'minMembers', count: 5 },
    bonuses: tiers({ mods: { innerRegen: 0.15 } }, { mods: { innerRegen: 0.45 } }),
    source: '巴蜀·青城后山',
    desc: '满编五人，五行相生，内力生生不息',
  },
  {
    id: 'FM_tiangang',
    name: '天罡北斗阵',
    quality: 'shang',
    requirement: { kind: 'frontOneBackThree' },
    bonuses: tiers(
      { mods: { damageTaken: -0.1 }, special: { reflect: 0.05 } },
      { mods: { damageTaken: -0.3 }, special: { reflect: 0.15 } },
    ),
    source: '六扇门兑换',
    desc: '一人当关、三人列宿，北斗护身，反震来敌',
  },
  {
    id: 'FM_yanxing',
    name: '雁行阵',
    quality: 'shang',
    requirement: { kind: 'rowFull', row: 'mid' },
    bonuses: tiers(
      { special: { backRowDamage: 0.1, frontRowTaken: -0.08 } },
      { special: { backRowDamage: 0.3, frontRowTaken: -0.24 } },
    ),
    source: '江湖散人',
    desc: '中排充塞，雁行斜列，后排劲发、前排少受',
  },
  {
    id: 'FM_hunyuan',
    name: '混元阵',
    quality: 'shang',
    requirement: { kind: 'any' },
    bonuses: tiers({ special: { comboPower: 0.1 } }, { special: { comboPower: 0.3 } }),
    source: '门派藏经阁',
    desc: '不拘站位，混元一气，连招威力大涨',
  },
  {
    id: 'FM_guishe',
    name: '龟蛇阵',
    quality: 'liang',
    requirement: { kind: 'rowFull', row: 'front' },
    bonuses: tiers(
      { mods: { hpMax: 0.1, spd: -0.05 } },
      { mods: { hpMax: 0.3, spd: -0.05 } },
    ),
    source: '药王谷',
    desc: '前中皆满，龟蛇盘结，气血浑厚而身法略滞',
  },
  {
    id: 'FM_fengshi',
    name: '锋矢阵',
    quality: 'ji',
    requirement: { kind: 'singleColumn', count: 3 },
    bonuses: tiers({ special: { columnDamage: 0.15 } }, { special: { columnDamage: 0.45 } }),
    source: '西北·塞北',
    desc: '单列三人成矢，与列连击相叠，穿阵破敌',
  },
  {
    id: 'FM_youyue',
    name: '幽月阵',
    quality: 'ji',
    requirement: { kind: 'any' },
    bonuses: tiers(
      { mods: { crit: 0.05, hit: -0.03 } },
      { mods: { crit: 0.15, hit: -0.03 } },
    ),
    source: '幽月教（邪线）',
    desc: '月色隐曜，出手刁钻，暴烈而易失准',
  },
  {
    id: 'FM_shoujing',
    name: '守境阵',
    quality: 'jue',
    requirement: { kind: 'any' },
    bonuses: tiers(
      { mods: { atk: 0.06, def: 0.06 }, special: { immuneFirstControl: false } },
      { mods: { atk: 0.18, def: 0.18 }, special: { immuneFirstControl: true } },
    ),
    source: '秘境守护者（终局）',
    desc: '守境司秘传，五行归位，首次受制可免',
  },
];

export const FORMATIONS_BY_ID: Record<string, FormationDef> = Object.fromEntries(
  FORMATIONS.map((f) => [f.id, f]),
);

export function getFormation(id: string): FormationDef {
  const f = FORMATIONS_BY_ID[id];
  if (!f) throw new Error(`未定义的阵法: ${id}`);
  return f;
}

export const FORMATION_STATS = {
  total: FORMATIONS.length,
  byQuality: FORMATIONS.reduce<Record<string, number>>((acc, f) => {
    acc[f.quality] = (acc[f.quality] ?? 0) + 1;
    return acc;
  }, {}),
  /** 要求特定站位的阵法数量（体现"阵法约束站位"的设计） */
  withRequirement: FORMATIONS.filter((f) => f.requirement.kind !== 'any').length,
} as const;

export { scale as __scaleFormationBonus };
