/**
 * 配置管线测试（node --test，零依赖运行）
 *   node --test tests/tables.test.ts
 *
 * 验证这条链路是通的：
 *   data/tables/*.csv → 校验 → src/data/generated/tables.ts → 运行时配置
 *
 * 重点守住三件事：
 *   ① 表格数据合法（字段范围、跨表引用、站位唯一）
 *   ② 功法威力**由品质 × 境界算出**，不是表里写死的（否则平衡就失去单一改动点）
 *   ③ 表驱动的阵容能真的打起来（回归：与接入配置表之前行为一致）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SKILLS_BY_ID,
  UNITS,
  buildParty,
  describeUnit,
  toSkillConfig,
  toUnitConfig,
  validateTablesAtRuntime,
} from '../src/data/tables.ts';
import { SKILL_ROWS, UNIT_ROWS } from '../src/data/generated/tables.ts';
import { gongfaPower } from '../src/data/gongfa-power.ts';
import { simulateBattle } from '../src/core/battle/simulate.ts';
import { ALLY_PARTY, ENEMY_PARTY } from '../src/data/battle-presets.ts';
import { loadAllTables } from '../tools/tables-io.ts';

/* ══════════════════ 生成物与源表一致 ══════════════════ */

test('★ 生成物与 CSV 源表一致（没有人在中间手工改过数据）', () => {
  const { skills, units, issues } = loadAllTables();
  assert.deepEqual(issues, [], `CSV 源表本身有问题：${JSON.stringify(issues)}`);

  assert.equal(SKILL_ROWS.length, skills.length, '生成的功法条数与 CSV 不一致');
  assert.equal(UNIT_ROWS.length, units.length, '生成的单位条数与 CSV 不一致');

  // 逐字段比对（顺序也要求一致，避免"表格改了但忘了导入"）
  // 注意：先做 JSON 往返归一化 —— 生成时 JSON.stringify 会**省略 undefined 字段**，
  //       而 CSV 解析出的对象里这些键是存在的（值为 undefined）。
  //       直接严格比较会因为这些"空字段"而误报"表格已改动"。
  const norm = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
  assert.deepEqual(norm(SKILL_ROWS), norm(skills), 'skills.csv 已改动，请重新运行 pnpm tables:import');
  assert.deepEqual(norm(UNIT_ROWS), norm(units), 'units.csv 已改动，请重新运行 pnpm tables:import');
});

test('加载页自检：配置表必须全部通过', () => {
  const res = validateTablesAtRuntime();
  assert.deepEqual(
    res.issues.map((i) => `${i.file}#${i.row}.${i.field}: ${i.message}`),
    [],
    '配置表运行时自检未通过',
  );
  assert.equal(res.ok, true);
});

/* ══════════════════ 跨表引用完整性 ══════════════════ */

test('★ 每个单位引用的功法都真实存在', () => {
  for (const u of UNIT_ROWS) {
    assert.ok(SKILLS_BY_ID[u.skillId], `${u.name} 引用了不存在的功法 ${u.skillId}`);
  }
});

test('★ 同阵营站位不重复，且双方都有人', () => {
  for (const side of ['ally', 'enemy'] as const) {
    const list = UNIT_ROWS.filter((u) => u.side === side);
    assert.ok(list.length > 0, `${side} 阵营没有单位`);
    const slots = list.map((u) => u.slot);
    assert.equal(new Set(slots).size, slots.length, `${side} 阵营出现重复站位：${slots.join(',')}`);
  }
});

/* ══════════════════ 威力必须由品质 × 境界算出 ══════════════════ */

test('★ 功法威力来自「品质 × 境界」，不是表里写死的数字', () => {
  for (const row of SKILL_ROWS) {
    const cfg = toSkillConfig(row);
    const expected = gongfaPower(row.quality as never, row.realm);
    assert.equal(
      cfg.power,
      expected,
      `${row.name} 的威力应为 ${expected}（品质 ${row.quality} × 境界 ${row.realm}）`,
    );
    // 反证：表里没有 power 字段，改品质就能改威力
    assert.ok(!('power' in row), `${row.name} 不应在表格里直接写威力`);
  }
});

test('调品质即可改变威力（验证"单一改动点"成立）', () => {
  const base = SKILL_ROWS[0]!;
  const low = toSkillConfig({ ...base, quality: 'fan', realm: 'chujiao' }).power;
  const high = toSkillConfig({ ...base, quality: 'jue', realm: 'tianren' }).power;
  assert.ok(high > low, '高品质高境界的威力必须更大');
  assert.equal(low, 30); // 凡品·初窥门径 = 10 × 1.0 × 3
  assert.equal(high, 1920); // 绝世·天人合一 = 80 × 8.0 × 3
});

