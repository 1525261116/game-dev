/**
 * 配置表校验器（不生成任何文件，只检查）
 *
 *   node tools/validate-tables.ts     （或 pnpm tables:validate）
 *
 * 用途：① 改完表格先跑一遍，确认没问题再导入
 *      ② CI 里跑，防止有人提交了坏表格
 */
import { loadAllTables, printIssues } from './tables-io.ts';

function main(): void {
  console.log('=== 配置表校验 ===');

  const { skills, units, issues } = loadAllTables();

  console.log(`  skills.csv：${skills.length} 行`);
  console.log(`  units.csv ：${units.length} 行`);

  if (issues.length > 0) {
    printIssues(issues);
    process.exitCode = 1;
    return;
  }

  // 通过时也给一点"数值可见性"，方便你核对改成什么样了
  console.log('');
  console.log('✓ 全部通过（单表字段 + 跨表引用 + 站位唯一性 + 范围×倍率矩阵）');
  console.log('');
  console.log('功法一览：');
  for (const s of skills) {
    const st = s.statusId ? `＋${s.statusId}(${Math.round((s.statusChance ?? 0) * 100)}%)` : '';
    const combo = `连招${s.stanceStart ?? 1}/${s.stanceEnd ?? 1}`;
    const rnd = s.range === 'random_n' ? `(N=${s.randomCount ?? 3})` : '';
    console.log(
      `  · ${s.id.padEnd(20)} ${s.name.padEnd(6)} ${s.quality}·${s.realm}  ×${s.multiplier}  ${s.range}${rnd}  ${combo} ${st}`,
    );
  }
  console.log('');
  console.log('单位一览：');
  for (const u of units) {
    const loadout = [u.skillId, u.skillIdB, u.skillIdC].filter(Boolean).join(' + ');
    console.log(
      `  · ${u.id.padEnd(14)} ${u.name.padEnd(5)} ${u.side.padEnd(6)} 站位${u.slot} 气血${u.hpMax} 攻${u.atk} 防${u.def} 速${u.spd} 内息${u.breath} 套路[${loadout}]`,
    );
  }
}

main();
