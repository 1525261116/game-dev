/**
 * 功法表现映射表（87 门功法）
 *
 * 设计原则（见 12_tech/动画复用方案_v1.0.md）：
 *   **功法只描述「差异」，不描述「动作」**。动作由武器类型（group）决定，全角色共用。
 *   因此新增一门功法 = 在本表加一行 = 10 分钟，不需要任何新动画。
 *
 * 大表结构（87 行）：
 *   6 外功类型 × 11 门 = 66 　+ 内功 11 门 + 身法 10 门 = 87
 *   每类型配比：凡 3 / 良 3 / 上 2 / 极 2 / 绝 1（身法为 凡 3 / 良 3 / 上 2 / 极 1 / 绝 1）
 *
 * 品质 → 特效配色：凡灰白 / 良青碧 / 上靛蓝 / 极暗金 / 绝赤金
 */
import type { MotionArchetype, MotionGroup } from '../core/anim/types.ts';

export type Quality = 'fan' | 'liang' | 'shang' | 'ji' | 'jue';
export type TargetShape = 'single' | 'column' | 'row' | 'all';
export type VfxId =
  | 'slash_arc'
  | 'slash_heavy'
  | 'thrust_multi'
  | 'thrust_pierce'
  | 'palm_wave'
  | 'palm_burst'
  | 'aura_ring'
  | 'aura_body'
  | 'missile_thin'
  | 'missile_multi'
  | 'qimen_rune'
  | 'qimen_seal'
  | 'sweep_row'
  | 'sweep_wide'
  | 'afterimage'
  | 'ink_splash';

export type SfxId =
  | 'swing_light'
  | 'swing_heavy'
  | 'thrust'
  | 'palm'
  | 'throw'
  | 'rune'
  | 'sweep'
  | 'aura'
  | 'dash'
  | 'impact'
  | 'charge';

export interface GongfaVisual {
  /** 功法 ID（与 skill_gongfa 表主键一致） */
  id: string;
  /** 显示名（便于策划核对） */
  name: string;
  /** 武器/功法类型组 */
  group: MotionGroup;
  /** 动作原型（决定播哪个共用 clip） */
  motion: MotionArchetype;
  /** 特效模板 */
  vfx: VfxId;
  /** 时序倍率：<1 更慢更重，>1 更快更轻 */
  timingScale: number;
  /** 命中停顿（ms，0~120） */
  hitStopMs: number;
  /** 屏幕震动：0 无 / 1 轻 / 2 重 */
  shake: 0 | 1 | 2;
  /** 音效模板 */
  sfx: SfxId;
  /** 打击范围（决定特效形状与目标筛选） */
  targets: TargetShape;
  /** 品质 */
  quality: Quality;
}

/** 品质 → 主色（零成本的辨识度手段） */
export const QUALITY_COLOR: Record<Quality, number> = {
  fan: 0xd8d8d8, // 灰白
  liang: 0x4fb3a5, // 青碧
  shang: 0x4a6fd4, // 靛蓝
  ji: 0xc79a3a, // 暗金
  jue: 0xe8b23c, // 赤金
};

export const QUALITY_LABEL: Record<Quality, string> = {
  fan: '凡品',
  liang: '良品',
  shang: '上品',
  ji: '极品',
  jue: '绝世',
};

/** 品质附加表现层级（0 无 → 4 最华丽） */
export const QUALITY_VFX_TIER: Record<Quality, 0 | 1 | 2 | 3 | 4> = {
  fan: 0,
  liang: 1,
  shang: 2,
  ji: 3,
  jue: 4,
};

/* ------------------------------------------------------------------ 87 行数据 */

/** [id, 名称, 动作, 特效, 时序, 停顿ms, 震动, 音效, 范围, 品质] */
type Row = [
  string,
  string,
  MotionArchetype,
  VfxId,
  number,
  number,
  0 | 1 | 2,
  SfxId,
  TargetShape,
  Quality,
];

