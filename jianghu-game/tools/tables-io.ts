/**
 * 配置表读取与校验（工具脚本与测试共用）。
 *
 * 职责：把 data/tables/*.csv 读进来 → 逐行校验 → 跨表校验 → 返回干净的数据。
 * 任何一步发现问题都会给出**精确到行和字段**的报错，而不是让它溜进游戏。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';

import {
  battleSetupRowSchema,
  checkCrossTable,
  skillRowSchema,
  unitRowSchema,
} from '../src/core/config/schema.ts';
import { FORMATIONS } from '../src/data/formations.ts';
import type { BattleSetupRow, SkillRow, TableIssue, UnitRow } from '../src/core/config/schema.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 配置表目录：jianghu-game/data/tables/ */
export const TABLES_DIR = join(HERE, '..', 'data', 'tables');
/** 生成物目录：jianghu-game/src/data/generated/ */
export const GENERATED_DIR = join(HERE, '..', 'src', 'data', 'generated');

/** 读一个 CSV 文件为"对象数组"（首行作字段名） */
function readCsv(name: string): Record<string, string>[] {
  const path = join(TABLES_DIR, name);
  if (!existsSync(path)) {
    throw new Error(`找不到配置表：${path}`);
  }
  return parse(readFileSync(path, 'utf8'), {
    columns: true, // 首行作字段名
    skip_empty_lines: true,
    trim: true,
    bom: true, // 兼容 Excel 另存为 CSV 时写入的 BOM 头
  }) as Record<string, string>[];
}

/** 单表校验结果 */
export interface LoadResult<T> {
  rows: T[];
  issues: TableIssue[];
}

/** 通用：逐行用 schema 校验，把 zod 的错误翻译成"第几行第几列" */
function validateRows<T>(
  file: string,
  raw: Record<string, string>[],
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: unknown } },
): LoadResult<T> {
  const rows: T[] = [];
  const issues: TableIssue[] = [];

  raw.forEach((r, i) => {
    const res = schema.safeParse(r);
    if (res.success && res.data) {
      rows.push(res.data);
      return;
    }
    // 把 zod 的 issues 摊平成一行一条，方便直接定位
    const err = res.error as { issues?: { path: (string | number)[]; message: string }[] };
    for (const iss of err?.issues ?? []) {
      issues.push({
        file,
        row: i + 2, // +2：CSV 第 1 行是表头，数据从第 2 行开始
        field: iss.path.join('.') || '(整行)',
        message: iss.message,
      });
    }
  });

  return { rows, issues };
}

export function loadSkills(): LoadResult<SkillRow> {
  return validateRows<SkillRow>('skills.csv', readCsv('skills.csv'), skillRowSchema);
}

export function loadUnits(): LoadResult<UnitRow> {
  return validateRows<UnitRow>('units.csv', readCsv('units.csv'), unitRowSchema);
}

export function loadBattleSetups(): LoadResult<BattleSetupRow> {
  return validateRows<BattleSetupRow>('battle.csv', readCsv('battle.csv'), battleSetupRowSchema);
}

/** 一次性加载全部表，并做跨表一致性检查 */
export function loadAllTables(): {
  skills: SkillRow[];
  units: UnitRow[];
  battleSetups: BattleSetupRow[];
  issues: TableIssue[];
} {
  const skills = loadSkills();
  const units = loadUnits();
  const battles = loadBattleSetups();

  // 只有单表都通过时，跨表检查才有意义
  const singleOk =
    skills.issues.length === 0 && units.issues.length === 0 && battles.issues.length === 0;

  const issues = [
    ...skills.issues,
    ...units.issues,
    ...battles.issues,
    ...(singleOk
      ? checkCrossTable(
          skills.rows,
          units.rows,
          battles.rows,
          FORMATIONS.map((f) => f.id),
        )
      : []),
  ];
  return { skills: skills.rows, units: units.rows, battleSetups: battles.rows, issues };
}

/** 把校验问题打印成人能直接照做的清单 */
export function printIssues(issues: TableIssue[]): void {
  console.error(`\n✗ 发现 ${issues.length} 个配置表问题：\n`);
  for (const i of issues) {
    const where = i.row > 0 ? `${i.file} 第 ${i.row} 行` : i.file;
    console.error(`  · ${where} 的「${i.field}」：${i.message}`);
  }
  console.error('\n请修改 data/tables/ 下对应的 CSV 后重试。\n');
}
