/**
 * 伤害公式验算测试（node --test，零依赖运行）
 *   node --test tests/formula.test.ts
 *
 * 这组测试的意义：**把 GDD 文档里的数值表直接抄成断言**。
 * 文档写"实际伤害 ≈ 263"，代码就必须算出 263。
 * 以后谁改了公式导致偏离设计口径，这里会立刻报错。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeDamage,
  cultivationDiff,
  damageReduction,
  groupDecay,
  hitChance,
} from '../src/core/battle/formula.ts';
import { createRng } from '../src/core/battle/rng.ts';
import {
  GONGFA_REALMS,
  QUALITY_POWER,
  gongfaPower,
  realmMultiplier,
  toAtk,
  toDef,
  toHpMax,
} from '../src/data/gongfa-power.ts';
import type { AttackerView, DefenderView, SkillView } from '../src/core/battle/formula.ts';

/* ══════════════════ 一级属性 → 二级属性（GDD 03 §3.1.1） ══════════════════ */

test('属性换算：攻击力 = 臂力 × 3 + 装备攻击', () => {
  assert.equal(toAtk(80, 100), 340); // GDD 示例：臂力 80 → 340
  assert.equal(toAtk(80), 240);
});

test('属性换算：防御力 = 根骨 × 1.5 + 装备防御', () => {
  assert.equal(toDef(60), 90); // GDD 示例用到防御 90
});

test('属性换算：气血 = 根骨 × 20 + 装备气血 + 内功气血', () => {
  assert.equal(toHpMax(50, 100, 0), 1100);
});

/* ══════════════════ 减伤曲线（GDD 03 §3.1.3） ══════════════════ */

test('减伤修正：必须复现 GDD 的防御-减伤对照表', () => {
  // 表格：防御 0→0% ／ 50→25% ／ 100→40% ／ 150→50% ／ 300→66.7% ／ 600→80% ／ 900→85.7%
  const table: [def: number, expected: number][] = [
    [0, 0],
    [50, 0.25],
    [100, 0.4],
    [150, 0.5],
    [300, 2 / 3],
    [600, 0.8],
    [900, 6 / 7],
  ];
  for (const [def, expected] of table) {
    const actual = 1 - damageReduction(def); // 转成"减伤比例"
    assert.ok(
      Math.abs(actual - expected) < 0.001,
      `防御 ${def} 的减伤应为 ${(expected * 100).toFixed(1)}%，实际 ${(actual * 100).toFixed(1)}%`,
    );
  }
});

test('减伤修正：永远不会达到 100%（高防御也不能免疫）', () => {
  assert.ok(damageReduction(100000) > 0, '再高的防御也必须保留少量伤害');
  assert.ok(1 - damageReduction(100000) < 1);
});

/* ══════════════════ 群体递减（GDD 03 §3.1.4a） ══════════════════ */

test('群体递减：a_i = max(0.40, 1 − 0.15×(i−1))', () => {
  assert.equal(groupDecay(1), 1.0);
  assert.equal(groupDecay(2), 0.85);
  assert.equal(groupDecay(3), 0.7);
  assert.equal(groupDecay(4), 0.55);
  assert.equal(groupDecay(5), 0.4);
  assert.equal(groupDecay(9), 0.4); // 到达下限后不再下降
});

/* ══════════════════ 命中（GDD 03 §3.1.1：5%~95%） ══════════════════ */

test('命中率：钳制在 5% ~ 95% 区间', () => {
  assert.equal(hitChance(1.5, 0), 0.95); // 再高也封顶 95%
  assert.equal(hitChance(0.4, 0.6), 0.05); // 被打成负数也保底 5%
  assert.ok(Math.abs(hitChance(0.85, 0.1) - 0.75) < 1e-9);
});

/* ══════════════════ 功法威力（GDD 03 §3.1.4） ══════════════════ */

test('品质基础威力与境界倍率：必须与 GDD 数值表一致', () => {
  assert.deepEqual(QUALITY_POWER, { fan: 10, liang: 20, shang: 35, ji: 55, jue: 80 });
  assert.equal(GONGFA_REALMS.length, 10, '境界应为十档');
  assert.equal(realmMultiplier('chujiao'), 1.0);
  assert.equal(realmMultiplier('tianren'), 8.0);
  assert.equal(realmMultiplier('未知境界'), 1.0, '未知境界应兜底为 ×1.0 而不是崩溃');
});

