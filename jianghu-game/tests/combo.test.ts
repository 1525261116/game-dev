/**
 * 连招系统测试（node --test，零依赖运行）
 *   node --test tests/combo.test.ts
 *
 * 口径：05_combat/连招系统.md + GDD 02 §2.1.1「列连击」+ GDD 03 §3.1.7 附
 *       · 前招收势 = 后招起势 → 后招威力 +30%
 *       · 三连 → 第三招威力 +60%，触发吸血 +10%
 *       · 连招失败不增不减（无惩罚）
 *       · 辅助型（1/1）中断链，自身不吃加成
 *       · 定身不参与同列连击
 *
 * 纯函数部分测规则，集成部分测"加成真的落到了伤害数字上"。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COMBO_BONUS,
  TRIPLE_LIFESTEAL_BONUS,
  advanceCombo,
  chainKey,
  emptyChain,
  isSupportSkill,
  normalizeStance,
} from '../src/core/battle/combo.ts';
import { simulateBattle } from '../src/core/battle/simulate.ts';
import { ALLY_PARTY, ENEMY_PARTY } from '../src/data/battle-presets.ts';
import { makeSkill, makeStats, makeUnit } from './fixtures.ts';
import type { BattleEvent, BattleLog } from '../src/core/battle/simulate.ts';
import type { SlotIndex } from '../src/core/battle/types.ts';

type ActEvent = Extract<BattleEvent, { type: 'act' }>;

/** 取出战报里所有"出手"事件（带类型收窄，便于断言 comboStage 等字段） */
function actsOf(log: BattleLog): ActEvent[] {
  return log.events.filter((e): e is ActEvent => e.type === 'act');
}

/* ══════════════════ ① 纯规则 ══════════════════ */

test('起收势钳制到 1~3；缺省视为 1', () => {
  assert.equal(normalizeStance(undefined), 1);
  assert.equal(normalizeStance(0), 1);
  assert.equal(normalizeStance(9), 3);
  assert.equal(normalizeStance(2.2), 2);
});

test('辅助型判定：起势 1 且收势 1（§7.6）', () => {
  assert.equal(isSupportSkill({ stanceStart: 1, stanceEnd: 1 }), true);
  assert.equal(isSupportSkill({}), true, '留空 = 1/1 = 不参与连招');
  assert.equal(isSupportSkill({ stanceStart: 1, stanceEnd: 2 }), false);
});

test('链挂在「方 × 列」上：不同列互不干扰', () => {
  assert.equal(chainKey('ally', 0), 'ally:left');
  assert.equal(chainKey('ally', 3), 'ally:left');
  assert.equal(chainKey('ally', 4), 'ally:center');
  assert.equal(chainKey('enemy', 8), 'enemy:right');
});

test('★ 连招链：第 1 段无加成 → 第 2 段 +30% → 三连 +60% 并吸血，随后重新起势', () => {
  // 狂风(1/2) → 断岳(2/3) → 霸刀(3/1)：连招系统文档里的示例链
  const r1 = advanceCombo(emptyChain(), { stanceStart: 1, stanceEnd: 2 });
  assert.equal(r1.outcome.stage, 1);
  assert.equal(r1.outcome.bonusDamage, 0);
  assert.deepEqual(r1.chain, { expectedStart: 2, length: 1 });

  const r2 = advanceCombo(r1.chain, { stanceStart: 2, stanceEnd: 3 });
  assert.equal(r2.outcome.stage, 2);
  assert.equal(r2.outcome.bonusDamage, COMBO_BONUS.stage2);
  assert.equal(r2.outcome.lifestealBonus, 0);
  assert.deepEqual(r2.chain, { expectedStart: 3, length: 2 });

  const r3 = advanceCombo(r2.chain, { stanceStart: 3, stanceEnd: 1 });
  assert.equal(r3.outcome.stage, 3);
  assert.equal(r3.outcome.bonusDamage, COMBO_BONUS.stage3);
  assert.equal(r3.outcome.lifestealBonus, TRIPLE_LIFESTEAL_BONUS);
  assert.deepEqual(r3.chain, emptyChain(), '三连之后重新起势');

  // 三连后下一门从头开始（不继承 +60%）
  const r4 = advanceCombo(r3.chain, { stanceStart: 1, stanceEnd: 2 });
  assert.equal(r4.outcome.stage, 1);
  assert.equal(r4.outcome.bonusDamage, 0);
});

