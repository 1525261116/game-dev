/**
 * 战斗预结算测试（node --test，零依赖运行）
 *   node --test tests/battle-sim.test.ts
 *
 * 重点验证四件事：
 *   ① 确定性：同种子必然同结果（铁律 5 的直接验收）
 *   ② 战斗一定会结束，且不会出现"秒杀 / 打不完"的失衡
 *   ③ 日志与血量自洽（hpAfter 必须等于累减结果，不能出现对不上的数字）
 *   ④ 群体递减在真实战斗里生效（AOE 打多目标时第 2 个目标伤害更低）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { simulateBattle, simulateMany } from '../src/core/battle/simulate.ts';
import { ALLY_PARTY, ENEMY_PARTY } from '../src/data/battle-presets.ts';
import type { BattleEvent, BattleLog } from '../src/core/battle/simulate.ts';

/** 用固定种子跑一场 */
function run(seed: string | number, maxRounds = 30): BattleLog {
  return simulateBattle({ allies: ALLY_PARTY, enemies: ENEMY_PARTY, seed, maxRounds });
}

/* ══════════════════════ 确定性 ══════════════════════ */

test('★ 同种子必然同结果（整场战斗逐事件一致）', () => {
  const a = run('fixed-seed-001');
  const b = run('fixed-seed-001');
  assert.equal(a.winner, b.winner);
  assert.equal(a.rounds, b.rounds);
  assert.deepEqual(a.finalHp, b.finalHp);
  assert.deepEqual(a.events, b.events, '同种子的整条事件流必须完全一致');
  assert.deepEqual(a.stats, b.stats);
});

test('不同种子会产生不同的战斗过程（说明随机真的在起作用）', () => {
  const a = run('seed-A');
  const b = run('seed-B');
  assert.notDeepEqual(a.events, b.events);
});

/* ══════════════════════ 战斗必然收敛 ══════════════════════ */

test('★ 战斗一定会结束（不会出现死循环或永远打不完）', () => {
  for (let i = 0; i < 30; i++) {
    const log = run(`converge-${i}`);
    assert.ok(log.rounds >= 1 && log.rounds <= 30, `第 ${i} 场回合数异常：${log.rounds}`);
    assert.ok(['ally', 'enemy', 'draw'].includes(log.winner));
  }
});

test('战斗结束时，双方不可能同时有人存活且判出胜负', () => {
  for (let i = 0; i < 20; i++) {
    const log = run(`end-check-${i}`);
    const end = log.events.at(-1);
    assert.equal(end?.type, 'battleEnd', '日志最后一条必须是 battleEnd');
    if (log.winner === 'ally') assert.equal((end as { enemyAlive: number }).enemyAlive, 0);
    if (log.winner === 'enemy') assert.equal((end as { allyAlive: number }).allyAlive, 0);
  }
});

/* ══════════════════════ 日志自洽性 ══════════════════════ */

test('★ 日志与血量自洽：hpAfter 必须等于血量累减的真实结果', () => {
  const log = run('consistency');

  // 从 battleStart 拿到各单位初始气血
  const start = log.events.find((e) => e.type === 'battleStart') as Extract<
    BattleEvent,
    { type: 'battleStart' }
  >;
  const hp = new Map(start.units.map((u) => [u.id, u.hpMax]));

  for (const ev of log.events) {
    if (ev.type === 'damage') {
      const before = hp.get(ev.targetId)!;
      const expected = Math.max(0, before - ev.value);
      assert.equal(ev.hpAfter, expected, `${ev.targetId} 的 hpAfter 与扣血不一致`);
      hp.set(ev.targetId, ev.hpAfter);
      assert.ok(ev.lifesteal >= 0, '吸血值不可能为负');
    } else if (ev.type === 'dot') {
      const before = hp.get(ev.targetId)!;
      const expected = Math.max(0, before - ev.value);
      assert.equal(ev.hpAfter, expected, `${ev.targetId} 的持续伤害 hpAfter 不一致`);
      hp.set(ev.targetId, ev.hpAfter);
    }
  }

  // 最终血量必须与日志末尾一致
  for (const [id, v] of Object.entries(log.finalHp)) {
    assert.equal(hp.get(id), v, `${id} 的最终血量与日志不一致`);
  }
});

test('伤害数字必须为正整数', () => {
  const log = run('positive-damage');
  for (const ev of log.events) {
    if (ev.type === 'damage') {
      assert.ok(Number.isInteger(ev.value) && ev.value > 0, `非法伤害值：${ev.value}`);
    }
    if (ev.type === 'dot') {
      assert.ok(Number.isInteger(ev.value) && ev.value > 0, `非法持续伤害：${ev.value}`);
    }
  }
});

test('死亡事件不会重复（同一个单位只能死一次）', () => {
  for (let i = 0; i < 20; i++) {
    const log = run(`death-once-${i}`);
    const deaths = log.events.filter((e) => e.type === 'death').map((e) => (e as { unitId: string }).unitId);
    assert.equal(new Set(deaths).size, deaths.length, `第 ${i} 场出现了重复死亡：${deaths.join(',')}`);
  }
});

test('死亡单位不会再出手，也不会再被打', () => {
  const log = run('dead-dont-act');
  const dead = new Set<string>();
  for (const ev of log.events) {
    if (ev.type === 'death') dead.add(ev.unitId);
    if (ev.type === 'act') {
      assert.ok(!dead.has((ev as { actorId: string }).actorId), '已死亡单位不应再出手');
    }
    if (ev.type === 'damage') {
      assert.ok(!dead.has((ev as { targetId: string }).targetId), '已死亡单位不应再被攻击');
    }
  }
});

/* ══════════════════════ 群体递减 ══════════════════════ */