const DAO: Row[] = [
  ['GF_dao_jichu', '基础刀法', 'atk_a', 'slash_arc', 1.0, 30, 0, 'swing_light', 'single', 'fan'],
  ['GF_liuye_dao', '柳叶刀', 'atk_a', 'slash_arc', 1.25, 20, 0, 'swing_light', 'single', 'fan'],
  ['GF_kuangfeng_dao', '狂风刀法', 'cast', 'slash_arc', 1.15, 40, 1, 'swing_light', 'single', 'fan'],
  ['GF_duanyue_dao', '断岳刀法', 'atk_b', 'slash_heavy', 0.85, 90, 2, 'swing_heavy', 'column', 'liang'],
  ['GF_duanhun_dao', '断魂刀法', 'atk_b', 'slash_heavy', 0.9, 80, 1, 'swing_heavy', 'single', 'liang'],
  ['GF_jifeng_dao', '疾风刀法', 'atk_a', 'thrust_multi', 1.3, 25, 0, 'swing_light', 'single', 'liang'],
  ['GF_lieshi_dao', '裂石刀法', 'atk_b', 'slash_heavy', 0.8, 100, 2, 'swing_heavy', 'single', 'shang'],
  ['GF_jinghong_dao', '惊鸿刀法', 'cast', 'sweep_wide', 1.1, 50, 1, 'sweep', 'row', 'shang'],
  ['GF_badao', '霸刀', 'atk_b', 'slash_heavy', 0.75, 120, 2, 'swing_heavy', 'all', 'ji'],
  ['GF_xuezhan_shishi', '血战十式', 'cast', 'ink_splash', 0.9, 90, 2, 'impact', 'all', 'ji'],
  ['GF_tiandao_bajue', '天刀八诀', 'cast', 'ink_splash', 0.85, 110, 2, 'impact', 'row', 'jue'],
];

const JIAN: Row[] = [
  ['GF_jian_jichu', '基础剑法', 'atk_a', 'thrust_multi', 1.0, 25, 0, 'thrust', 'single', 'fan'],
  ['GF_qingfeng_jian', '青锋剑法', 'atk_a', 'thrust_multi', 1.15, 20, 0, 'thrust', 'single', 'fan'],
  ['GF_liuyun_jian', '流云剑法', 'atk_a', 'thrust_multi', 1.3, 30, 0, 'thrust', 'single', 'fan'],
  ['GF_luoxia_jian', '落霞剑法', 'cast', 'slash_heavy', 1.0, 50, 1, 'swing_light', 'column', 'liang'],
  ['GF_songfeng_jian', '松风剑法', 'atk_a', 'thrust_multi', 1.2, 25, 0, 'thrust', 'single', 'liang'],
  ['GF_baihong_jian', '白虹剑法', 'atk_b', 'thrust_pierce', 1.05, 55, 1, 'thrust', 'column', 'liang'],
  ['GF_qingya_jian', '青崖剑法', 'atk_b', 'thrust_pierce', 0.95, 60, 1, 'thrust', 'single', 'shang'],
  ['GF_liangyi_jian', '两仪剑法', 'cast', 'missile_multi', 1.1, 45, 1, 'thrust', 'row', 'shang'],
  ['GF_lingyun_jiujian', '凌云九剑', 'cast', 'sweep_wide', 1.0, 70, 2, 'sweep', 'row', 'ji'],
  ['GF_dugu_jiujian', '独孤九剑', 'cast', 'thrust_pierce', 1.15, 65, 2, 'thrust', 'single', 'ji'],
  ['GF_taixu_jianyi', '太虚剑意', 'cast', 'ink_splash', 0.95, 100, 2, 'impact', 'all', 'jue'],
];