test('★ 接不上不惩罚：只重置链，本次按第 1 段正常释放', () => {
  const first = advanceCombo(emptyChain(), { stanceStart: 1, stanceEnd: 2 });
  const miss = advanceCombo(first.chain, { stanceStart: 3, stanceEnd: 1 });
  assert.equal(miss.outcome.stage, 1);
  assert.equal(miss.outcome.bonusDamage, 0);
  assert.equal(miss.outcome.interrupted, false, '"接不上"不算打断，设计明确无惩罚');
  assert.deepEqual(miss.chain, { expectedStart: 1, length: 1 }, '从本次的收势重新起势');
});

test('★ 辅助型中断本列链，且自身不吃加成', () => {
  const first = advanceCombo(emptyChain(), { stanceStart: 1, stanceEnd: 2 });
  const support = advanceCombo(first.chain, { stanceStart: 1, stanceEnd: 1 });
  assert.equal(support.outcome.interrupted, true);
  assert.equal(support.outcome.stage, 1);
  assert.equal(support.outcome.bonusDamage, 0);
  assert.deepEqual(support.chain, emptyChain(), '辅助型出手后链清空');
});

test('普攻（无套路）同样中断链', () => {
  const first = advanceCombo(emptyChain(), { stanceStart: 2, stanceEnd: 3 });
  const basic = advanceCombo(first.chain, null);
  assert.equal(basic.outcome.interrupted, true);
  assert.deepEqual(basic.chain, emptyChain());
});

/* ══════════════════ ② 加成真的落到伤害上 ══════════════════ */

/** 取某单位的第 n 次出手（从 0 开始）的伤害与吸血 */
function hitOf(log: BattleLog, actorId: string, index: number) {
  const acts = log.events
    .map((e, i) => ({ e, i }))
    .filter((x): x is { e: ActEvent; i: number } => x.e.type === 'act' && x.e.actorId === actorId);
  const act = acts[index];
  if (!act) throw new Error(`${actorId} 没有第 ${index + 1} 次出手`);
  for (let k = act.i + 1; k < log.events.length; k++) {
    const e = log.events[k]!;
    if (e.type === 'act') break;
    if (e.type === 'damage') return { act: act.e, value: e.value, lifesteal: e.lifesteal, crit: e.crit };
  }
  throw new Error(`${actorId} 第 ${index + 1} 次出手没有造成伤害`);
}

/**
 * 造一个"用哪门套路完全可控"的场面：
 *   第 1 回合用 opener（消耗掉全部内力），第 2/3 回合只剩 filler 可用（0 消耗）。
 * 这样 "谁在什么时候出手" 是确定的，剩下唯一的变量就是**连招链**。
 */
function chainRun(opts: {
  opener: { start: number; end: number };
  second: { start: number; end: number };
  third?: { start: number; end: number };
  seed: string;
}) {
  const skills = [
    makeSkill({
      id: 'opener',
      name: 'opener',
      quality: 'jue',
      innerCost: 10,
      power: 300,
      multiplier: 1,
      stanceStart: opts.opener.start,
      stanceEnd: opts.opener.end,
    }),
    makeSkill({
      id: 'second',
      name: 'second',
      quality: 'jue',
      innerCost: 0,
      power: 200,
      multiplier: 1,
      stanceStart: opts.second.start,
      stanceEnd: opts.second.end,
    }),
  ];
  if (opts.third) {
    skills.push(
      makeSkill({
        id: 'third',
        name: 'third',
        quality: 'jue',
        innerCost: 0,
        power: 200,
        multiplier: 1,
        stanceStart: opts.third.start,
        stanceEnd: opts.third.end,
      }),
    );
  }

  const hero = makeUnit({
    id: 'hero',
    slot: 0,
    stats: makeStats({ atk: 200, crit: 0, hit: 1, spd: 99, hpMax: 100_000, innerMax: 10, innerRegen: 0 }),
    skills,
  });
  const foe = makeUnit({
    id: 'foe',
    slot: 0,
    side: 'enemy',
    stats: makeStats({ atk: 500, spd: 1, hpMax: 1_000_000 }),
    skills: [makeSkill({ power: 0, innerCost: 0 })],
  });

  return simulateBattle({
    allies: [hero],
    enemies: [foe],
    seed: opts.seed,
    maxRounds: opts.third ? 3 : 2,
    allyIntent: 'combo',
  });
}

