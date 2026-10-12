/**
 * 目标选取测试（node --test，零依赖运行）
 *   node --test tests/targeting.test.ts
 *
 * 口径：jianghu-design/05_combat/功法系统.md §6.5.7「目标选取（由战斗倾向决定）」
 *       GDD 02 §2.1.1-⓪ 与 ⑤.5（序位递减）
 *
 * 这组测试守住：
 *   ① 候选池（排 / 列 / 十字 / 全体）与边界回退
 *   ② 两种战斗倾向的排序键真的不同
 *   ③ 群体递减按**序位**生效，且系数精确等于 max(0.40, 1−0.15×(i−1))
 *   ④ 出手快照：途中死亡的目标被跳过且**不递补**
 *   ⑤ 10 型范围在真实战斗中全部能被触发
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { selectTargets } from '../src/core/battle/targeting.ts';
import { createRng } from '../src/core/battle/rng.ts';
import { groupDecay } from '../src/core/battle/formula.ts';
import { RANGE_IDS } from '../src/core/battle/range.ts';
import { simulateBattle } from '../src/core/battle/simulate.ts';
import { ALLY_PARTY, ENEMY_PARTY } from '../src/data/battle-presets.ts';
import { makeSkill, makeStats, makeUnit } from './fixtures.ts';
import type { TargetableUnit } from '../src/core/battle/targeting.ts';
import type { RangeId } from '../src/core/battle/range.ts';
import type { SlotIndex } from '../src/core/battle/types.ts';
import type { BattleUnitConfig } from '../src/core/battle/simulate.ts';

/* ══════════════════ 小工具 ══════════════════ */

function tu(id: string, slot: SlotIndex, hp = 100, side: 'ally' | 'enemy' = 'enemy'): TargetableUnit {
  return { id, side, slot, hp, alive: true };
}

function plan(actor: TargetableUnit, units: TargetableUnit[], range: RangeId, intent: 'output' | 'combo', randomCount?: number) {
  return selectTargets({
    actor,
    units,
    range,
    intent,
    ...(randomCount !== undefined ? { randomCount } : {}),
    rng: createRng('targeting-test'),
  });
}

const ids = (p: { targets: TargetableUnit[] }): string[] => p.targets.map((t) => t.id);

/* ══════════════════ ① 候选池与回退 ══════════════════ */

test('单体任意：取池内第 1 名（优先输出 = 血量最低，同血量按站位靠前）', () => {
  const actor = tu('a', 4, 100, 'ally');
  const foes = [tu('f0', 0, 500), tu('f1', 1, 200), tu('f2', 2, 200)];
  assert.deepEqual(ids(plan(actor, [actor, ...foes], 'single_any', 'output')), ['f1'], '血量最低的优先；同血量取站位靠前');
});

test('单体前排：只在前排里挑', () => {
  const actor = tu('a', 4, 100, 'ally');
  const foes = [tu('front', 2, 900), tu('mid', 4, 100), tu('back', 8, 50)];
  assert.deepEqual(ids(plan(actor, [actor, ...foes], 'single_front', 'output')), ['front']);
});

test('单体后排：只在后排里挑（暗器斩首）', () => {
  const actor = tu('a', 4, 100, 'ally');
  const foes = [tu('front', 0, 50), tu('back', 7, 800)];
  assert.deepEqual(ids(plan(actor, [actor, ...foes], 'single_back', 'output')), ['back']);
});

test('★ 前排范围但前排无人 → 就近回退到中排（动作不空放）', () => {
  const actor = tu('a', 4, 100, 'ally');
  const foes = [tu('mid0', 3, 100), tu('mid1', 5, 100), tu('back', 8, 100)];
  const p = plan(actor, [actor, ...foes], 'row_front', 'output');
  assert.deepEqual([...ids(p)].sort(), ['mid0', 'mid1']);
  assert.equal(p.fallback, true, '应标记走了回退路径');
  assert.equal(p.usedArea, 'mid');
});

test('★ 后排范围但后排无人 → 退中排；中排也无人 → 退前排', () => {
  const actor = tu('a', 4, 100, 'ally');
  const p1 = plan(actor, [actor, tu('mid', 4, 100)], 'row_back', 'output');
  assert.deepEqual(ids(p1), ['mid']);
  const p2 = plan(actor, [actor, tu('front', 1, 100)], 'row_back', 'output');
  assert.deepEqual(ids(p2), ['front']);
  assert.equal(p2.fallback, true);
});

test('整列：打存活敌人最密集的那一列（同分取更靠前的列）', () => {
  const actor = tu('a', 4, 100, 'ally');
  const foes = [tu('l0', 0, 100), tu('l1', 3, 100), tu('r0', 2, 100)];
  const p = plan(actor, [actor, ...foes], 'column', 'output');
  assert.deepEqual([...ids(p)].sort(), ['l0', 'l1'], '左列 2 人最密集');
  assert.equal(p.anchor, 0, '锚点应是该列排序后的首格');
});