const QUAN: Row[] = [
  ['GF_quan_jichu', '基础拳法', 'atk_a', 'palm_wave', 1.0, 35, 0, 'palm', 'single', 'fan'],
  ['GF_luohan_quan', '罗汉拳', 'atk_a', 'palm_wave', 1.05, 45, 1, 'palm', 'single', 'fan'],
  ['GF_changquan', '长拳', 'atk_a', 'palm_wave', 1.15, 25, 0, 'palm', 'single', 'fan'],
  ['GF_taiji_quan', '太极拳', 'cast', 'aura_ring', 1.2, 30, 1, 'aura', 'single', 'liang'],
  ['GF_fuhu_quan', '伏虎拳', 'atk_b', 'palm_burst', 0.9, 70, 2, 'impact', 'single', 'liang'],
  ['GF_tongbi_quan', '通臂拳', 'atk_b', 'palm_burst', 0.95, 60, 1, 'impact', 'column', 'liang'],
  ['GF_boruo_zhang', '般若掌', 'cast', 'palm_burst', 1.0, 60, 1, 'palm', 'row', 'shang'],
  ['GF_cuixin_zhang', '摧心掌', 'cast', 'palm_burst', 1.1, 55, 1, 'palm', 'single', 'shang'],
  ['GF_xianglong_zhang', '降龙十八掌', 'cast', 'palm_burst', 0.9, 100, 2, 'impact', 'row', 'ji'],
  ['GF_anran_zhang', '黯然销魂掌', 'cast', 'ink_splash', 1.05, 90, 2, 'impact', 'all', 'ji'],
  ['GF_rulai_shenzhang', '如来神掌', 'cast', 'ink_splash', 0.8, 120, 2, 'impact', 'all', 'jue'],
];

const ANQI: Row[] = [
  ['GF_anqi_jichu', '基础暗器', 'atk_a', 'missile_thin', 1.1, 15, 0, 'throw', 'single', 'fan'],
  ['GF_feihuang_shi', '飞蝗石', 'atk_a', 'missile_multi', 1.2, 15, 0, 'throw', 'single', 'fan'],
  ['GF_liuye_feidao', '柳叶飞刀', 'atk_a', 'missile_thin', 1.3, 20, 0, 'throw', 'single', 'fan'],
  ['GF_baoyu_lihua', '暴雨梨花针', 'cast', 'missile_multi', 1.1, 40, 1, 'throw', 'row', 'liang'],
  ['GF_xiujian', '袖箭', 'atk_a', 'missile_thin', 1.35, 15, 0, 'throw', 'single', 'liang'],
  ['GF_tiejili', '铁蒺藜', 'atk_a', 'missile_multi', 1.15, 25, 0, 'throw', 'column', 'liang'],
  ['GF_mantian_huayu', '满天花雨', 'cast', 'missile_multi', 1.0, 50, 1, 'throw', 'all', 'shang'],
  ['GF_zhuihen_biao', '追魂镖', 'cast', 'missile_thin', 1.2, 45, 1, 'throw', 'single', 'shang'],
  ['GF_yanwang_tie', '阎王帖', 'cast', 'qimen_seal', 0.95, 70, 2, 'rune', 'single', 'ji'],
  ['GF_tianjue_biao', '天绝镖', 'cast', 'missile_multi', 0.9, 80, 2, 'impact', 'row', 'ji'],
  ['GF_wanliu_guizong', '万流归宗', 'cast', 'ink_splash', 0.85, 110, 2, 'impact', 'all', 'jue'],
];

const QIMEN: Row[] = [
  ['GF_qimen_jichu', '基础奇门', 'atk_a', 'qimen_rune', 1.0, 30, 0, 'rune', 'single', 'fan'],
  ['GF_judge_bi', '判官笔', 'atk_a', 'qimen_rune', 1.0, 45, 0, 'rune', 'single', 'fan'],
  ['GF_tieshan_gong', '铁扇功', 'atk_a', 'sweep_row', 1.1, 30, 0, 'sweep', 'column', 'fan'],
  ['GF_shengsi_fu', '生死符', 'cast', 'qimen_seal', 1.25, 60, 1, 'rune', 'single', 'liang'],
  ['GF_shehun_ling', '摄魂铃', 'cast', 'aura_ring', 1.05, 50, 1, 'rune', 'row', 'liang'],
  ['GF_xuantie_ling', '玄铁令', 'atk_b', 'sweep_row', 0.9, 70, 2, 'impact', 'column', 'liang'],
  ['GF_yinyang_daoluan', '阴阳倒乱刃', 'cast', 'sweep_wide', 1.0, 55, 1, 'sweep', 'row', 'shang'],
  ['GF_wuxing_lun', '五行轮', 'cast', 'ink_splash', 1.1, 50, 1, 'rune', 'all', 'shang'],
  ['GF_tianji_baibian', '天机百变', 'cast', 'sweep_wide', 0.95, 80, 2, 'impact', 'all', 'ji'],
  ['GF_shengsi_fu_jue', '生死符·绝', 'cast', 'qimen_seal', 0.9, 90, 2, 'rune', 'single', 'ji'],
  ['GF_wanfa_guiyuan', '万法归元', 'cast', 'ink_splash', 0.85, 120, 2, 'impact', 'all', 'jue'],
];