test('★ 连招第 2 段：同一发伤害在链内是链外的 1.30 倍', () => {
  const matched = chainRun({ opener: { start: 1, end: 2 }, second: { start: 2, end: 3 }, seed: 'combo-2' });
  const broken = chainRun({ opener: { start: 1, end: 2 }, second: { start: 1, end: 3 }, seed: 'combo-2' });

  const m = hitOf(matched, 'hero', 1);
  const b = hitOf(broken, 'hero', 1);

  assert.equal(m.act.comboStage, 2, '匹配时应是第 2 段');
  assert.equal(b.act.comboStage, 1, '不匹配时应回落到第 1 段');
  assert.ok(
    Math.abs(m.value / b.value - 1.3) < 0.03,
    `链内伤害应为链外的 1.30 倍（${b.value} → ${m.value}，实际 ${(m.value / b.value).toFixed(3)}）`,
  );
});

test('★ 三连：第三招伤害是链外的 1.60 倍，且获得 +10% 吸血', () => {
  const matched = chainRun({
    opener: { start: 1, end: 2 },
    second: { start: 2, end: 3 },
    third: { start: 3, end: 1 },
    seed: 'combo-3',
  });
  const broken = chainRun({
    opener: { start: 1, end: 2 },
    second: { start: 2, end: 3 },
    third: { start: 1, end: 1 },
    seed: 'combo-3',
  });

  const m = hitOf(matched, 'hero', 2);
  const b = hitOf(broken, 'hero', 2);

  assert.equal(m.act.comboStage, 3, '应达成三连');
  assert.equal(b.act.comboStage, 1);
  assert.ok(
    Math.abs(m.value / b.value - 1.6) < 0.04,
    `三连伤害应为链外的 1.60 倍（${b.value} → ${m.value}，实际 ${(m.value / b.value).toFixed(3)}）`,
  );
  assert.ok(m.lifesteal > 0, '三连应触发吸血');
  assert.equal(b.lifesteal, 0, '未三连不应触发额外吸血');
});

/* ══════════════════ ③ 列连击（跨单位） ══════════════════ */

/** 两名己方单位：lead 先手留一个收势，follow 用对应的起势 */
function columnRun(leadSlot: SlotIndex, followSlot: SlotIndex, followStart: number) {
  const lead = makeUnit({
    id: 'lead',
    slot: leadSlot,
    stats: makeStats({ atk: 100, crit: 0, hit: 1, spd: 99, innerMax: 10_000 }),
    skills: [makeSkill({ id: 'lead_s', name: 'lead_s', innerCost: 0, power: 100, stanceStart: 1, stanceEnd: 2 })],
  });
  const follow = makeUnit({
    id: 'follow',
    slot: followSlot,
    stats: makeStats({ atk: 100, crit: 0, hit: 1, spd: 1, innerMax: 10_000 }),
    skills: [
      makeSkill({ id: 'follow_s', name: 'follow_s', innerCost: 0, power: 100, stanceStart: followStart, stanceEnd: 3 }),
    ],
  });
  const foe = makeUnit({
    id: 'foe',
    slot: 0,
    side: 'enemy',
    stats: makeStats({ atk: 0, hpMax: 1_000_000 }),
    skills: [makeSkill({ power: 0, innerCost: 0 })],
  });
  return simulateBattle({
    allies: [lead, follow],
    enemies: [foe],
    seed: 'column-combo',
    maxRounds: 1,
    allyIntent: 'combo',
  });
}

