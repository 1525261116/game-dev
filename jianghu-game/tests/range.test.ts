/**
 * 10 型攻击范围测试（node --test，零依赖运行）
 *   node --test tests/range.test.ts
 *
 * 口径：jianghu-design/05_combat/功法系统.md §6.5
 *
 * 这组测试守住三件事：
 *   ① 10 型枚举与设计文档逐行一致（数量 × 区域双轴）
 *   ② 动态十字的格数（角 3 / 边 4 / 中 5）与"不取对角"
 *   ③ 10 型 → 表现层 6 种形状的换算（§6.5.8）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_RANDOM_COUNT,
  RANDOM_COUNT_RANGE,
  RANGE_IDS,
  RANGE_NAME,
  RANGE_TABLE,
  areaSlots,
  crossSlots,
  densestColumn,
  isRangeId,
  rangeTargetCap,
  rowFallbackOrder,
  toVisualShape,
} from '../src/core/battle/range.ts';
import { ALL_SLOTS } from '../src/core/battle/types.ts';
import type { SlotIndex } from '../src/core/battle/types.ts';

/* ══════════════════ 枚举完整性 ══════════════════ */

test('范围：恰好 10 型，id 与设计文档一致', () => {
  assert.equal(RANGE_IDS.length, 10);
  assert.deepEqual([...RANGE_IDS], [
    'single_any',
    'single_front',
    'single_back',
    'all',
    'row_front',
    'row_mid',
    'row_back',
    'column',
    'cross',
    'random_n',
  ]);
  for (const id of RANGE_IDS) {
    assert.ok(RANGE_TABLE[id], `${id} 缺少 (count, area) 定义`);
    assert.ok(RANGE_NAME[id], `${id} 缺少中文名`);
    assert.equal(isRangeId(id), true);
  }
  assert.equal(isRangeId('single_mid'), false, '文档里没有 single_mid，不应被当成合法范围');
});

test('范围：每一型的 数量 × 区域 必须与 §6.5.2 表格一致', () => {
  const expected: Record<string, { count: string; area: string }> = {
    single_any: { count: '1', area: 'any' },
    single_front: { count: '1', area: 'front' },
    single_back: { count: '1', area: 'back' },
    all: { count: 'all', area: 'all' },
    row_front: { count: 'all', area: 'front' },
    row_mid: { count: 'all', area: 'mid' },
    row_back: { count: 'all', area: 'back' },
    column: { count: 'all', area: 'column' },
    cross: { count: 'all', area: 'cross' },
    random_n: { count: 'n', area: 'any' },
  };
  for (const [id, spec] of Object.entries(expected)) {
    assert.deepEqual(RANGE_TABLE[id as keyof typeof RANGE_TABLE], spec, `${id} 的双轴定义错误`);
  }
});

/* ══════════════════ 目标上限 C ══════════════════ */

test('目标上限 C：单体 1 / 随机 N 取 N 并钳到存活数 / 区域全部取满', () => {
  assert.equal(rangeTargetCap('single_any', 5), 1);
  assert.equal(rangeTargetCap('single_front', 3), 1);
  assert.equal(rangeTargetCap('all', 4), 4);
  assert.equal(rangeTargetCap('row_front', 2), 2);
  assert.equal(rangeTargetCap('random_n', 9, 3), 3);
  assert.equal(rangeTargetCap('random_n', 9, 4), 4);
  // 存活数不足 → N := 存活数（§6.5.7 边界处理）
  assert.equal(rangeTargetCap('random_n', 2, 4), 2);
  // 未指定 N → 默认 3，且默认值必须落在 {2,3,4} 内
  assert.equal(rangeTargetCap('random_n', 9), DEFAULT_RANDOM_COUNT);
  assert.ok(DEFAULT_RANDOM_COUNT >= RANDOM_COUNT_RANGE.min && DEFAULT_RANDOM_COUNT <= RANDOM_COUNT_RANGE.max);
});

/* ══════════════════ 动态十字 ══════════════════ */

