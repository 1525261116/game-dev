/**
 * 内力系统测试（node --test，零依赖运行）
 *   node --test tests/inner.test.ts
 *
 * 口径：GDD 02 §2.1.1-4「内力系统（无冷却）」+ GDD 03「内力消耗与回复」
 *       · 套路释放消耗内力：凡 10 / 良 20 / 上 35 / 极 55 / 绝 80
 *       · 每回合回复：内息 ÷ 10 + 内功加成
 *       · 内力不足 → 自动改用普攻（攻击力 × 0.5，无消耗）
 *       · 封穴 → 只能普攻，内力回复 −50%
 *
 * 附带的回归：**回春（regen）绝不能再造成伤害**（旧实现把它当成了 1 点伤害）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { simulateBattle } from '../src/core/battle/simulate.ts';
import { innerCost, innerRegenPerRound, toInner } from '../src/data/gongfa-power.ts';
import { makeSkill, makeStats, makeUnit } from './fixtures.ts';
import type { BattleLog } from '../src/core/battle/simulate.ts';
import type { SlotIndex } from '../src/core/battle/types.ts';
import type { Quality } from '../src/data/gongfa_visual.ts';

/* ══════════════════ 工具 ══════════════════ */

function actsOf(log: BattleLog) {
  return log.events.filter((e) => e.type === 'act');
}

/** 取某个单位每次出手打出的伤害（按出手顺序分组，排除对手夹在中间的伤害） */
function damageBy(log: BattleLog, actorId: string): number[][] {
  const out: number[][] = [];
  let bucket: number[] | null = null;
  for (const e of log.events) {
    if (e.type === 'act') {
      bucket = e.actorId === actorId ? [] : null;
      if (bucket) out.push(bucket);
    } else if (e.type === 'damage' && bucket) {
      bucket.push(e.value);
    }
  }
  return out;
}

/* ══════════════════ 工具 ══════════════════ */

function actLog(log: BattleLog): string {
  return actsOf(log)
    .map((a) => `${a.actorId}:${a.skillName}${a.basic ? '(普攻)' : ''} -${a.cost}=${a.innerAfter}`)
    .join(' | ');
}

/* ══════════════════ ① 数值口径 ══════════════════ */

test('内力消耗按品质：凡 10 / 良 20 / 上 35 / 极 55 / 绝 80（GDD 02 §4）', () => {
  const expected: Record<Quality, number> = { fan: 10, liang: 20, shang: 35, ji: 55, jue: 80 };
  for (const [q, v] of Object.entries(expected)) {
    assert.equal(innerCost(q as Quality), v, `${q} 的内力消耗应为 ${v}`);
  }
});

test('内力上限与回复由内息派生：上限 = 内息 × 10，回复 = 内息 ÷ 10', () => {
  assert.equal(toInner(40), 400);
  assert.equal(toInner(40, 100), 500, '内功加成应叠加在上限上');
  assert.equal(innerRegenPerRound(40), 4);
  assert.equal(innerRegenPerRound(45, 2), 6.5);
});

/* ══════════════════ ② 消耗 → 不足 → 普攻 ══════════════════ */

test('★ 内力够就放套路：扣掉对应品质的内力消耗', () => {
  const hero = makeUnit({
    id: 'hero',
    slot: 0,
    stats: makeStats({ innerMax: 100, innerRegen: 0 }),
    skills: [makeSkill({ quality: 'liang', innerCost: 20, power: 0 })],
  });
  const log = simulateBattle({
    allies: [hero],
    enemies: [makeUnit({ id: 'foe', slot: 0, side: 'enemy', stats: makeStats({ atk: 1, hpMax: 1e6 }) })],
    seed: 'inner-spend',
    maxRounds: 1,
  });
  const act = actsOf(log)[0]!;
  assert.equal(act.basic, false);
  assert.equal(act.cost, 20);
  assert.equal(act.innerAfter, 80);
  assert.equal(log.finalInner['hero'], 80, '没有回复时余量不变');
});