const QIANG: Row[] = [
  ['GF_qiang_jichu', '基础枪法', 'atk_a', 'thrust_pierce', 1.0, 35, 0, 'thrust', 'single', 'fan'],
  ['GF_yangjia_qiang', '杨家枪法', 'sweep', 'sweep_row', 1.0, 50, 1, 'sweep', 'row', 'fan'],
  ['GF_baila_gan', '白蜡杆', 'atk_a', 'thrust_pierce', 1.1, 25, 0, 'thrust', 'single', 'fan'],
  ['GF_huima_qiang', '回马枪', 'atk_b', 'thrust_pierce', 0.9, 80, 2, 'thrust', 'single', 'liang'],
  ['GF_lihua_qiang', '梨花枪', 'sweep', 'sweep_row', 1.05, 45, 1, 'sweep', 'row', 'liang'],
  ['GF_tieqiang_jue', '铁枪诀', 'atk_b', 'thrust_pierce', 0.95, 60, 1, 'thrust', 'column', 'liang'],
  ['GF_wuhu_duanmen', '五虎断门枪', 'sweep', 'sweep_wide', 0.9, 70, 2, 'sweep', 'row', 'shang'],
  ['GF_bawang_qiang', '霸王枪', 'atk_b', 'thrust_pierce', 0.85, 90, 2, 'impact', 'column', 'shang'],
  ['GF_yuejia_qiang', '岳家枪', 'sweep', 'sweep_wide', 0.95, 80, 2, 'sweep', 'all', 'ji'],
  ['GF_pojun_qiang', '破军枪', 'cast', 'sweep_wide', 0.9, 90, 2, 'impact', 'row', 'ji'],
  ['GF_longdan_qiang', '龙胆亮银枪', 'cast', 'ink_splash', 0.8, 120, 2, 'impact', 'all', 'jue'],
];

const NEIGONG: Row[] = [
  ['GF_neigong_jichu', '基础内功', 'aura', 'aura_body', 1.0, 0, 0, 'aura', 'single', 'fan'],
  ['GF_tuna_fa', '吐纳法', 'meditate', 'aura_body', 1.0, 0, 0, 'aura', 'single', 'fan'],
  ['GF_yangsheng_jue', '养生诀', 'meditate', 'aura_body', 1.0, 0, 0, 'aura', 'single', 'fan'],
  ['GF_bingxin_jue', '冰心诀', 'cast', 'aura_ring', 1.1, 0, 0, 'aura', 'single', 'liang'],
  ['GF_hunyuan_gong', '混元功', 'aura', 'aura_body', 1.0, 0, 0, 'aura', 'single', 'liang'],
  ['GF_xiaowuxiang', '小无相功', 'cast', 'aura_ring', 1.05, 0, 0, 'aura', 'single', 'liang'],
  ['GF_jingang_buhuai', '金刚不坏体', 'aura', 'aura_body', 0.95, 0, 0, 'aura', 'single', 'shang'],
  ['GF_chunyang_wuji', '纯阳无极功', 'aura', 'aura_body', 1.0, 0, 0, 'aura', 'single', 'shang'],
  ['GF_xixing_dafa', '吸星大法', 'cast', 'ink_splash', 1.1, 40, 1, 'aura', 'row', 'ji'],
  ['GF_longxiang_boruo', '龙象般若功', 'cast', 'aura_ring', 0.9, 60, 2, 'impact', 'all', 'ji'],
  ['GF_taixuan_jing', '太玄经', 'cast', 'ink_splash', 0.85, 80, 2, 'impact', 'all', 'jue'],
];