test('★ 群体递减在真实战斗中生效：同一次 AOE 里，后续目标伤害更低', () => {
  let checked = 0;
  for (let i = 0; i < 60 && checked < 5; i++) {
    const log = run(`aoe-${i}`);
    // 找一次打了 2 个以上目标的 act，看其后连续的 damage 事件
    const events = log.events;
    for (let j = 0; j < events.length; j++) {
      const ev = events[j]!;
      if (ev.type !== 'act' || ev.targetIds.length < 2) continue;
      const dmg: number[] = [];
      for (let k = j + 1; k < events.length && dmg.length < ev.targetIds.length; k++) {
        const e = events[k]!;
        if (e.type === 'damage') dmg.push(e.value);
        if (e.type === 'act') break;
      }
      // 至少要拿到两个伤害数字才能比较（可能被闪避打断，所以不强制严格）
      if (dmg.length >= 2) {
        const crit = events.slice(j + 1, j + 1 + ev.targetIds.length).some(
          (e) => e.type === 'damage' && e.crit,
        );
        // 排除暴击干扰后再比较
        if (!crit) {
          assert.ok(dmg[1]! <= dmg[0]!, `AOE 第 2 个目标伤害（${dmg[1]}）应 ≤ 第 1 个（${dmg[0]}）`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked >= 1, '未能在 60 场中观察到一次多目标 AOE，测试样本不足');
});

/* ══════════════════════ 状态系统 ══════════════════════ */

test('状态会被施加，且带回合数', () => {
  let applied = 0;
  for (let i = 0; i < 40; i++) {
    const log = run(`status-${i}`);
    for (const ev of log.events) {
      if (ev.type === 'statusApplied') {
        assert.ok(ev.rounds >= 1, '状态持续回合必须 ≥ 1');
        applied++;
      }
    }
  }
  assert.ok(applied > 0, '40 场战斗中一次状态都没施加，概率配置可能有问题');
});

test('被眩晕的单位会跳过出手（skip 事件）', () => {
  let skips = 0;
  for (let i = 0; i < 60; i++) {
    const log = run(`stun-${i}`);
    skips += log.events.filter((e) => e.type === 'skip').length;
  }
  assert.ok(skips > 0, '60 场战斗中一次眩晕跳过都没有，控制效果可能没生效');
});

/* ══════════════════════ 数值平衡（GDD M1 验收） ══════════════════════ */

test('★ 100 场模拟：不出现秒杀，也不出现打不完（GDD 失衡红线）', () => {
  const s = simulateMany({ allies: ALLY_PARTY, enemies: ENEMY_PARTY, maxRounds: 30 }, 100);

  assert.equal(s.runs, 100);
  // GDD 03 §3.1.5 失衡红线：任意一场 > 30 回合（判负）或 < 1 回合（秒杀）即视为数值缺陷
  assert.ok(s.avgRounds >= 2, `平均回合数过低（${s.avgRounds.toFixed(2)}），疑似秒杀`);
  assert.ok(s.avgRounds <= 15, `平均回合数过高（${s.avgRounds.toFixed(2)}），疑似打不完`);

  // 回合分布里不允许出现 1 回合速通，也不允许贴到 30 回合上限
  assert.equal(s.roundHistogram[1] ?? 0, 0, '出现了 1 回合秒杀');
  assert.equal(s.roundHistogram[30] ?? 0, 0, '出现了打满 30 回合的僵局');

  // 这是"普通怪"定位：玩家应当明显占优。
  // 注意这里**不设胜率上限** —— 普通怪战斗本就该赢，变数体现在"回合数"与
  // "阵亡人数"上（实测回合数在 3~9 之间浮动，不同种子阵亡人数也不同）。
  assert.ok(s.allyWinRate >= 0.7, `我方胜率过低（${(s.allyWinRate * 100).toFixed(1)}%），普通怪不该这么难`);

  // 与 GDD 目标的偏差记录：GDD 目标"普通怪 2~4 回合"基于 4 人队 + 2× 速度，
  // 而这里测的是 3 人队标准速度，实测 4.77 回合，处于合理量级。
  assert.ok(s.avgRounds < 8, `平均回合数 ${s.avgRounds.toFixed(2)} 偏离"普通怪"定位过多`);
});

test('模拟结果本身也是确定的（同配置两次模拟一致）', () => {
  const a = simulateMany({ allies: ALLY_PARTY, enemies: ENEMY_PARTY }, 20);
  const b = simulateMany({ allies: ALLY_PARTY, enemies: ENEMY_PARTY }, 20);
  assert.deepEqual(a, b);
});

test('编队系数：敌方气血随我方人数缩放（3 人队 = 0.75 倍）', () => {
  const three = run('scale-3');
  const start3 = three.events.find((e) => e.type === 'battleStart') as Extract<
    BattleEvent,
    { type: 'battleStart' }
  >;
  const enemy3 = start3.units.find((u) => u.side === 'enemy')!;

  // 用 4 人队再跑一次，敌方气血应是 3 人队的 4/3
  const four = simulateBattle({
    allies: [...ALLY_PARTY, { ...ALLY_PARTY[0]!, id: 'ally_extra', name: '替补', slot: 3 }],
    enemies: ENEMY_PARTY,
    seed: 'scale-4',
  });
  const start4 = four.events.find((e) => e.type === 'battleStart') as Extract<
    BattleEvent,
    { type: 'battleStart' }
  >;
  const enemy4 = start4.units.find((u) => u.id === enemy3.id)!;

  const ratio = enemy4.hpMax / enemy3.hpMax;
  assert.ok(Math.abs(ratio - 4 / 3) < 0.01, `编队系数换算错误：4 人队 / 3 人队 = ${ratio.toFixed(3)}，应为 1.333`);
});