test('功法威力（含 ×3）：必须复现 GDD 的示例表', () => {
  // 凡品·初窥门径 = 10 × 1.0 = 10 → ×3 = 30
  assert.equal(gongfaPower('fan', 'chujiao'), 30);
  // 凡品·天人合一 = 10 × 8.0 = 80 → ×3 = 240
  assert.equal(gongfaPower('fan', 'tianren'), 240);
  // 上品·登峰造极 = 35 × 3.3 = 115.5 → ×3 = 346.5
  assert.equal(gongfaPower('shang', 'dengfeng'), 346.5);
  // 绝世·初窥门径 = 80 → ×3 = 240（与"凡品练满"相等，这是设计意图）
  assert.equal(gongfaPower('jue', 'chujiao'), 240);
  // 绝世·天人合一 = 80 × 8.0 = 640 → ×3 = 1920
  assert.equal(gongfaPower('jue', 'tianren'), 1920);
});

test('设计意图：勤奋（凡品满）不输起跑（绝世未练）', () => {
  assert.equal(gongfaPower('fan', 'tianren'), gongfaPower('jue', 'chujiao'));
});

/* ══════════════════ 修为差距 ══════════════════ */

test('修为差距：合计为负时折半', () => {
  const strong = makeAttacker({ innerCultivation: 100, gongfaCultivation: 50 });
  const weak = makeDefender({ innerCultivation: 60, gongfaCultivation: 20 });
  assert.equal(cultivationDiff(strong, weak), 70); // 正数不折半

  const weak2 = makeAttacker({ innerCultivation: 10, gongfaCultivation: 0 });
  const strong2 = makeDefender({ innerCultivation: 50, gongfaCultivation: 0 });
  assert.equal(cultivationDiff(weak2, strong2), -20); // (−40) ÷ 2
});

/* ══════════════════ 定稿示例逐行验算（最关键的一组） ══════════════════ */

/**
 * 复现 GDD 08_balance/战斗数值.md §二「计算示例（Lv50 参考面板）」整张表：
 *   臂力 80 → 攻击力 = 80×3 + 装备 100 = 340
 *   修为差距 = 内力(+40) + 刀法(+10) = +50
 *   目标防御 90 → 减伤 = 1 − 90/240 = 0.625
 */
const LV50_ATTACKER = makeAttacker({
  atk: 340,
  innerCultivation: 40,
  gongfaCultivation: 10,
  crit: 0, // 关掉暴击，先验算基线
});
const LV50_DEFENDER = makeDefender({ def: 90 });

test('★ 定稿示例：凡品初窥门径 → 约 263', () => {
  const r = computeDamage({
    attacker: LV50_ATTACKER,
    defender: LV50_DEFENDER,
    skill: { power: gongfaPower('fan', 'chujiao'), multiplier: 1 }, // 30
    hitRoll: 0,
    critRoll: 1,
  });
  assert.equal(r.detail.base, 420); // 340 + 50 + 30
  assert.ok(Math.abs(r.detail.reduction - 0.625) < 1e-9);
  assert.equal(r.damage, 263); // GDD 写 ≈ 263
});

test('★ 定稿示例：其余四行功法也必须吻合', () => {
  const rows: [quality: Parameters<typeof gongfaPower>[0], realm: string, base: number, dmg: number][] = [
    ['fan', 'tianren', 630, 394], // 凡品天人合一
    ['shang', 'dengfeng', 736.5, 460], // 上品登峰造极
    ['ji', 'tianren', 1710, 1069], // 极品天人合一
    ['jue', 'tianren', 2310, 1444], // 绝世天人合一
  ];
  for (const [quality, realm, expectedBase, expectedDmg] of rows) {
    const r = computeDamage({
      attacker: LV50_ATTACKER,
      defender: LV50_DEFENDER,
      skill: { power: gongfaPower(quality, realm), multiplier: 1 },
      hitRoll: 0,
      critRoll: 1,
    });
    assert.equal(r.detail.base, expectedBase, `${quality}/${realm} 基础伤害`);
    assert.equal(r.damage, expectedDmg, `${quality}/${realm} 实际伤害`);
  }
});

/* ══════════════════ 各判定分支 ══════════════════ */

test('未命中：伤害为 0，且不产生吸血', () => {
  const r = computeDamage({
    attacker: makeAttacker({ hit: 0.5 }),
    defender: makeDefender({ dodge: 0.6 }), // 命中率被压到下限 5%
    skill: { power: 100, multiplier: 1 },
    hitRoll: 0.9, // 大于命中率 → 落空
    critRoll: 1,
  });
  assert.equal(r.hit, false);
  assert.equal(r.damage, 0);
  assert.equal(r.lifesteal, 0);
});

