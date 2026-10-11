/**
 * 战斗示例阵容（数值配置）。
 *
 * ⚠️ 当前状态：这是一套**按 GDD §3.1 口径换算出来的示例数值**，用于跑通结算链路。
 *    正式的数值应当来自配置表（GDD 4.7.2 的 skill_gongfa / unit_base 表）。
 *    等配置管线做出来后，本文件会被"读表"取代 —— 届时战斗代码一行都不用改。
 *
 * 数值依据（GDD 03 §3.1.1 / 08_balance 战斗数值 §二「Lv50 参考面板」）：
 *   攻击力 = 臂力 × 3 + 装备攻击      → 臂力 80 + 装备 100 = 340
 *   防御力 = 根骨 × 1.5 + 装备防御     → 根骨 60 = 90（对应减伤 37.5%）
 *   气血   = 根骨 × 20 + 装备气血      → 根骨 60 ≈ 1200
 *   功法威力 = 品质基础威力 × 境界倍率 × 3（由 gongfaPower() 计算，不写死）
 */
import { gongfaPower } from './gongfa-power.ts';
import type { BattleUnitConfig } from '../core/battle/simulate.ts';

/* ══════════════════════ 我方 3 人 ══════════════════════ */

export const ALLY_PARTY: BattleUnitConfig[] = [
  {
    id: 'ally_dao',
    name: '刀客',
    side: 'ally',
    slot: 0, // 前排左
    group: 'dao',
    stats: {
      hpMax: 1250,
      atk: 340,
      def: 90,
      spd: 55,
      crit: 0.15,
      dodge: 0.05,
      hit: 0.9,
      lifesteal: 0,
      innerCultivation: 40,
      gongfaCultivation: 10,
    },
    skill: {
      id: 'GF_duanyue_dao',
      name: '断岳刀法',
      power: gongfaPower('liang', 'lveyou'), // 良品·略有小成 = 20 × 1.2 × 3 = 72
      multiplier: 1.2,
      targets: 'column', // 横扫一列
    },
  },
  {
    id: 'ally_jian',
    name: '剑客',
    side: 'ally',
    slot: 1, // 前排中
    group: 'jian',
    stats: {
      hpMax: 1150,
      atk: 320,
      def: 80,
      spd: 62, // 剑走轻灵：速度最快，先手
      crit: 0.2,
      dodge: 0.1,
      hit: 0.92,
      lifesteal: 0,
      innerCultivation: 35,
      gongfaCultivation: 12,
    },
    skill: {
      id: 'GF_liuyun_jian',
      name: '流云剑法',
      power: gongfaPower('shang', 'chujiao'), // 上品·初窥门径 = 35 × 1.0 × 3 = 105
      multiplier: 1.0,
      targets: 'single',
    },
  },
  {
    id: 'ally_quan',
    name: '拳师',
    side: 'ally',
    slot: 2, // 前排右
    group: 'quan',
    stats: {
      hpMax: 1450,
      atk: 300,
      def: 110, // 拳师皮厚，前排承伤
      spd: 48,
      crit: 0.1,
      dodge: 0.04,
      hit: 0.88,
      lifesteal: 0,
      innerCultivation: 30,
      gongfaCultivation: 8,
    },
    skill: {
      id: 'GF_luohan_quan',
      name: '罗汉拳',
      power: gongfaPower('liang', 'lveyou'), // 72
      multiplier: 1.1,
      targets: 'single',
      status: { id: 'stun', chance: 0.25, rounds: 1 }, // 25% 概率眩晕一回合
    },
  },
];

/* ══════════════════════ 敌方 3 人 ══════════════════════ */

export const ENEMY_PARTY: BattleUnitConfig[] = [
  {
    id: 'enemy_qiang',
    name: '枪手',
    side: 'enemy',
    slot: 0,
    group: 'qiang',
    stats: {
      hpMax: 1100,
      atk: 300,
      def: 85,
      spd: 52,
      crit: 0.12,
      dodge: 0.05,
      hit: 0.88,
      lifesteal: 0,
      innerCultivation: 20,
      gongfaCultivation: 6,
    },
    skill: {
      id: 'GF_yangjia_qiang',
      name: '杨家枪法',
      power: gongfaPower('fan', 'chujiao'), // 凡品·初窥门径 = 30
      multiplier: 1.0,
      targets: 'row', // 横扫一排
    },
  },
  {
    id: 'enemy_anqi',
    name: '暗器手',
    side: 'enemy',
    slot: 1,
    group: 'anqi',
    stats: {
      hpMax: 900, // 脆，但快
      atk: 280,
      def: 60,
      spd: 70, // 全场最快，先手
      crit: 0.25,
      dodge: 0.15,
      hit: 0.9,
      lifesteal: 0,
      innerCultivation: 15,
      gongfaCultivation: 4,
    },
    skill: {
      id: 'GF_liuye_feidao',
      name: '柳叶飞刀',
      power: gongfaPower('fan', 'chujiao'), // 30
      multiplier: 1.0,
      targets: 'single',
    },
  },
  {
    id: 'enemy_qimen',
    name: '奇门客',
    side: 'enemy',
    slot: 2,
    group: 'qimen',
    stats: {
      hpMax: 1000,
      atk: 290,
      def: 75,
      spd: 58,
      crit: 0.14,
      dodge: 0.08,
      hit: 0.9,
      lifesteal: 0,
      innerCultivation: 25,
      gongfaCultivation: 8,
    },
    skill: {
      id: 'GF_judge_bi',
      name: '判官笔',
      power: gongfaPower('liang', 'chujiao'), // 良品·初窥门径 = 60
      multiplier: 1.0,
      targets: 'single',
      status: { id: 'seal', chance: 0.3, rounds: 2 }, // 30% 概率封穴
    },
  },
];

/** 默认对战配置（供 BattleScene 与模拟器共用） */
export const DEFAULT_BATTLE = {
  allies: ALLY_PARTY,
  enemies: ENEMY_PARTY,
} as const;