test('★ 动态十字：角 3 格 / 边中 4 格 / 正中 5 格（§6.5.3 ①）', () => {
  // 角：0（前·左）→ {0,1,3}
  assert.deepEqual([...crossSlots(0)].sort((a, b) => a - b), [0, 1, 3]);
  // 边中：1（前·中）→ {1,0,2,4}
  assert.deepEqual([...crossSlots(1)].sort((a, b) => a - b), [0, 1, 2, 4]);
  // 正中：4（中·中）→ {4,1,3,5,7}
  assert.deepEqual([...crossSlots(4)].sort((a, b) => a - b), [1, 3, 4, 5, 7]);
  // 另一角：8（后·右）→ {8,5,7}
  assert.deepEqual([...crossSlots(8)].sort((a, b) => a - b), [5, 7, 8]);
});

test('★ 十字不取对角（否则会变成 5~9 格的范围大招）', () => {
  for (const center of ALL_SLOTS) {
    const cells = crossSlots(center);
    const r = Math.floor(center / 3);
    const c = center % 3;
    for (const cell of cells) {
      const dr = Math.abs(Math.floor(cell / 3) - r);
      const dc = Math.abs((cell % 3) - c);
      assert.ok(dr + dc <= 1, `格子 ${cell} 与中心 ${center} 是对角/远距离，不该出现在十字里`);
    }
  }
});

/* ══════════════════ 区域格集合 ══════════════════ */

test('区域格集合：排 / 列 / 全体与九宫格定义一致', () => {
  assert.deepEqual([...areaSlots('front')], [0, 1, 2]);
  assert.deepEqual([...areaSlots('mid')], [3, 4, 5]);
  assert.deepEqual([...areaSlots('back')], [6, 7, 8]);
  assert.deepEqual([...areaSlots('column', 0)], [0, 3, 6], '左列 = 0/3/6');
  assert.deepEqual([...areaSlots('column', 2)], [2, 5, 8], '右列 = 2/5/8');
  assert.deepEqual([...areaSlots('any')], [...ALL_SLOTS]);
  assert.deepEqual([...areaSlots('all')], [...ALL_SLOTS]);
  assert.deepEqual([...areaSlots('cross', 4)].sort((a, b) => a - b), [1, 3, 4, 5, 7]);
});

test('就近回退顺序：前排→中排→后排，后排→中排→前排（§6.5.7）', () => {
  assert.deepEqual([...rowFallbackOrder('front')], ['front', 'mid', 'back']);
  assert.deepEqual([...rowFallbackOrder('back')], ['back', 'mid', 'front']);
  assert.deepEqual([...rowFallbackOrder('mid')], ['mid', 'front', 'back']);
});

test('整列候选：取存活敌人最密集的列，同分取更靠前的列', () => {
  // 左列 2 人（0,3）> 中列 1 人（4）= 右列 1 人（5）→ left
  assert.equal(densestColumn([0, 3, 4, 5] as SlotIndex[]), 'left');
  // 中列 2 人（1,4）> 左列 1（0）、右列 1（5）→ center
  assert.equal(densestColumn([0, 1, 4, 5] as SlotIndex[]), 'center');
  // 三列各 1 人 → 同分，取更靠前的列（列内最小站位更小）→ left
  assert.equal(densestColumn([0, 1, 2] as SlotIndex[]), 'left');
  assert.equal(densestColumn([2, 4, 7] as SlotIndex[]), 'center', '中列(4) 比右列(7) 更靠前');
});

/* ══════════════════ 与表现层对齐 ══════════════════ */

test('10 型 → 表现形状：只需 6 种形状就能覆盖全部（§6.5.8）', () => {
  const shapes = new Set(RANGE_IDS.map((id) => toVisualShape(id)));
  assert.deepEqual([...shapes].sort(), ['all', 'column', 'row', 'single']);
  assert.equal(toVisualShape('single_any'), 'single');
  assert.equal(toVisualShape('single_front'), 'single', '单体前排也是"打 1 个人"');
  assert.equal(toVisualShape('single_back'), 'single');
  assert.equal(toVisualShape('row_front'), 'row');
  assert.equal(toVisualShape('row_mid'), 'row');
  assert.equal(toVisualShape('row_back'), 'row');
  assert.equal(toVisualShape('column'), 'column');
  assert.equal(toVisualShape('all'), 'all');
  assert.equal(toVisualShape('cross'), 'single', '十字暂用 single 形状，以 anchor 播放');
  assert.equal(toVisualShape('random_n'), 'row', '随机 N 用散射表现');
});
