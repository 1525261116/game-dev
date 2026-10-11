/**
 * 阵法 × 战斗 集成测试（node --test，零依赖运行）
 *   node --test tests/formation-battle.test.ts
 *
 * 阵法很容易写成"看着有加成、实际没生效"的假功能 —— 属性算错了、位置判错了、
 * 结果被后面一行覆盖了，表面都看不出来。所以这组测试一律用**对比法**：
 *   同种子跑两场，一场带阵法一场不带，然后断言差异真的发生了。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { simulateBattle } from '../src/core/battle/simulate.ts';
import { ALLY_PARTY, ENEMY_PARTY } from '../src/data/battle-presets.ts';
import { FORMATIONS } from '../src/data/formations.ts';
import type { BattleEvent, BattleLog } from '../src/core/battle/simulate.ts';
import type { BattleUnitConfig } from '../src/core/battle/simulate.ts';

/** 取某一方是否发出过阵法事件 */
function formationEvent(log: BattleLog, side: 'ally' | 'enemy'): Extract<BattleEvent, { type: 'formation' }> | undefined {
  return log.events.find((e): e is Extract<BattleEvent, { type: 'formation' }> => e.type === 'formation' && e.side === side);
}

/** 取战斗开始时的某单位气血上限 */
function hpMaxOf(log: BattleLog, id: string): number {
  const start = log.events.find((e) => e.type === 'battleStart');
  if (!start || start.type !== 'battleStart') throw new Error('日志缺少 battleStart');
  const u = start.units.find((x) => x.id === id);
  if (!u) throw new Error(`日志里没有单位 ${id}`);
  return u.hpMax;
}

/* ══════════════════ 向后兼容 ══════════════════ */

test('★ 不传阵法时：没有阵法事件，行为与接入阵法之前一致', () => {
  const log = simulateBattle({ allies: ALLY_PARTY, enemies: ENEMY_PARTY, seed: 'no-formation' });
  assert.equal(log.events.filter((e) => e.type === 'formation').length, 0, '未配置阵法时不应产生阵法事件');
  assert.equal(log.formations.ally, null);
  assert.equal(log.formations.enemy, null);
  assert.equal(log.stats.reflectDamage, 0, '无阵法时不应有反弹伤害');

  // 同种子两次结果必须一致（确认没引入随机性）
  const again = simulateBattle({ allies: ALLY_PARTY, enemies: ENEMY_PARTY, seed: 'no-formation' });
  assert.deepEqual(again.events, log.events);
});

/* ══════════════════ 开局公布 ══════════════════ */

test('阵法在开局公布，且带人类可读的加成说明', () => {
  const log = simulateBattle({
    allies: ALLY_PARTY,
    enemies: ENEMY_PARTY,
    allyFormation: { id: 'FM_changshe', level: 5 },
    enemyFormation: { id: 'FM_youyue', level: 3 },
    seed: 'announce',
  });

  const ally = formationEvent(log, 'ally');
  const enemy = formationEvent(log, 'enemy');
  assert.ok(ally && enemy);
  assert.equal(ally.formationName, '一字长蛇阵');
  assert.equal(ally.result, 'ok');
  assert.ok(ally.description.includes('防御'), `说明应包含加成内容，实际：${ally.description}`);

  assert.equal(enemy.formationName, '幽月阵');
  assert.ok(enemy.description.includes('暴击率'));

  // 事件应出现在第一回合之前
  const firstRound = log.events.findIndex((e) => e.type === 'roundStart');
  const formationIdx = log.events.findIndex((e) => e.type === 'formation');
  assert.ok(formationIdx < firstRound, '阵法应在回合开始前公布');
});

/* ══════════════════ 站位约束：满足 / 不满足 ══════════════════ */

test('★ 一字长蛇阵（要求前排满员）：我方 3 人都在前排 → 全额生效', () => {
  const log = simulateBattle({
    allies: ALLY_PARTY,
    enemies: ENEMY_PARTY,
    allyFormation: { id: 'FM_changshe', level: 5 },
    seed: 'changshe-ok',
  });
  assert.equal(formationEvent(log, 'ally')?.result, 'ok');
});

