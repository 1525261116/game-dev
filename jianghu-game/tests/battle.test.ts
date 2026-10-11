/**
 * 阵法与状态系统测试（对齐烟雨江湖的落地验证）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  partyScale,
  maxPartySize,
  ROSTER_TIERS,
  rowOf,
  colOf,
  sameColumn,
  ROW_SLOTS,
  COL_SLOTS,
  CORNER_SLOTS,
} from '../src/core/battle/types.ts';
import type { Placement } from '../src/core/battle/types.ts';
import {
  resolveFormation,
  evaluateRequirement,
  describeBonus,
  PARTIAL_DISCOUNT,
} from '../src/core/battle/formation.ts';
import { FORMATIONS, FORMATIONS_BY_ID, FORMATION_STATS } from '../src/data/formations.ts';
import { STATUS_DEFS, STATUS_BY_ID, STATUS_STATS } from '../src/data/status.ts';

/** 用 3×3 字符画快速构造站位：'#' 有人，'.' 空 */
function grid(rows: string[]): Placement {
  const flat: (string | null)[] = [];
  rows.forEach((r, ri) => {
    [...r].forEach((ch, ci) => flat.push(ch === '#' ? `u${ri}${ci}` : null));
  });
  assert.equal(flat.length, 9);
  return flat;
}

/* ------------------------------------------------------------ 九宫格基础 */

test('九宫格：行列映射与编号一致', () => {
  assert.deepEqual(ROW_SLOTS.front, [0, 1, 2]);
  assert.deepEqual(ROW_SLOTS.mid, [3, 4, 5]);
  assert.deepEqual(ROW_SLOTS.back, [6, 7, 8]);
  assert.deepEqual(COL_SLOTS.left, [0, 3, 6]);
  assert.deepEqual(COL_SLOTS.center, [1, 4, 7]);
  assert.deepEqual(COL_SLOTS.right, [2, 5, 8]);
  assert.equal(rowOf(0), 'front');
  assert.equal(rowOf(4), 'mid');
  assert.equal(rowOf(8), 'back');
  assert.equal(colOf(0), 'left');
  assert.equal(colOf(5), 'right');
});

test('九宫格：同列单位用于列连击与集火', () => {
  assert.deepEqual(sameColumn(1), [1, 4, 7]);
  assert.deepEqual(sameColumn(8), [2, 5, 8]);
});

/* ------------------------------------------------------------ 编队系数 */

test('编队系数：以 4 人为基准，保证 TTK 恒定', () => {
  assert.equal(partyScale(3), 0.75);
  assert.equal(partyScale(4), 1);
  assert.equal(partyScale(5), 1.25);
  assert.equal(partyScale(6), 1.5);
});

test('编队系数：非法人数抛错（不静默）', () => {
  assert.throws(() => partyScale(0), /至少/);
});

test('上阵人数成长：3 → 4 → 5 → 6 的解锁条件正确', () => {
  assert.equal(ROSTER_TIERS.length, 4);
  assert.equal(maxPartySize({ reputation: 0, sectLevel: 0 }), 3);
  assert.equal(maxPartySize({ reputation: 500, sectLevel: 0 }), 4);
  assert.equal(maxPartySize({ reputation: 5000, sectLevel: 2 }), 4);
  assert.equal(maxPartySize({ reputation: 5000, sectLevel: 3 }), 5);
  assert.equal(maxPartySize({ reputation: 5000, sectLevel: 3, isSectWar: true }), 6);
  assert.equal(maxPartySize({ reputation: 0, sectLevel: 3, isSectWar: true }), 6);
});

/* ------------------------------------------------------------ 阵法表 */

test('阵法：恰好 12 个，且 ID 唯一', () => {
  assert.equal(FORMATIONS.length, 12);
  assert.equal(Object.keys(FORMATIONS_BY_ID).length, 12);
  assert.equal(FORMATION_STATS.total, 12);
});

test('阵法：品质分布（凡3/良3/上3/极2/绝1 = 12）', () => {
  assert.deepEqual(FORMATION_STATS.byQuality, { fan: 3, liang: 3, shang: 3, ji: 2, jue: 1 });
});