test('十字：以池内排序第 1 名为中心，命中 3~5 格', () => {
  const actor = tu('a', 4, 100, 'ally');
  // 以 f_mid 为中心（它的血量最低）→ 中心 4 的十字 = {1,3,4,5,7}
  const foes = [tu('f1', 1, 300), tu('f3', 3, 300), tu('f4', 4, 10), tu('f5', 5, 300), tu('f7', 7, 300)];
  const p = plan(actor, [actor, ...foes], 'cross', 'output');
  assert.equal(p.anchor, 4);
  assert.deepEqual([...ids(p)].sort(), ['f1', 'f3', 'f4', 'f5', 'f7']);
  assert.ok(p.targets.length >= 3 && p.targets.length <= 5, '十字命中 3~5 格');
});

test('十字：中心在角上只命中 3 格', () => {
  const actor = tu('a', 4, 100, 'ally');
  const foes = [tu('c', 0, 10), tu('n1', 1, 100), tu('n3', 3, 100)];
  const p = plan(actor, [actor, ...foes], 'cross', 'output');
  assert.equal(p.anchor, 0);
  assert.deepEqual([...ids(p)].sort(), ['c', 'n1', 'n3']);
});

test('全体：所有存活敌人，按站位升序铺开', () => {
  const actor = tu('a', 4, 100, 'ally');
  const foes = [tu('f2', 2, 100), tu('f0', 0, 100), tu('f1', 1, 100)];
  assert.deepEqual(ids(plan(actor, [actor, ...foes], 'all', 'output')), ['f0', 'f1', 'f2']);
});

test('随机 N：取 N 个互不重复的目标；N 超过存活数时取满', () => {
  const actor = tu('a', 4, 100, 'ally');
  const foes = [tu('f0', 0, 100), tu('f1', 1, 100), tu('f2', 2, 100), tu('f3', 3, 100)];
  const p3 = plan(actor, [actor, ...foes], 'random_n', 'output', 3);
  assert.equal(p3.targets.length, 3);
  assert.equal(new Set(ids(p3)).size, 3, '不得重复命中同一个目标');
  const p9 = plan(actor, [actor, ...foes], 'random_n', 'output', 9);
  assert.equal(p9.targets.length, 4, 'N 超过存活数时应取满存活数');
});

test('随机 N：同一种子结果确定（铁律 5：随机必须可复现）', () => {
  const actor = tu('a', 4, 100, 'ally');
  const foes = [tu('f0', 0, 100), tu('f1', 1, 100), tu('f2', 2, 100)];
  const a = plan(actor, [actor, ...foes], 'random_n', 'output', 2);
  const b = plan(actor, [actor, ...foes], 'random_n', 'output', 2);
  assert.deepEqual(ids(a), ids(b));
});

test('全灭：没有存活敌人时返回空列表（调用方不应继续出手）', () => {
  const actor = tu('a', 4, 100, 'ally');
  const dead = { ...tu('f0', 0, 0), alive: false };
  assert.deepEqual(ids(plan(actor, [actor, dead], 'all', 'output')), []);
});

test('目标一律只取敌对阵营（不会误伤自己人）', () => {
  const actor = tu('a', 4, 100, 'ally');
  const friend = tu('friend', 0, 1, 'ally');
  const foe = tu('foe', 2, 999, 'enemy');
  assert.deepEqual(ids(plan(actor, [actor, friend, foe], 'all', 'output')), ['foe']);
});

/* ══════════════════ ② 战斗倾向 ══════════════════ */

test('★ 优先输出：打最残血（同血量按站位最前）', () => {
  const actor = tu('a', 4, 100, 'ally');
  const foes = [tu('full', 0, 900), tu('low_slot_mid', 1, 100), tu('low_slot_front', 3, 100)];
  const p = plan(actor, [actor, ...foes], 'all', 'output');
  assert.deepEqual(ids(p), ['low_slot_mid', 'low_slot_front', 'full'], '先按血量升序，同血量按站位升序');
});

test('★ 优先连招：优先取与施法者同列的目标', () => {
  const actor = tu('a', 0, 100, 'ally'); // 左列
  const foes = [tu('mid_col', 4, 10), tu('same_col', 3, 900), tu('other_col', 5, 500)];
  const p = plan(actor, [actor, ...foes], 'all', 'combo');
  assert.equal(p.targets[0]!.id, 'same_col', '优先连招应先取同列目标，即使它不是最残血');
});

test('★ 两种倾向必须产生不同的目标序列（否则倾向是假功能）', () => {
  const actor = tu('a', 0, 100, 'ally');
  const foes = [tu('mid_col', 4, 10), tu('same_col', 3, 900)];
  const out = ids(plan(actor, [actor, ...foes], 'all', 'output'));
  const combo = ids(plan(actor, [actor, ...foes], 'all', 'combo'));
  assert.notDeepEqual(out, combo);
  assert.equal(out[0], 'mid_col');
  assert.equal(combo[0], 'same_col');
});

/* ══════════════════ ③ 群体递减（精确比对） ══════════════════ */

