/**
 * 功法表现映射表测试：断言内容量与复用率（这是方案 C 的核心收益，必须被测试守住）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GONGFA_VISUAL,
  GONGFA_VISUAL_BY_ID,
  GONGFA_VISUAL_STATS,
  getGongfaVisual,
  FALLBACK_VISUAL,
  QUALITY_COLOR,
} from '../src/data/gongfa_visual.ts';

test('映射表：恰好 87 门功法（6×11 + 11 + 10）', () => {
  assert.equal(GONGFA_VISUAL.length, 87);
});

test('映射表：分组配比符合 GDD 4.7.2 的内容供给要求', () => {
  const s = GONGFA_VISUAL_STATS.byGroup;
  for (const g of ['dao', 'jian', 'quan', 'anqi', 'qimen', 'qiang', 'neigong'] as const) {
    assert.equal(s[g], 11, `${g} 应为 11 门`);
  }
  assert.equal(s.shenfa, 10, '身法应为 10 门');
});

test('映射表：ID 唯一', () => {
  const ids = GONGFA_VISUAL.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(Object.keys(GONGFA_VISUAL_BY_ID).length, ids.length);
});

test('映射表：每门功法的数值参数都在合法区间', () => {
  for (const g of GONGFA_VISUAL) {
    assert.ok(g.timingScale >= 0.7 && g.timingScale <= 1.5, `${g.id} timingScale=${g.timingScale} 越界`);
    assert.ok(g.hitStopMs >= 0 && g.hitStopMs <= 120, `${g.id} hitStopMs=${g.hitStopMs} 越界`);
    assert.ok([0, 1, 2].includes(g.shake), `${g.id} shake 非法`);
    assert.ok(QUALITY_COLOR[g.quality] !== undefined, `${g.id} 品质无配色`);
  }
});

test('复用率：87 门功法只用到很少的动作与特效模板（方案 C 的核心收益）', () => {
  const s = GONGFA_VISUAL_STATS;
  assert.ok(s.distinctMotions <= 12, `动作原型种类 ${s.distinctMotions} 偏多（应 ≤12）`);
  assert.ok(s.distinctVfx <= 16, `特效模板种类 ${s.distinctVfx} 偏多（应 ≤16）`);
  assert.ok(s.distinctSfx <= 11, `音效模板种类 ${s.distinctSfx} 偏多（应 ≤11）`);
  // 复用倍数：功法数 ÷ 动作种类
  const reuse = s.total / s.distinctMotions;
  assert.ok(reuse >= 7, `动作复用倍数仅 ${reuse.toFixed(1)}×，低于预期`);
});

test('兜底：未映射的功法返回占位表现而不是抛错（保证不阻塞开发）', () => {
  const v = getGongfaVisual('GF_不存在的功法');
  assert.equal(v.id, FALLBACK_VISUAL.id);
  assert.equal(v.motion, 'atk_a');
});

test('品质配比：每类型均为 凡3/良3/上2/极2/绝1（身法 极1）', () => {
  const byGroupQuality = new Map<string, string[]>();
  for (const g of GONGFA_VISUAL) {
    const arr = byGroupQuality.get(g.group) ?? [];
    arr.push(g.quality);
    byGroupQuality.set(g.group, arr);
  }
  for (const [group, qs] of byGroupQuality) {
    const count = (q: string) => qs.filter((x) => x === q).length;
    assert.equal(count('fan'), 3, `${group} 凡品数量`);
    assert.equal(count('liang'), 3, `${group} 良品数量`);
    assert.equal(count('shang'), 2, `${group} 上品数量`);
    assert.equal(count('jue'), 1, `${group} 绝世数量`);
    assert.equal(count('ji'), group === 'shenfa' ? 1 : 2, `${group} 极品数量`);
  }
});

test('关键功法已按设计稿映射（抽查既有设计中出现过的功法）', () => {
  const must = [
    'GF_kuangfeng_dao',
    'GF_duanyue_dao',
    'GF_badao',
    'GF_liuyun_jian',
    'GF_luoxia_jian',
    'GF_luohan_quan',
    'GF_taiji_quan',
    'GF_liuye_dao',
    'GF_baoyu_lihua',
    'GF_judge_bi',
    'GF_shengsi_fu',
    'GF_yangjia_qiang',
    'GF_huima_qiang',
    'GF_dugu_jiujian',
    'GF_jingang_buhuai',
    'GF_chunyang_wuji',
    'GF_xixing_dafa',
    'GF_longxiang_boruo',
    'GF_bingxin_jue',
    'GF_lingbo_weibu',
    'GF_taoxue_wuhen',
    'GF_neigong_jichu',
    'GF_duanhun_dao',
    'GF_qingya_jian',
    'GF_lingyun_jiujian',
  ];
  for (const id of must) {
    assert.ok(GONGFA_VISUAL_BY_ID[id], `缺少设计稿中出现过的功法映射: ${id}`);
  }
});

test('范围与特效匹配：多目标功法必须使用范围型/线型特效模板', () => {
  // 单体模板：slash_arc / thrust_multi / palm_wave / missile_thin / qimen_rune / qimen_seal / aura_body / afterimage
  // 线型模板（可贯穿一列）：slash_heavy / thrust_pierce
  // 范围模板：sweep_row / sweep_wide / missile_multi / palm_burst / aura_ring / ink_splash
  const LINE_OR_AOE = new Set([
    'slash_heavy',
    'thrust_pierce',
    'sweep_row',
    'sweep_wide',
    'missile_multi',
    'palm_burst',
    'aura_ring',
    'ink_splash',
  ]);
  for (const g of GONGFA_VISUAL) {
    if (g.targets === 'row' || g.targets === 'all' || g.targets === 'column') {
      assert.ok(
        LINE_OR_AOE.has(g.vfx),
        `${g.id} 范围=${g.targets} 但特效 ${g.vfx} 不是范围/线型模板`,
      );
    }
  }
});