test('★ 列连击：同列的单位可以跨位接续连招链', () => {
  // lead 在 前·左(0)，follow 在 中·左(3) → 同一列
  const log = columnRun(0, 3, 2);
  const followAct = log.events.find((e) => e.type === 'act' && e.actorId === 'follow');
  assert.ok(followAct && followAct.type === 'act');
  assert.equal(followAct.comboStage, 2, '同列且起势匹配，应接上第 2 段');
});

test('★ 跨列不续链：不同列的单位各走各的链', () => {
  // lead 在 前·左(0)，follow 在 中·中(4) → 不同列
  const log = columnRun(0, 4, 2);
  const followAct = log.events.find((e) => e.type === 'act' && e.actorId === 'follow');
  assert.ok(followAct && followAct.type === 'act');
  assert.equal(followAct.comboStage, 1, '不同列的链互不干扰');
});

/* ══════════════════ ④ 定身不参与列连击 ══════════════════ */

test('★ 定身：不参与同列连击（起势再匹配也不加成）', () => {
  const hero = makeUnit({
    id: 'hero',
    slot: 0,
    stats: makeStats({ atk: 100, crit: 0, hit: 1, spd: 99, hpMax: 100_000, innerMax: 10_000 }),
    skills: [
      makeSkill({ id: 'a', name: 'a', innerCost: 0, power: 100, stanceStart: 1, stanceEnd: 2 }),
      makeSkill({ id: 'b', name: 'b', innerCost: 0, power: 200, stanceStart: 2, stanceEnd: 3 }),
    ],
  });
  const foe = makeUnit({
    id: 'foe',
    slot: 0,
    side: 'enemy',
    // 速度慢于 hero：第 1 回合 hero 先出手，随后被定身
    stats: makeStats({ atk: 1, spd: 1, hpMax: 1_000_000 }),
    skills: [makeSkill({ power: 0, innerCost: 0, status: { id: 'root', chance: 1, rounds: 2 } })],
  });

  const log = simulateBattle({
    allies: [hero],
    enemies: [foe],
    seed: 'root-combo',
    maxRounds: 2,
    allyIntent: 'combo',
  });

  const heroActs = actsOf(log).filter((e) => e.actorId === 'hero');
  assert.equal(heroActs.length, 2, '应出手两次');
  assert.equal(heroActs[0]!.comboStage, 1);
  assert.equal(heroActs[1]!.comboStage, 1, '定身时不参与列连击，即使起势能接上');
});

/* ══════════════════ ⑤ 真实阵容的三连演示 ══════════════════ */

test('★ 真实配置表阵容：优先连招下能打出完整三连（狂风→断岳→霸刀）', () => {
  const log = simulateBattle({
    allies: ALLY_PARTY,
    enemies: ENEMY_PARTY,
    seed: 'demo-combo',
    maxRounds: 12,
    allyIntent: 'combo',
  });

  const comboActs = actsOf(log);
  const triple = comboActs.filter((e) => e.comboStage === 3);
  assert.ok(triple.length > 0, `12 回合内应至少打出一次三连：${comboActs.map((a) => `${a.actorName}:${a.skillName}#${a.comboStage}`).join(' ')}`);
  assert.equal(log.stats.comboStage3, triple.length);
  assert.ok(log.stats.comboStage2 >= log.stats.comboStage3, '第 2 段次数应不少于三连次数');
});

test('战斗倾向会改变实际打出的连招数量（否则倾向是假功能）', () => {
  const combo = simulateBattle({
    allies: ALLY_PARTY,
    enemies: ENEMY_PARTY,
    seed: 'intent-cmp',
    maxRounds: 12,
    allyIntent: 'combo',
  });
  const output = simulateBattle({
    allies: ALLY_PARTY,
    enemies: ENEMY_PARTY,
    seed: 'intent-cmp',
    maxRounds: 12,
    allyIntent: 'output',
  });
  assert.ok(
    combo.stats.comboStage2 + combo.stats.comboStage3 >
      output.stats.comboStage2 + output.stats.comboStage3,
    `优先连招应打出更多连招：${combo.stats.comboStage2}/${combo.stats.comboStage3} vs ${output.stats.comboStage2}/${output.stats.comboStage3}`,
  );
  assert.equal(output.intents.ally, 'output');
  assert.equal(combo.intents.ally, 'combo');
});