test('递减系数公式：max(0.40, 1 − 0.15 × (i − 1))', () => {
  assert.equal(groupDecay(1), 1);
  assert.equal(groupDecay(2), 0.85);
  assert.ok(Math.abs(groupDecay(3) - 0.7) < 1e-9);
  assert.ok(Math.abs(groupDecay(4) - 0.55) < 1e-9);
  assert.equal(groupDecay(5), 0.4);
  assert.equal(groupDecay(9), 0.4, '下限 0.40');
});

test('★ 真实战斗中：多目标伤害按序位精确递减（0.85 / 0.70）', () => {
  // 三个敌人面板完全一致 → 唯一变量只剩"序位"，于是可以精确断言比值
  const attacker = makeUnit({
    id: 'atk',
    slot: 4,
    stats: makeStats({ atk: 500, hit: 1 }),
    skills: [makeSkill({ range: 'all', power: 300, multiplier: 1 })],
  });
  const enemies: BattleUnitConfig[] = [0, 1, 2].map((i) =>
    makeUnit({
      id: `foe_${i}`,
      slot: i as SlotIndex,
      side: 'enemy',
      stats: makeStats({ atk: 1, hpMax: 1_000_000 }),
    }),
  );

  let verified = false;
  for (let seed = 0; seed < 20 && !verified; seed++) {
    const log = simulateBattle({ allies: [attacker], enemies, seed: `decay-${seed}`, maxRounds: 3 });
    const events = log.events;
    for (let j = 0; j < events.length; j++) {
      const ev = events[j]!;
      if (ev.type !== 'act' || ev.range !== 'all') continue;
      const dmg: number[] = [];
      for (let k = j + 1; k < events.length; k++) {
        const e = events[k]!;
        if (e.type === 'act') break;
        if (e.type === 'damage') dmg.push(e.value);
        if (e.type === 'miss') dmg.length = -1; // 出现闪避就不精确了，换一场
      }
      if (dmg.length !== 3) continue;
      const [d1, d2, d3] = dmg as [number, number, number];
      assert.ok(d1 > d2 && d2 > d3, `序位递减必须严格成立：${dmg.join(' / ')}`);
      assert.ok(Math.abs(d2 / d1 - 0.85) < 0.02, `第 2 位应为 0.85 倍，实际 ${(d2 / d1).toFixed(3)}`);
      assert.ok(Math.abs(d3 / d1 - 0.7) < 0.02, `第 3 位应为 0.70 倍，实际 ${(d3 / d1).toFixed(3)}`);
      verified = true;
      break;
    }
  }
  assert.ok(verified, '未能在 20 场中找到一次三目标全命中的 AOE');
});

/* ══════════════════ ④ 出手快照不递补 ══════════════════ */

test('★ 出手快照：受击者只可能来自本次 act 的 targetIds（途中死亡不递补）', () => {
  let acts = 0;
  for (let i = 0; i < 40; i++) {
    const log = simulateBattle({ allies: ALLY_PARTY, enemies: ENEMY_PARTY, seed: `snap-${i}` });
    const events = log.events;
    for (let j = 0; j < events.length; j++) {
      const ev = events[j]!;
      if (ev.type !== 'act') continue;
      acts++;
      const allowed = new Set(ev.targetIds);
      for (let k = j + 1; k < events.length; k++) {
        const e = events[k]!;
        if (e.type === 'act') break;
        if (e.type === 'damage' || e.type === 'miss') {
          assert.ok(allowed.has(e.targetId), `${e.targetId} 被打了却不在 targetIds 里 —— 出现了"死亡递补"`);
        }
      }
    }
  }
  assert.ok(acts > 0, '样本里没有出手');
});

/* ══════════════════ ⑤ 10 型全覆盖 ══════════════════ */

test('★ 10 型范围都能在真实战斗中被触发（不是纸面枚举）', () => {
  const seen = new Set<RangeId>();
  for (let g = 0; g < 2; g++) {
    const slice = RANGE_IDS.slice(g * 5, g * 5 + 5);
    const allies: BattleUnitConfig[] = slice.map((range, i) =>
      makeUnit({
        id: `r_${range}`,
        slot: i as SlotIndex,
        stats: makeStats({ atk: 400 }),
        skills: [makeSkill({ range })],
      }),
    );
    // 敌人铺满前 / 中 / 后排，保证每种区域都有可选目标
    const enemies: BattleUnitConfig[] = [0, 1, 2, 3, 5, 7].map((slot) =>
      makeUnit({
        id: `e${slot}`,
        slot: slot as SlotIndex,
        side: 'enemy',
        stats: makeStats({ atk: 1, hpMax: 1_000_000 }),
      }),
    );
    const log = simulateBattle({ allies, enemies, seed: `showcase-${g}`, maxRounds: 3 });
    for (const e of log.events) {
      if (e.type === 'act') seen.add(e.range);
    }
  }
  assert.deepEqual([...seen].sort(), [...RANGE_IDS].sort(), '有范围型从未被真正触发');
});