test('★ 内力不足 → 自动改用普攻：无消耗，且伤害 = 攻击力 × 0.5', () => {
  // 内息 10 → 上限 100、每回合回 1；招式消耗 100 → 只能放一次
  const hero = makeUnit({
    id: 'hero',
    slot: 0,
    stats: makeStats({ atk: 400, crit: 0, hit: 1, innerMax: 10, innerRegen: 0 }),
    skills: [makeSkill({ innerCost: 10, power: 0, multiplier: 1 })],
  });
  const foe = makeUnit({
    id: 'foe',
    slot: 0,
    side: 'enemy',
    stats: makeStats({ atk: 0, def: 0, hpMax: 1e6 }),
  });

  const log = simulateBattle({ allies: [hero], enemies: [foe], seed: 'inner-starve', maxRounds: 3 });
  const acts = actsOf(log).filter((a) => a.actorId === 'hero');
  assert.ok(acts.length >= 3, `应至少出手 3 次，实际 ${acts.length}：${actLog(log)}`);

  assert.equal(acts[0]!.basic, false, '第 1 回合内力充足，应放套路');
  assert.equal(acts[0]!.cost, 10);
  assert.equal(acts[1]!.basic, true, '第 2 回合内力为 0，应自动普攻');
  assert.equal(acts[1]!.cost, 0, '普攻不消耗内力');
  assert.equal(acts[1]!.skillName, '普攻');

  // 伤害比对：普攻 = 攻击力 × 0.5（修为差为 0、功法威力为 0，所以只剩攻击力这一项）
  const dmg = damageBy(log, 'hero');
  assert.ok(dmg.length >= 2, '至少要有两次命中伤害');
  const first = dmg[0]![0]!;
  const second = dmg[1]![0]!;
  assert.ok(
    Math.abs(second / first - 0.5) < 0.02,
    `普攻伤害应为套路的 0.5 倍（${first} → ${second}）`,
  );
});

/* ══════════════════ ③ 回合回复 ══════════════════ */

test('★ 每回合回复：内息 ÷ 10，且不超过内力上限', () => {
  const hero = makeUnit({
    id: 'hero',
    slot: 0,
    stats: makeStats({ innerMax: 14, innerRegen: 5 }),
    skills: [makeSkill({ innerCost: 10, power: 0 })],
  });
  const log = simulateBattle({
    allies: [hero],
    enemies: [makeUnit({ id: 'foe', slot: 0, side: 'enemy', stats: makeStats({ atk: 1, hpMax: 1e6 }) })],
    seed: 'inner-regen',
    maxRounds: 2,
  });
  const acts = actsOf(log).filter((a) => a.actorId === 'hero');
  // R1：14 − 10 = 4 → 回合末 +5 = 9
  assert.equal(acts[0]!.innerAfter, 4);
  // R2：9 < 10 → 普攻（0 消耗）→ 回合末 +5 封顶 14
  assert.equal(acts[1]!.basic, true);
  assert.equal(log.finalInner['hero'], 14, '内力不得超过上限');
});

test('★ 阵法的内力回复加成真的生效（innerRegen 终于被消费了）', () => {
  const mk = (id: string, slot: SlotIndex) =>
    makeUnit({
      id,
      slot,
      stats: makeStats({ innerMax: 1000, innerRegen: 4 }),
      skills: [makeSkill({ innerCost: 10, power: 0 })],
    });
  // 五行阵要求满编 5 人
  const allies = [mk('a0', 0), mk('a1', 1), mk('a2', 2), mk('a3', 3), mk('a4', 4)];
  const enemies = [makeUnit({ id: 'foe', slot: 0, side: 'enemy', stats: makeStats({ atk: 1, hpMax: 1e6 }) })];

  const without = simulateBattle({ allies, enemies, seed: 'inner-formation', maxRounds: 1 });
  const withF = simulateBattle({
    allies,
    enemies,
    seed: 'inner-formation',
    maxRounds: 1,
    allyFormation: { id: 'FM_wuxing', level: 5 },
  });

  assert.equal(without.finalInner['a0'], 994, '无阵法：1000 − 10 + 4 = 994');
  assert.ok(
    withF.finalInner['a0']! > without.finalInner['a0']!,
    `五行阵（内力回复 +45%）应让余量更高：${without.finalInner['a0']} → ${withF.finalInner['a0']}`,
  );
});

/* ══════════════════ ④ 封穴 ══════════════════ */

