/**
 * 配置表导出器：TypeScript 数据源 → 引擎中立 JSON
 *
 *   node tools/export-tables.ts
 *
 * 产出（供 Godot 工程直接读取）：
 *   ../jianghu-godot/src/data/tables/formations.json    12 个阵法
 *   ../jianghu-godot/src/data/tables/status.json        22 种状态
 *   ../jianghu-godot/src/data/tables/gongfa_visual.json 87 门功法表现映射
 *
 * 设计意图：**数据是引擎中立的**。TS 与 GDScript 都能读同一份 JSON，
 * 因此「换引擎」的代价只落在代码，不落在内容（GDD 4.7.2 的数据契约）。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FORMATIONS } from '../src/data/formations.ts';
import { STATUS_DEFS } from '../src/data/status.ts';
import { GONGFA_VISUAL } from '../src/data/gongfa_visual.ts';
import { ROSTER_TIERS, PARTY_SCALE_BASE } from '../src/core/battle/types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', '..', 'jianghu-godot', 'src', 'data', 'tables');

mkdirSync(OUT_DIR, { recursive: true });

/** 统一写出：稳定字段顺序（便于 git diff），并统计 */
function writeTable(name: string, rows: unknown[]): void {
  const path = join(OUT_DIR, `${name}.json`);
  writeFileSync(path, JSON.stringify(rows, null, 2) + '\n', 'utf8');
  console.log(`[ok] ${name}.json  ${rows.length} 行  → ${path}`);
}

writeTable('formations', FORMATIONS as unknown[]);
writeTable('status', STATUS_DEFS as unknown[]);
writeTable('gongfa_visual', GONGFA_VISUAL as unknown[]);
writeTable(
  'roster_tiers',
  ROSTER_TIERS.map((t) => ({ id: `roster_${t.members}`, ...t })),
);
writeTable('battle_constants', [
  { id: 'party_scale_base', value: PARTY_SCALE_BASE, note: '编队系数基准人数' },
  { id: 'party_scale_3', value: 0.75, note: '3 人编队' },
  { id: 'party_scale_4', value: 1.0, note: '4 人编队（基准）' },
  { id: 'party_scale_5', value: 1.25, note: '5 人编队' },
  { id: 'party_scale_6', value: 1.5, note: '6 人编队（门派战）' },
  { id: 'max_rounds', value: 30, note: '回合上限，超出判负' },
  { id: 'crit_rate_cap', value: 0.75, note: '暴击率上限' },
  { id: 'crit_damage_cap', value: 3.0, note: '暴击伤害上限' },
  { id: 'dodge_cap', value: 0.6, note: '闪避上限' },
  { id: 'hit_min', value: 0.05, note: '命中下限' },
  { id: 'hit_max', value: 0.95, note: '命中上限' },
  { id: 'defense_constant', value: 150, note: '防御减伤常数' },
  { id: 'damage_bonus_cap', value: 0.6, note: '增伤总上限' },
  { id: 'damage_reduction_cap', value: 0.9, note: '减伤总上限' },
]);

console.log(`\n导出完成：5 张表 → ${OUT_DIR}`);