test('★ 三才阵（要求前中后各一人）：我方全在前排 → 完全失效', () => {
  const log = simulateBattle({
    allies: ALLY_PARTY,
    enemies: ENEMY_PARTY,
    allyFormation: { id: 'FM_sancai', level: 5 },
    seed: 'sancai-fail',
  });
  const ev = formationEvent(log, 'ally');
  assert.equal(ev?.result, 'fail', '站位不符时阵法必须判定为 fail');
  assert.equal(ev?.description, '', 'fail 时不应有任何加成说明');

  // 与完全不配阵法相比，**数值结果**应完全一致（fail = 零加成）
  // 注意这里不能比较整个 events 数组：fail 的阵法仍会留下一条"公布阵法"的事件
  const noFormation = simulateBattle({ allies: ALLY_PARTY, enemies: ENEMY_PARTY, seed: 'sancai-fail' });
  assert.deepEqual(log.stats, noFormation.stats, 'fail 的阵法不应产生任何数值影响');
  assert.deepEqual(log.finalHp, noFormation.finalHp, 'fail 的阵法不应改变战斗结果');
});

test('★ 把三人移到前中后各一个 → 三才阵应该生效', () => {
  const spread: BattleUnitConfig[] = [
    { ...ALLY_PARTY[0]!, slot: 0 }, // 前排
    { ...ALLY_PARTY[1]!, slot: 4 }, // 中排
    { ...ALLY_PARTY[2]!, slot: 8 }, // 后排
  ];
  const log = simulateBattle({
    allies: spread,
    enemies: ENEMY_PARTY,
    allyFormation: { id: 'FM_sancai', level: 5 },
    seed: 'sancai-ok',
  });
  const ev = formationEvent(log, 'ally');
  assert.equal(ev?.result, 'ok', '前中后各一人时三才阵应全额生效');
  assert.ok(ev!.description.includes('攻击'));
});

/* ══════════════════ 属性加成真的落到数值上 ══════════════════ */

test('★ 一字长蛇阵的防御加成必须真的减少我方受到的伤害', () => {
  const seed = 'changshe-damage';
  const without = simulateBattle({ allies: ALLY_PARTY, enemies: ENEMY_PARTY, seed });
  const withF = simulateBattle({
    allies: ALLY_PARTY,
    enemies: ENEMY_PARTY,
    allyFormation: { id: 'FM_changshe', level: 5 },
    seed,
  });

  assert.ok(
    withF.stats.enemyDamage < without.stats.enemyDamage,
    `防御 +24% 后我方受到的伤害应降低：${without.stats.enemyDamage} → ${withF.stats.enemyDamage}`,
  );
});

test('★ 龟蛇阵的结果必须体现在气血上限上（+30%）', () => {
  const log = simulateBattle({
    allies: ALLY_PARTY,
    enemies: ENEMY_PARTY,
    allyFormation: { id: 'FM_guishe', level: 5 },
    seed: 'guishe-hp',
  });
  assert.equal(formationEvent(log, 'ally')?.result, 'ok', '前排满员时龟蛇阵应生效');

  const base = hpMaxOf(simulateBattle({ allies: ALLY_PARTY, enemies: ENEMY_PARTY, seed: 'x' }), 'ally_dao');
  const buffed = hpMaxOf(log, 'ally_dao');
  // 5 级龟蛇阵：hpMax +30%
  assert.ok(
    Math.abs(buffed / base - 1.3) < 0.01,
    `气血上限应为基准的 1.3 倍，实际 ${base} → ${buffed}`,
  );
});

test('★ 幽月阵的暴击加成必须真的提高暴击次数', () => {
  const countCrits = (log: BattleLog): number =>
    log.events.filter((e) => e.type === 'damage' && e.crit).length;

  let baseCrits = 0;
  let buffedCrits = 0;
  for (let i = 0; i < 40; i++) {
    baseCrits += countCrits(simulateBattle({ allies: ALLY_PARTY, enemies: ENEMY_PARTY, seed: `crit-${i}` }));
    buffedCrits += countCrits(
      simulateBattle({
        allies: ALLY_PARTY,
        enemies: ENEMY_PARTY,
        allyFormation: { id: 'FM_youyue', level: 5 },
        seed: `crit-${i}`,
      }),
    );
  }
  assert.ok(
    buffedCrits > baseCrits,
    `暴击 +15% 后暴击次数应增加：${baseCrits} → ${buffedCrits}`,
  );
});

/* ══════════════════ 特殊效果 ══════════════════ */

