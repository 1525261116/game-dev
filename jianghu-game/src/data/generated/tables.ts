/**
 * ⚠️ 本文件由 tools/import-tables.ts 自动生成，**请勿手工修改**。
 *
 * 要改数值，请编辑 data/tables/*.csv 后运行：pnpm tables:import
 * 直接改本文件会在下次导入时被覆盖。
 */
import type { BattleSetupRow, SkillRow, UnitRow } from '../../core/config/schema.ts';
/** 功法表（来自 data/tables/skills.csv） */
export const SKILL_ROWS: SkillRow[] = [
  {
    "id": "GF_kuangfeng_dao",
    "name": "狂风刀法",
    "quality": "fan",
    "realm": "chujiao",
    "multiplier": 1.2,
    "range": "single_any",
    "stanceStart": 1,
    "stanceEnd": 2
  },
  {
    "id": "GF_duanyue_dao",
    "name": "断岳刀法",
    "quality": "liang",
    "realm": "lveyou",
    "multiplier": 1.5,
    "range": "single_any",
    "stanceStart": 2,
    "stanceEnd": 3
  },
  {
    "id": "GF_badao",
    "name": "霸刀",
    "quality": "ji",
    "realm": "chujiao",
    "multiplier": 0.7,
    "range": "all",
    "stanceStart": 3,
    "stanceEnd": 1
  },
  {
    "id": "GF_liuyun_jian",
    "name": "流云剑法",
    "quality": "liang",
    "realm": "chujiao",
    "multiplier": 0.8,
    "range": "single_any",
    "stanceStart": 1,
    "stanceEnd": 2
  },
  {
    "id": "GF_luohan_quan",
    "name": "罗汉拳",
    "quality": "fan",
    "realm": "chujiao",
    "multiplier": 1.2,
    "range": "single_any",
    "stanceStart": 1,
    "stanceEnd": 2,
    "statusId": "stun",
    "statusChance": 1,
    "statusRounds": 1
  },
  {
    "id": "GF_yangjia_qiang",
    "name": "杨家枪法",
    "quality": "fan",
    "realm": "chujiao",
    "multiplier": 1.2,
    "range": "single_any",
    "stanceStart": 1,
    "stanceEnd": 2,
    "statusId": "knockback",
    "statusChance": 0.15,
    "statusRounds": 1
  },
  {
    "id": "GF_liuye_feidao",
    "name": "柳叶飞刀",
    "quality": "fan",
    "realm": "chujiao",
    "multiplier": 1.2,
    "range": "single_back",
    "stanceStart": 1,
    "stanceEnd": 2
  },
  {
    "id": "GF_judge_bi",
    "name": "判官笔",
    "quality": "fan",
    "realm": "chujiao",
    "multiplier": 1.2,
    "range": "single_any",
    "stanceStart": 2,
    "stanceEnd": 3,
    "statusId": "seal",
    "statusChance": 0.1,
    "statusRounds": 1
  }
];

/** 单位表（来自 data/tables/units.csv） */
export const UNIT_ROWS: UnitRow[] = [
  {
    "id": "ally_dao",
    "name": "刀客",
    "side": "ally",
    "slot": 0,
    "group": "dao",
    "hpMax": 1250,
    "atk": 340,
    "def": 90,
    "spd": 55,
    "crit": 0.15,
    "dodge": 0.05,
    "hit": 0.9,
    "lifesteal": 0,
    "innerCultivation": 40,
    "gongfaCultivation": 10,
    "breath": 40,
    "charId": "ren_dao",
    "skillId": "GF_kuangfeng_dao",
    "skillIdB": "GF_duanyue_dao",
    "skillIdC": "GF_badao"
  },
  {
    "id": "ally_jian",
    "name": "剑客",
    "side": "ally",
    "slot": 1,
    "group": "jian",
    "hpMax": 1150,
    "atk": 320,
    "def": 80,
    "spd": 62,
    "crit": 0.2,
    "dodge": 0.1,
    "hit": 0.92,
    "lifesteal": 0,
    "innerCultivation": 35,
    "gongfaCultivation": 12,
    "breath": 50,
    "charId": "ren_jian",
    "skillId": "GF_liuyun_jian"
  },
  {
    "id": "ally_quan",
    "name": "拳师",
    "side": "ally",
    "slot": 2,
    "group": "quan",
    "hpMax": 1450,
    "atk": 300,
    "def": 110,
    "spd": 48,
    "crit": 0.1,
    "dodge": 0.04,
    "hit": 0.88,
    "lifesteal": 0,
    "innerCultivation": 30,
    "gongfaCultivation": 8,
    "breath": 30,
    "charId": "ren_quan",
    "skillId": "GF_luohan_quan"
  },
  {
    "id": "enemy_qiang",
    "name": "枪手",
    "side": "enemy",
    "slot": 0,
    "group": "qiang",
    "hpMax": 1100,
    "atk": 300,
    "def": 85,
    "spd": 52,
    "crit": 0.12,
    "dodge": 0.05,
    "hit": 0.88,
    "lifesteal": 0,
    "innerCultivation": 20,
    "gongfaCultivation": 6,
    "breath": 45,
    "charId": "ren_qiang",
    "skillId": "GF_yangjia_qiang"
  },
  {
    "id": "enemy_anqi",
    "name": "暗器手",
    "side": "enemy",
    "slot": 1,
    "group": "anqi",
    "hpMax": 900,
    "atk": 280,
    "def": 60,
    "spd": 70,
    "crit": 0.25,
    "dodge": 0.15,
    "hit": 0.9,
    "lifesteal": 0,
    "innerCultivation": 15,
    "gongfaCultivation": 4,
    "breath": 35,
    "charId": "ren_anqi",
    "skillId": "GF_liuye_feidao"
  },
  {
    "id": "enemy_qimen",
    "name": "奇门客",
    "side": "enemy",
    "slot": 2,
    "group": "qimen",
    "hpMax": 1000,
    "atk": 290,
    "def": 75,
    "spd": 58,
    "crit": 0.14,
    "dodge": 0.08,
    "hit": 0.9,
    "lifesteal": 0,
    "innerCultivation": 25,
    "gongfaCultivation": 8,
    "breath": 50,
    "charId": "ren_qimen",
    "skillId": "GF_judge_bi"
  }
];

/** 对战配置（来自 data/tables/battle.csv） */
export const BATTLE_SETUP_ROWS: BattleSetupRow[] = [
  {
    "side": "ally",
    "formationId": "FM_changshe",
    "formationLevel": 5
  },
  {
    "side": "enemy",
    "formationId": "FM_youyue",
    "formationLevel": 3
  }
];