test('阵法：至少 8 个对站位有要求（体现"阵法约束站位"）', () => {
  assert.ok(FORMATION_STATS.withRequirement >= 8, `实际 ${FORMATION_STATS.withRequirement} 个`);
});

test('阵法：每级加成单调递增（1 级 ≤ 2 级 ≤ … ≤ 5 级）', () => {
  for (const f of FORMATIONS) {
    const key = (b: (typeof f.bonuses)[number]): number => {
      const mods = Object.values(b.mods ?? {}) as number[];
      const sp = Object.values(b.special ?? {}).filter((v): v is number => typeof v === 'number');
      // 负向效果（如 damageTaken 为负）取绝对值参与单调性判断
      return [...mods, ...sp].reduce((s, v) => s + Math.abs(v), 0);
    };
    for (let i = 1; i < 5; i++) {
      assert.ok(
        key(f.bonuses[i]!) >= key(f.bonuses[i - 1]!) - 1e-9,
        `${f.name} 第 ${i + 1} 级加成低于第 ${i} 级`,
      );
    }
  }
});

/* ------------------------------------------------------------ 阵法站位校验 */

test('一字长蛇阵：前排满员 → 全额；前排 2 人 → 减半；前排 1 人 → 失效', () => {
  const f = FORMATIONS_BY_ID['FM_changshe']!;
  const full = grid(['###', '...', '...']);
  const two = grid(['##.', '...', '...']);
  const one = grid(['#..', '...', '...']);

  assert.equal(resolveFormation(f, full, 5).result, 'ok');
  assert.equal(resolveFormation(f, two, 5).result, 'partial');
  assert.equal(resolveFormation(f, one, 5).result, 'fail');

  const okBonus = resolveFormation(f, full, 5).effective.mods!.def!;
  const partialBonus = resolveFormation(f, two, 5).effective.mods!.def!;
  assert.equal(okBonus, 0.24);
  assert.ok(Math.abs(partialBonus - 0.24 * PARTIAL_DISCOUNT) < 1e-9);
  assert.deepEqual(resolveFormation(f, one, 5).effective, {});
});

test('四象阵：四角站位 → 全额；三角 → 减半；不足 → 失效', () => {
  const f = FORMATIONS_BY_ID['FM_sixiang']!;
  assert.equal(evaluateRequirement(f.requirement, grid(['#.#', '...', '#.#'])), 'ok');
  assert.equal(evaluateRequirement(f.requirement, grid(['#.#', '...', '#..'])), 'partial');
  assert.equal(evaluateRequirement(f.requirement, grid(['#..', '#..', '...'])), 'fail');
});

test('五行阵：满编 5 人 → 全额；4 人 → 减半；3 人 → 失效', () => {
  const f = FORMATIONS_BY_ID['FM_wuxing']!;
  assert.equal(evaluateRequirement(f.requirement, grid(['###', '##.', '...'])), 'ok');
  assert.equal(evaluateRequirement(f.requirement, grid(['###', '#..', '...'])), 'partial');
  assert.equal(evaluateRequirement(f.requirement, grid(['##.', '#..', '...'])), 'fail');
});

test('三才阵：前中后各一人 → 全额；只占两排 → 减半', () => {
  const f = FORMATIONS_BY_ID['FM_sancai']!;
  assert.equal(evaluateRequirement(f.requirement, grid(['#..', '#..', '#..'])), 'ok');
  assert.equal(evaluateRequirement(f.requirement, grid(['#..', '#..', '...'])), 'partial');
  assert.equal(evaluateRequirement(f.requirement, grid(['#..', '...', '...'])), 'fail');
});

test('锋矢阵：单列 3 人 → 全额（与列连击协同）', () => {
  const f = FORMATIONS_BY_ID['FM_fengshi']!;
  assert.equal(evaluateRequirement(f.requirement, grid(['#..', '#..', '#..'])), 'ok');
  assert.equal(resolveFormation(f, grid(['#..', '#..', '#..']), 5).effective.special!.columnDamage, 0.45);
});

test('天罡北斗阵：前排 1 人 + 后排 3 人 → 全额', () => {
  const f = FORMATIONS_BY_ID['FM_tiangang']!;
  assert.equal(evaluateRequirement(f.requirement, grid(['#..', '...', '###'])), 'ok');
  assert.equal(evaluateRequirement(f.requirement, grid(['##.', '...', '###'])), 'partial');
  assert.equal(evaluateRequirement(f.requirement, grid(['##.', '...', '##.'])), 'fail');
});