test('★ 天罡北斗阵必须真的产生反弹伤害', () => {
  // 要求：前排 1 人 + 后排 3 人（共 4 人）
  const diamond: BattleUnitConfig[] = [
    { ...ALLY_PARTY[0]!, slot: 0 }, // 前排
    { ...ALLY_PARTY[1]!, slot: 6 }, // 后排
    { ...ALLY_PARTY[2]!, slot: 7 },
    { ...ALLY_PARTY[0]!, id: 'ally_extra', name: '替补', slot: 8 },
  ];

  const log = simulateBattle({
    allies: diamond,
    enemies: ENEMY_PARTY,
    allyFormation: { id: 'FM_tiangang', level: 5 },
    seed: 'tiangang-reflect',
  });
  assert.equal(formationEvent(log, 'ally')?.result, 'ok', '1 前 3 后时天罡北斗阵应生效');
  assert.ok(log.stats.reflectDamage > 0, '阵法带 15% 反震，日志里必须出现反弹伤害');

  const reflectEvents = log.events.filter((e) => e.type === 'reflect');
  assert.ok(reflectEvents.length > 0, '应产生反弹事件供表现层播放');
  for (const e of reflectEvents) {
    if (e.type === 'reflect') {
      assert.ok(e.value >= 1 && Number.isInteger(e.value), `反弹值必须是正整数，实际 ${e.value}`);
    }
  }
});

test('★ 守境阵的「首次受制可免」必须真的免疫一次控制', () => {
  // 敌方奇门客带「封穴」（30% 概率），正好用来触发免疫
  let immuneTotal = 0;
  let statusTotal = 0;
  for (let i = 0; i < 60; i++) {
    const log = simulateBattle({
      allies: ALLY_PARTY,
      enemies: ENEMY_PARTY,
      allyFormation: { id: 'FM_shoujing', level: 5 },
      seed: `immune-${i}`,
    });
    immuneTotal += log.events.filter((e) => e.type === 'immune').length;
    statusTotal += log.events.filter((e) => e.type === 'statusApplied').length;
  }
  assert.ok(immuneTotal > 0, '60 场里一次免疫都没触发，守境阵的免疫可能没接上');
  assert.ok(statusTotal > 0, '同时仍应有状态正常生效（免疫只挡第一次）');
});

test('守境阵的免疫只生效一次（不会被反复触发）', () => {
  for (let i = 0; i < 30; i++) {
    const log = simulateBattle({
      allies: ALLY_PARTY,
      enemies: ENEMY_PARTY,
      allyFormation: { id: 'FM_shoujing', level: 5 },
      seed: `immune-once-${i}`,
    });
    const imm = log.events.filter((e) => e.type === 'immune').length;
    assert.ok(imm <= 1, `第 ${i} 场触发了 ${imm} 次免疫，应最多 1 次`);
  }
});

/* ══════════════════ 与配置表一致 ══════════════════ */

test('阵法表里的每个 id 都能被战斗正常解析', () => {
  for (const f of FORMATIONS) {
    const log = simulateBattle({
      allies: ALLY_PARTY,
      enemies: ENEMY_PARTY,
      allyFormation: { id: f.id, level: 5 },
      seed: `all-${f.id}`,
    });
    const ev = formationEvent(log, 'ally');
    assert.ok(ev, `阵法 ${f.name} 没有产生阵法事件`);
    assert.equal(ev!.formationId, f.id);
    assert.ok(['ok', 'partial', 'fail'].includes(ev!.result), `非法结果：${ev!.result}`);
  }
});

test('阵法等级会被钳制在 1~5（越界不会崩）', () => {
  for (const level of [0, 1, 5, 9, -3]) {
    const log = simulateBattle({
      allies: ALLY_PARTY,
      enemies: ENEMY_PARTY,
      allyFormation: { id: 'FM_changshe', level },
      seed: `level-${level}`,
    });
    const ev = formationEvent(log, 'ally');
    assert.ok(ev!.level >= 1 && ev!.level <= 5, `等级 ${level} 应被钳制到 1~5，实际 ${ev!.level}`);
  }
});

test('阵法加成不会破坏战斗收敛（仍能打完）', () => {
  for (const f of FORMATIONS) {
    const log = simulateBattle({
      allies: ALLY_PARTY,
      enemies: ENEMY_PARTY,
      allyFormation: { id: f.id, level: 5 },
      enemyFormation: { id: 'FM_changshe', level: 5 },
      seed: `converge-${f.id}`,
    });
    assert.ok(log.rounds >= 1 && log.rounds <= 30, `${f.name} 导致回合数异常：${log.rounds}`);
    assert.equal(log.events.at(-1)?.type, 'battleEnd');
  }
});