const SHENFA: Row[] = [
  ['GF_shenfa_jichu', '基础轻功', 'dash', 'afterimage', 1.0, 0, 0, 'dash', 'single', 'fan'],
  ['GF_tizong_shu', '提纵术', 'leap', 'afterimage', 1.05, 0, 0, 'dash', 'single', 'fan'],
  ['GF_tiebushan_qinggong', '铁布衫轻功', 'dash', 'aura_body', 0.95, 0, 0, 'dash', 'single', 'fan'],
  ['GF_taoxue_wuhen', '踏雪无痕', 'dash', 'afterimage', 1.15, 0, 0, 'dash', 'single', 'liang'],
  ['GF_yanzi_sanchaoshui', '燕子三抄水', 'leap', 'afterimage', 1.2, 0, 0, 'dash', 'single', 'liang'],
  ['GF_jifeng_bu', '疾风步', 'dash', 'afterimage', 1.25, 0, 0, 'dash', 'single', 'liang'],
  ['GF_lingbo_weibu', '凌波微步', 'dash', 'afterimage', 1.3, 0, 0, 'dash', 'single', 'shang'],
  ['GF_babu_ganchan', '八步赶蝉', 'leap', 'afterimage', 1.2, 0, 0, 'dash', 'single', 'shang'],
  ['GF_shenxing_baibian', '神行百变', 'vanish', 'afterimage', 1.35, 0, 0, 'dash', 'single', 'ji'],
  ['GF_xiaoyao_yufeng', '逍遥御风', 'vanish', 'ink_splash', 1.4, 0, 0, 'dash', 'single', 'jue'],
];

const GROUPS: [MotionGroup, Row[]][] = [
  ['dao', DAO],
  ['jian', JIAN],
  ['quan', QUAN],
  ['anqi', ANQI],
  ['qimen', QIMEN],
  ['qiang', QIANG],
  ['neigong', NEIGONG],
  ['shenfa', SHENFA],
];

function build(): GongfaVisual[] {
  const out: GongfaVisual[] = [];
  for (const [group, rows] of GROUPS) {
    for (const r of rows) {
      const [id, name, motion, vfx, timingScale, hitStopMs, shake, sfx, targets, quality] = r;
      out.push({ id, name, group, motion, vfx, timingScale, hitStopMs, shake, sfx, targets, quality });
    }
  }
  return out;
}

export const GONGFA_VISUAL: GongfaVisual[] = build();

export const GONGFA_VISUAL_BY_ID: Record<string, GongfaVisual> = Object.fromEntries(
  GONGFA_VISUAL.map((g) => [g.id, g]),
);

/** 缺失映射时的兜底（绝不崩溃） */
export const FALLBACK_VISUAL: GongfaVisual = {
  id: '__fallback__',
  name: '未映射功法',
  group: 'dao',
  motion: 'atk_a',
  vfx: 'slash_arc',
  timingScale: 1,
  hitStopMs: 30,
  shake: 0,
  sfx: 'swing_light',
  targets: 'single',
  quality: 'fan',
};

export function getGongfaVisual(id: string): GongfaVisual {
  return GONGFA_VISUAL_BY_ID[id] ?? FALLBACK_VISUAL;
}

/** 统计（供校验脚本与测试断言内容量） */
export const GONGFA_VISUAL_STATS = {
  total: GONGFA_VISUAL.length,
  byGroup: Object.fromEntries(
    GROUPS.map(([g, rows]) => [g, rows.length]),
  ) as Record<MotionGroup, number>,
  byQuality: GONGFA_VISUAL.reduce<Record<string, number>>((acc, g) => {
    acc[g.quality] = (acc[g.quality] ?? 0) + 1;
    return acc;
  }, {}),
  /** 实际用到的动作原型数量（应远小于功法数——这正是复用率） */
  distinctMotions: new Set(GONGFA_VISUAL.map((g) => g.motion)).size,
  /** 实际用到的特效模板数量 */
  distinctVfx: new Set(GONGFA_VISUAL.map((g) => g.vfx)).size,
  distinctSfx: new Set(GONGFA_VISUAL.map((g) => g.sfx)).size,
};