test('混元阵/幽月阵/守境阵：任意站位均生效', () => {
  for (const id of ['FM_hunyuan', 'FM_youyue', 'FM_shoujing']) {
    const f = FORMATIONS_BY_ID[id]!;
    assert.equal(resolveFormation(f, grid(['#..', '...', '...']), 1).result, 'ok', id);
  }
});

test('守境阵：仅 5 级才解锁"免疫首次控制"', () => {
  const f = FORMATIONS_BY_ID['FM_shoujing']!;
  const p = grid(['#..', '...', '...']);
  assert.equal(resolveFormation(f, p, 4).effective.special?.immuneFirstControl, false);
  assert.equal(resolveFormation(f, p, 5).effective.special?.immuneFirstControl, true);
});

test('阵法等级：越界自动钳制到 1~5', () => {
  const f = FORMATIONS_BY_ID['FM_sancai']!;
  const p = grid(['#..', '#..', '#..']);
  assert.equal(resolveFormation(f, p, 0).level, 1);
  assert.equal(resolveFormation(f, p, 99).level, 5);
});

test('阵法文案：能把加成渲染成人话（UI 用）', () => {
  const f = FORMATIONS_BY_ID['FM_tiangang']!;
  const text = describeBonus(resolveFormation(f, grid(['#..', '...', '###']), 5).effective);
  assert.ok(text.includes('受到伤害'), text);
  assert.ok(text.includes('反弹'), text);
});

/* ------------------------------------------------------------ 状态系统 */

test('状态：共 22 种，分控制4 / 减益9 / 增益9', () => {
  assert.equal(STATUS_DEFS.length, 22);
  assert.deepEqual(STATUS_STATS.byKind, { control: 4, debuff: 9, buff: 9 });
});

test('状态：ID 唯一且可查', () => {
  for (const s of STATUS_DEFS) {
    assert.equal(STATUS_BY_ID[s.id]?.name, s.name);
  }
});

test('状态：可叠加的只有 中毒(3层) / 流血(5层)', () => {
  assert.deepEqual(STATUS_STATS.stackable.sort(), ['bleed', 'poison']);
  for (const s of STATUS_DEFS) {
    if (s.maxStacks > 1) assert.ok(['poison', 'bleed'].includes(s.id), `${s.id} 不应叠加`);
  }
});

test('状态：控制类不可被普通驱散（眩晕/击退），其余可驱散', () => {
  assert.equal(STATUS_BY_ID.stun.dispellable, false);
  assert.equal(STATUS_BY_ID.knockback.dispellable, false);
  assert.equal(STATUS_BY_ID.seal.dispellable, true);
  assert.equal(STATUS_BY_ID.root.dispellable, true);
});

test('状态：铁壁免疫击退与破防；守境阵免疫眩晕', () => {
  assert.equal(STATUS_BY_ID.knockback.blockedBy, 'ironWall');
  assert.equal(STATUS_BY_ID.defDown.blockedBy, 'ironWall');
  assert.equal(STATUS_BY_ID.stun.blockedBy, 'immuneFirstControl');
});

test('状态：持续伤害的数值与基准正确', () => {
  assert.deepEqual(STATUS_BY_ID.poison.dot, { percent: 0.05, basis: 'maxHp' });
  assert.deepEqual(STATUS_BY_ID.bleed.dot, { percent: 0.03, basis: 'currentHp' });
  assert.deepEqual(STATUS_BY_ID.burn.dot, { percent: 0.04, basis: 'maxHp' });
  // 回春用负 dot 表示治疗
  assert.equal(STATUS_BY_ID.regen.dot!.percent, -0.04);
});

test('状态：定身把闪避压到 0（-100%）', () => {
  assert.equal(STATUS_BY_ID.root.mods!.dodge, -1);
});

test('状态：属性修正在合法区间内（不出现离谱数值）', () => {
  for (const s of STATUS_DEFS) {
    for (const [k, v] of Object.entries(s.mods ?? {})) {
      assert.ok(Math.abs(v as number) <= 1.5, `${s.id}.${k} = ${v} 过大`);
    }
  }
});