test('暴击：伤害按暴击倍率放大', () => {
  const base = computeDamage({
    attacker: makeAttacker({ atk: 300, crit: 0 }),
    defender: makeDefender({ def: 0 }),
    skill: { power: 0, multiplier: 1 },
    hitRoll: 0,
    critRoll: 1,
  });
  const crit = computeDamage({
    attacker: makeAttacker({ atk: 300, crit: 1, critDamage: 1.5 }),
    defender: makeDefender({ def: 0 }),
    skill: { power: 0, multiplier: 1 },
    hitRoll: 0,
    critRoll: 0, // 小于暴击率 1 → 必暴
  });
  assert.equal(crit.crit, true);
  assert.equal(crit.damage, Math.round(base.damage * 1.5));
});

test('吸血：按最终伤害计算', () => {
  const r = computeDamage({
    attacker: makeAttacker({ atk: 1000, lifesteal: 0.3 }),
    defender: makeDefender({ def: 0 }),
    skill: { power: 0, multiplier: 1 },
    hitRoll: 0,
    critRoll: 1,
  });
  assert.equal(r.lifesteal, Math.round(r.damage * 0.3));
});

test('命中至少造成 1 点伤害，不会出现"打了等于没打"', () => {
  const r = computeDamage({
    attacker: makeAttacker({ atk: 1 }),
    defender: makeDefender({ def: 100000 }),
    skill: { power: 0, multiplier: 1 },
    hitRoll: 0,
    critRoll: 1,
  });
  assert.equal(r.hit, true);
  assert.equal(r.damage, 1);
});

test('群体递减：乘在最终伤害上（第 3 个目标约为全额的 70%）', () => {
  const mk = (decay: number) =>
    computeDamage({
      attacker: makeAttacker({ atk: 1000 }),
      defender: makeDefender({ def: 0 }),
      skill: { power: 0, multiplier: 1 },
      groupDecay: decay,
      hitRoll: 0,
      critRoll: 1,
    }).damage;
  assert.equal(mk(1.0), 1000);
  assert.equal(mk(0.85), 850);
  assert.equal(mk(0.7), 700);
});

/* ══════════════════ 可播种随机数（铁律 5） ══════════════════ */

test('可播种随机：同种子必然产出同一串数', () => {
  const a = createRng('battle-001');
  const b = createRng('battle-001');
  const seqA = Array.from({ length: 50 }, () => a.next());
  const seqB = Array.from({ length: 50 }, () => b.next());
  assert.deepEqual(seqA, seqB);
});

test('可播种随机：不同种子产出不同的串', () => {
  const a = createRng('battle-001');
  const b = createRng('battle-002');
  const seqA = Array.from({ length: 50 }, () => a.next());
  const seqB = Array.from({ length: 50 }, () => b.next());
  assert.notDeepEqual(seqA, seqB);
});

test('可播种随机：取值落在合法区间内', () => {
  const rng = createRng(12345);
  for (let i = 0; i < 2000; i++) {
    const v = rng.next();
    assert.ok(v >= 0 && v < 1, `next() 越界: ${v}`);
    const n = rng.int(3, 7);
    assert.ok(n >= 3 && n <= 7 && Number.isInteger(n), `int 越界: ${n}`);
  }
});

test('可播种随机：概率分布大致正确（10000 次 30% ≈ 3000）', () => {
  const rng = createRng('distribution');
  let hits = 0;
  for (let i = 0; i < 10000; i++) if (rng.chance(0.3)) hits++;
  assert.ok(hits > 2700 && hits < 3300, `30% 概率实测为 ${hits / 100}%`);
});

test('可播种随机：洗牌不丢元素、不改原数组', () => {
  const rng = createRng('shuffle');
  const src = [1, 2, 3, 4, 5, 6, 7, 8];
  const out = rng.shuffle(src);
  assert.deepEqual([...out].sort((x, y) => x - y), src, '洗牌后元素集合应一致');
  assert.deepEqual(src, [1, 2, 3, 4, 5, 6, 7, 8], '原数组不应被修改');
});

/* ══════════════════ 测试辅助 ══════════════════ */

function makeAttacker(over: Partial<AttackerView> = {}): AttackerView {
  return {
    atk: 100,
    crit: 0,
    critDamage: 1.5,
    hit: 0.9,
    lifesteal: 0,
    innerCultivation: 0,
    gongfaCultivation: 0,
    bonusDamage: 0,
    ...over,
  };
}

function makeDefender(over: Partial<DefenderView> = {}): DefenderView {
  return {
    def: 0,
    dodge: 0,
    innerCultivation: 0,
    gongfaCultivation: 0,
    damageTaken: 0,
    ...over,
  };
}

/** 让 SkillView 类型在辅助函数里也被用到，避免"未使用"噪音 */
const _skillTypeCheck: SkillView = { power: 0, multiplier: 1 };
void _skillTypeCheck;
