/**
 * 配置表导入器
 *
 *   node tools/import-tables.ts       （或 pnpm tables:import）
 *
 * 流程：
 *   data/tables/*.csv  →  逐行校验 + 跨表校验  →  src/data/generated/tables.ts
 *
 * 为什么要生成一个 .ts 文件，而不是运行时读 CSV？
 *   ① 浏览器里读 CSV 要多一次网络请求 + 解析，手机上会拖慢启动
 *   ② 生成成 TS 后它会被直接打进包里，加载即用，还带类型提示
 *   ③ 生成物在 git 里可见，数值改动一眼就能在 diff 里看到
 *
 * 校验不通过时**不会写盘**，避免把坏数据带进游戏。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { GENERATED_DIR, loadAllTables, printIssues } from './tables-io.ts';

function main(): void {
  console.log('=== 配置表导入 ===');
  console.log(`数据源：${join('data', 'tables')}`);

  const { skills, units, battleSetups, issues } = loadAllTables();

  console.log(`  skills.csv：读到 ${skills.length} 行有效数据`);
  console.log(`  units.csv ：读到 ${units.length} 行有效数据`);
  console.log(`  battle.csv：读到 ${battleSetups.length} 行有效数据`);

  if (issues.length > 0) {
    printIssues(issues);
    process.exitCode = 1;
    return;
  }

  // 生成 TS：注意不写入生成时间，否则每次导入都会产生无意义的 diff
  const header = [
    '/**',
    ' * ⚠️ 本文件由 tools/import-tables.ts 自动生成，**请勿手工修改**。',
    ' *',
    ' * 要改数值，请编辑 data/tables/*.csv 后运行：pnpm tables:import',
    ' * 直接改本文件会在下次导入时被覆盖。',
    ' */',
    "import type { BattleSetupRow, SkillRow, UnitRow } from '../../core/config/schema.ts';",
    '',
  ].join('\n');

  const body = [
    '/** 功法表（来自 data/tables/skills.csv） */',
    `export const SKILL_ROWS: SkillRow[] = ${JSON.stringify(skills, null, 2)};`,
    '',
    '/** 单位表（来自 data/tables/units.csv） */',
    `export const UNIT_ROWS: UnitRow[] = ${JSON.stringify(units, null, 2)};`,
    '',
    '/** 对战配置（来自 data/tables/battle.csv） */',
    `export const BATTLE_SETUP_ROWS: BattleSetupRow[] = ${JSON.stringify(battleSetups, null, 2)};`,
    '',
  ].join('\n');

  mkdirSync(GENERATED_DIR, { recursive: true });
  const outPath = join(GENERATED_DIR, 'tables.ts');
  writeFileSync(outPath, header + body, 'utf8');

  console.log('');
  console.log(`✓ 已生成 ${outPath}`);
  console.log(`  功法 ${skills.length} 条 ／ 单位 ${units.length} 条`);
  console.log('');
  console.log('下一步：跑 pnpm tables:validate 复核，或直接 pnpm dev 看效果。');
}

main();