test('★ 封穴：只能普攻，且内力回复减半', () => {
  const hero = makeUnit({
    id: 'hero',
    slot: 0,
    // 速度比敌人快，保证第 1 回合先出手，随后被封穴
    stats: makeStats({ spd: 99, innerMax: 1000, innerRegen: 10 }),
    skills: [makeSkill({ innerCost: 10, power: 0 })],
  });
  const foe = makeUnit({
    id: 'sealer',
    slot: 0,
    side: 'enemy',
    stats: makeStats({ atk: 1, spd: 1, hpMax: 1e6 }),
    skills: [makeSkill({ power: 0, status: { id: 'seal', chance: 1, rounds: 2 } })],
  });

  const log = simulateBattle({ allies: [hero], enemies: [foe], seed: 'seal-test', maxRounds: 2 });
  assert.ok(
    log.events.some((e) => e.type === 'statusApplied' && e.statusId === 'seal'),
    '测试前提：封穴必须被施加',
  );
  const acts = actsOf(log).filter((a) => a.actorId === 'hero');
  assert.equal(acts[0]!.basic, false, '封穴前可以正常放套路');
  assert.equal(acts[1]!.basic, true, '被封穴后只能普攻');
  assert.equal(acts[1]!.cost, 0, '普攻不消耗内力');

  // 内力回复减半：R1 末 1000−10+10=1000（封顶），R2 末 +5 仍封顶 → 用上限放大观察
  assert.ok(log.finalInner['hero']! <= 1000, '内力不得超过上限');
});

/* ══════════════════ ⑤ 回春（回归：它必须是治疗） ══════════════════ */

test('★ 回归：回春必须回血，绝不能造成伤害（旧实现每回合扣 1 点）', () => {
  const hero = makeUnit({
    id: 'hero',
    slot: 0,
    stats: makeStats({ hpMax: 100_000, def: 0, spd: 99, innerMax: 1000 }),
    skills: [makeSkill({ innerCost: 1, power: 0 })],
  });
  const foe = makeUnit({
    id: 'healer',
    slot: 0,
    side: 'enemy',
    stats: makeStats({ atk: 3000, spd: 1, hpMax: 1e6 }),
    skills: [makeSkill({ power: 0, status: { id: 'regen', chance: 1, rounds: 2 } })],
  });

  const log = simulateBattle({ allies: [hero], enemies: [foe], seed: 'regen-hp', maxRounds: 3 });

  const heals = log.events.filter((e) => e.type === 'heal');
  assert.ok(heals.length > 0, '回春应产生 heal 事件');
  for (const h of heals) assert.ok(h.value > 0, `治疗量必须为正（实际 ${h.value}）`);

  const badDot = log.events.filter((e) => e.type === 'dot' && e.statusId === 'regen');
  assert.equal(badDot.length, 0, '回春不应产生持续伤害事件');

  // 治疗量 = 4% 最大气血
  assert.ok(
    heals.every((h) => Math.abs(h.value - 100_000 * 0.04) < 2),
    `回春治疗量应为最大气血的 4%：${heals.map((h) => h.value).join(',')}`,
  );
});

test('回春的治疗不会被计入总伤害统计', () => {
  const hero = makeUnit({
    id: 'hero',
    slot: 0,
    // 攻 0 → 双方都打不出伤害，总伤害必须严格为 0
    stats: makeStats({ atk: 0, hpMax: 100_000, def: 0, spd: 99, innerMax: 1000 }),
    skills: [makeSkill({ innerCost: 1, power: 0 })],
  });
  const foe = makeUnit({
    id: 'healer',
    slot: 0,
    side: 'enemy',
    stats: makeStats({ atk: 0, spd: 1, hpMax: 1e6 }),
    skills: [makeSkill({ power: 0, status: { id: 'regen', chance: 1, rounds: 2 } })],
  });
  const log = simulateBattle({ allies: [hero], enemies: [foe], seed: 'regen-stat', maxRounds: 3 });
  assert.ok(log.events.some((e) => e.type === 'heal'), '测试前提：必须产生过治疗事件');

  // 总伤害必须**恰好**等于 damage / dot / reflect 事件之和 —— 治疗不能混进来
  const sum = log.events.reduce(
    (acc, e) => acc + (e.type === 'damage' || e.type === 'dot' || e.type === 'reflect' ? e.value : 0),
    0,
  );
  assert.equal(log.stats.totalDamage, sum, '总伤害必须等于 damage/dot/reflect 之和（治疗不计入）');
});