/* ══════════════════ 单位转换 ══════════════════ */

test('单位转换：字段完整、站位与武器组正确', () => {
  for (const row of UNIT_ROWS) {
    const cfg = toUnitConfig(row);
    assert.equal(cfg.id, row.id);
    assert.equal(cfg.side, row.side);
    assert.equal(cfg.slot, row.slot);
    assert.equal(cfg.group, row.group);
    assert.equal(cfg.stats.hpMax, row.hpMax);
    assert.equal(cfg.stats.atk, row.atk);
    assert.ok(cfg.skill.id === row.skillId);
  }
});

test('单位转换：引用不存在的功法必须抛错（而不是静默兜底）', () => {
  const bad = { ...UNIT_ROWS[0]!, skillId: 'GF_不存在' };
  assert.throws(() => toUnitConfig(bad), /不存在的功法/);
});

test('buildParty：按站位排序，且只取本阵营', () => {
  const allies = buildParty('ally');
  const enemies = buildParty('enemy');
  assert.equal(allies.length, UNIT_ROWS.filter((u) => u.side === 'ally').length);
  assert.equal(enemies.length, UNIT_ROWS.filter((u) => u.side === 'enemy').length);
  for (const p of [allies, enemies]) {
    for (let i = 1; i < p.length; i++) {
      assert.ok(p[i]!.slot >= p[i - 1]!.slot, '阵容必须按站位升序');
    }
    for (const u of p) assert.ok(u.side === p[0]!.side);
  }
});

test('UNITS 与生成物一致，未引用功法的单位不会漏进来', () => {
  assert.equal(UNITS.length, UNIT_ROWS.length);
  for (const u of UNITS) {
    assert.ok(SKILLS_BY_ID[u.skillId], `${u.name} 的功法缺失`);
  }
});

test('describeUnit 能生成可读文本（战报/调试用）', () => {
  const text = describeUnit(UNIT_ROWS[0]!);
  assert.ok(text.length > 0);
  assert.ok(text.includes(UNIT_ROWS[0]!.name), '描述里应包含单位名');
});

/* ══════════════════ 回归：表驱动阵容能打起来 ══════════════════ */

test('★ 回归：表驱动阵容仍能正常打完一场（接入配置表未破坏战斗）', () => {
  const log = simulateBattle({ allies: ALLY_PARTY, enemies: ENEMY_PARTY, seed: 'tables-regression' });
  assert.ok(['ally', 'enemy', 'draw'].includes(log.winner));
  assert.ok(log.rounds >= 1 && log.rounds <= 30);
  assert.ok(log.stats.totalDamage > 0, '一场打完总伤害不应为 0');
  assert.equal(log.events.at(-1)?.type, 'battleEnd');
});

test('★ 回归：同种子结果仍然确定（配置表化没有破坏确定性）', () => {
  const a = simulateBattle({ allies: ALLY_PARTY, enemies: ENEMY_PARTY, seed: 'det-check' });
  const b = simulateBattle({ allies: ALLY_PARTY, enemies: ENEMY_PARTY, seed: 'det-check' });
  assert.deepEqual(a.events, b.events);
  assert.deepEqual(a.finalHp, b.finalHp);
});

test('★ 改表格 → 改游戏：把剑客攻击力翻倍，战斗结果必须变化', () => {
  const buffed = UNIT_ROWS.map((u) => (u.id === 'ally_jian' ? { ...u, atk: u.atk * 3 } : u));
  const allies = buffed.filter((u) => u.side === 'ally').map(toUnitConfig);
  const enemies = buffed.filter((u) => u.side === 'enemy').map(toUnitConfig);

  const before = simulateBattle({ allies: ALLY_PARTY, enemies: ENEMY_PARTY, seed: 'buff-test' });
  const after = simulateBattle({ allies, enemies, seed: 'buff-test' });

  assert.notDeepEqual(
    after.stats,
    before.stats,
    '把攻击力翻 3 倍后战斗数据竟然没变，说明表格数据没有真正进入战斗',
  );
  assert.ok(
    after.stats.allyDamage > before.stats.allyDamage,
    `攻击力提高后我方总输出应增加：${before.stats.allyDamage} → ${after.stats.allyDamage}`,
  );
});
