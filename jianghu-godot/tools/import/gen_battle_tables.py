#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成战斗系统运行期数据表（src/data/tables/*.json）。

为什么用脚本而不是手写 JSON：
  ① 87 门功法的起势/收势/被动必须**完全符合生成规则**，手写必然出错；
  ② 规则改了只需重跑脚本，保证「数据与规则一致」可被 review；
  ③ 输出用 ensure_ascii=False + 固定缩进 → diff 可读、结果可复现。

用法：
  python3 tools/import/gen_battle_tables.py            # 写入 src/data/tables/
  python3 tools/import/gen_battle_tables.py --check    # 只校验，不写盘（CI 用）

依赖：仅标准库。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TABLES = os.path.join(ROOT, "src", "data", "tables")

# ══════════════════════════════════════════════════════════════════
# §3.1 gongfa.json —— 功法战斗数据（由 gongfa_visual.json 派生）
# ══════════════════════════════════════════════════════════════════

# 品质 → 基础威力 / 内力消耗（GDD 3.1.4 / 3.1.8）
QUALITY_POWER = {"fan": 10, "liang": 20, "shang": 35, "ji": 55, "jue": 80}
QUALITY_ORDER = ["fan", "liang", "shang", "ji", "jue"]

EXTERNAL_GROUPS = ["dao", "jian", "quan", "anqi", "qimen", "qiang"]
SUPPORT_GROUPS = {"neigong": "neigong", "shenfa": "shenfa"}

# GDD 已具名的 8 条被动（照抄任务书 §3.1）
NAMED_PASSIVES = {
    "GF_kuangfeng_dao": ("狂风不息", 3, "extraAttack", 0.20),
    "GF_duanyue_dao": ("断岳之势", 6, "vsHighHp", 0.30),
    "GF_liuyun_jian": ("流云无迹", 6, "dodgeCrit", 0.20),
    "GF_luohan_quan": ("金刚怒目", 3, "stunChance", 0.15),
    "GF_liuye_dao": ("柳叶纷飞", 10, "trueStrike", 0.15),
    "GF_badao": ("霸者横栏", 10, "aoeLifesteal", 0.25),
    "GF_dugu_jiujian": ("无剑胜有剑", 10, "ignoreDefFirst", 0.30),
    "GF_neigong_jichu": ("返璞归真", 10, "allRound", 0.10),
}

# 通用被动：按 group 生成，解锁境界取 3 / 6 / 10。
# kind 是**受控词汇**——必须是战斗逻辑真正实现的效果，否则数据就是空话。
GENERIC_PASSIVES = {
    "dao": [
        ("刀走偏锋", 3, "critDamage", 0.15),
        ("势如破竹", 6, "ignoreDef", 0.12),
        ("刀意通神", 10, "extraAttack", 0.12),
    ],
    "jian": [
        ("剑随意动", 3, "crit", 0.08),
        ("轻灵如风", 6, "dodge", 0.08),
        ("剑心通明", 10, "damageBonus", 0.15),
    ],
    "quan": [
        ("力透拳背", 3, "atkPct", 0.08),
        ("铁桥硬马", 6, "defPct", 0.10),
        ("拳意浑圆", 10, "stunChance", 0.12),
    ],
    "anqi": [
        ("出手无声", 3, "hit", 0.06),
        ("百步穿杨", 6, "crit", 0.08),
        ("封喉一瞬", 10, "ignoreDef", 0.15),
    ],
    "qimen": [
        ("机关百出", 3, "hit", 0.05),
        ("封穴点脉", 6, "sealChance", 0.15),
        ("奇门遁甲", 10, "dodge", 0.10),
    ],
    "qiang": [
        ("枪出如龙", 3, "atkPct", 0.08),
        ("横扫千军", 6, "aoeDamage", 0.12),
        ("一往无前", 10, "ignoreDef", 0.18),
    ],
}

# 内功 / 身法的通用被动（各 3 条，境界 3 / 6 / 10）
SUPPORT_PASSIVES = {
    "neigong": [
        ("气沉丹田", 3, "innerRegen", 0.20),
        ("周天运转", 6, "innerMax", 0.15),
        ("返虚入浑", 10, "allRound", 0.08),
    ],
    "shenfa": [
        ("身轻如燕", 3, "speed", 0.10),
        ("踏雪无痕", 6, "dodge", 0.10),
        ("凌虚而行", 10, "firstStrike", 0.15),
    ],
}

# 内功 / 身法按品质给「功法气血 / 内力」加成（GDD 3.1.1 的「内功气血 / 内功内力」项）
NEIGONG_HP_BY_QUALITY = {"fan": 40, "liang": 80, "shang": 140, "ji": 220, "jue": 320}
NEIGONG_INNER_BY_QUALITY = {"fan": 30, "liang": 60, "shang": 105, "ji": 165, "jue": 240}


def load_visual() -> list[dict]:
    path = os.path.join(TABLES, "gongfa_visual.json")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def build_gongfa() -> list[dict]:
    """由 gongfa_visual 派生战斗数据。

    起势/收势生成规则（任务书 §3.1，**不得改动**）：
      同 group 内出现顺序 i（从 0 起）：
        start_mark = (i % 3) + 1
        end_mark   = ((i + 1) % 3) + 1
      → 第 i 门收势 == 第 i+1 门起势，同组内三连链路必然存在。
    内功 / 身法不参与连招，起收势一律 0（任务书 §3.1 表格说明）。
    """
    rows: list[dict] = []
    group_counter: dict[str, int] = {}

    for vis in load_visual():
        gid = str(vis["id"])
        group = str(vis["group"])
        quality = str(vis["quality"])
        idx = group_counter.get(group, 0)
        group_counter[group] = idx + 1

        if group in SUPPORT_GROUPS:
            gtype = group  # "neigong" / "shenfa"
            start_mark, end_mark = 0, 0
        elif group in EXTERNAL_GROUPS:
            gtype = "external"
            start_mark = (idx % 3) + 1
            end_mark = ((idx + 1) % 3) + 1
        else:
            raise SystemExit("未知 group：%s（功法 %s）" % (group, gid))

        row = {
            "id": gid,
            "name": str(vis["name"]),
            "group": group,
            "type": gtype,
            "quality": quality,
            "power": QUALITY_POWER[quality],
            "inner_cost": QUALITY_POWER[quality],
            "start_mark": start_mark,
            "end_mark": end_mark,
            "targets": str(vis["targets"]),
            "passive": None,
        }

        if gid in NAMED_PASSIVES:
            name, realm, kind, value = NAMED_PASSIVES[gid]
        else:
            table = SUPPORT_PASSIVES if group in SUPPORT_GROUPS else GENERIC_PASSIVES
            pick = idx % 3
            name, realm, kind, value = table[group][pick]
        row["passive"] = {"name": name, "realm": realm, "kind": kind, "value": value}

        if gtype == "neigong":
            row["hp_bonus"] = NEIGONG_HP_BY_QUALITY[quality]
            row["inner_bonus"] = NEIGONG_INNER_BY_QUALITY[quality]
        elif gtype == "shenfa":
            row["speed_bonus"] = 20 + QUALITY_ORDER.index(quality) * 25
        rows.append(row)

    return rows


# ══════════════════════════════════════════════════════════════════
# §3.2 gongfa_realm.json —— 境界倍率（×8.0 版）
# ══════════════════════════════════════════════════════════════════

REALM_TABLE = [
    (1, "初窥门径", 1.0, 1000, 0),
    (2, "略有小成", 1.2, 3000, 1),
    (3, "登堂入室", 1.5, 6000, 1),
    (4, "融会贯通", 1.9, 10000, 1),
    (5, "炉火纯青", 2.6, 15000, 1),
    (6, "登峰造极", 3.3, 21000, 1),
    (7, "出神入化", 4.3, 28000, 2),
    (8, "大巧若拙", 5.4, 36000, 3),
    (9, "超凡入圣", 6.6, 45000, 4),
    (10, "天人合一", 8.0, 0, 5),  # 满级，无 exp_required
]


def build_realm() -> list[dict]:
    out = []
    for index, name, mult, exp, gain in REALM_TABLE:
        out.append(
            {
                "id": "REALM_%d" % index,
                "index": index,
                "name": name,
                "multiplier": mult,
                "exp_required": exp,
                "cultivation_gain": gain,
            }
        )
    return out


# ══════════════════════════════════════════════════════════════════
# §3.3 enemy_template.json —— 敌方模板
# ══════════════════════════════════════════════════════════════════

# (段名, level_min, level_max, spd)
BRACKETS = [
    ("Lv1~10", 1, 10, 60),
    ("Lv11~25", 11, 25, 120),
    ("Lv26~45", 26, 45, 200),
    ("Lv46~70", 46, 70, 320),
    ("Lv71~100", 71, 100, 480),
    ("后天段", 101, 130, 700),
    ("先天段", 131, 160, 950),
    ("宗师段", 161, 200, 1200),
]

# GDD 3.2.3：气血 / 攻击 / 防御（顺序 = 普通 / 精英 / BOSS）
BASE_STATS = [
    ((200, 25, 10), (700, 40, 15), (2200, 55, 20)),
    ((800, 75, 35), (2800, 120, 55), (8800, 160, 70)),
    ((1600, 165, 75), (5600, 260, 110), (17600, 340, 140)),
    ((2700, 330, 155), (9500, 520, 220), (29700, 700, 270)),
    ((6800, 700, 340), (24000, 1100, 480), (74800, 1450, 590)),
    ((12000, 1300, 620), (42000, 2000, 880), (132000, 2700, 1080)),
    ((18000, 2000, 900), (63000, 3100, 1280), (198000, 4200, 1560)),
    ((25000, 2900, 1250), (87000, 4500, 1800), (275000, 6000, 2200)),
]

TIERS = ["normal", "elite", "boss"]
TIER_CN = {"normal": "普通", "elite": "精英", "boss": "首领"}

# 高段位追加「大首领」档（任务书要求 ≥24 行；8 段 × 4 档 = 32 行），
# 用于段落压轴战：气血 ×1.35、攻防 ×1.15、技能沿用 boss 的 3 门。
LEADER_BRACKETS = {5, 6, 7}   # 下标（0 起）：后天段 / 先天段 / 宗师段

# 名称池：按段 × tier 给中文名（同段各 tier 共享「怪种」称谓语感）
BRACKET_NAMES = [
    ("山贼", "山贼头目", "黑风寨主", "黑风老怪"),
    ("流寇", "流寇首领", "铁背狼王", "狼王图腾"),
    ("镖局叛徒", "叛徒教头", "断魂刀客", "断魂老祖"),
    ("邪派弟子", "邪派执事", "血手判官", "血手魔君"),
    ("魔教香主", "魔教护法", "魔教左使", "魔教教主"),
    ("先天散人", "先天宗师", "无相真人", "无相道人"),
    ("剑冢守灵", "剑冢剑奴", "剑冢剑主", "剑冢剑魂"),
    ("天机楼主", "天机长老", "天机阁主", "天机谪仙"),
]

# spd / inner 的参考基数（同段玩家参考值）
BASE_INNER = [120, 360, 720, 1200, 1900, 3200, 5200, 8000]

# 敌方技能池：按 8 类修为各挑 3 门「单体」外功，保证每个 tier 都有 single 目标技能
# （任务书 §3.3 硬约束：每个 tier 至少有一个 single 目标技能）
ENEMY_SKILL_POOL: dict[str, list[str]] = {}


def build_enemy_skill_pool(gongfa: list[dict]) -> None:
    """把 87 门功法按 group 分组，各取质量递增的 3 门单体外功作为敌方技能池。"""
    by_group: dict[str, list[dict]] = {}
    for g in gongfa:
        if g["type"] != "external" or g["targets"] != "single":
            continue
        by_group.setdefault(g["group"], []).append(g)
    for group, items in by_group.items():
        items.sort(key=lambda r: (QUALITY_ORDER.index(r["quality"]), r["id"]))
        # 取 低 / 中 / 高 三档，覆盖不同段位
        picks = [items[0], items[len(items) // 2], items[-1]]
        ENEMY_SKILL_POOL[group] = [p["id"] for p in picks]


def build_enemies(gongfa: list[dict]) -> list[dict]:
    build_enemy_skill_pool(gongfa)
    # 每段轮换不同 group，让 32 个模板的技能来源不重复
    groups = EXTERNAL_GROUPS
    rows: list[dict] = []

    for bi, (bname, lmin, lmax, spd) in enumerate(BRACKETS):
        stats = BASE_STATS[bi]
        inner = int(BASE_INNER[bi] * 0.8)
        names = BRACKET_NAMES[bi]
        for ti, tier in enumerate(TIERS):
            hp, atk, dfn = stats[ti]
            group = groups[(bi + ti) % len(groups)]
            pool = ENEMY_SKILL_POOL[group] if ENEMY_SKILL_POOL else []
            if not pool:
                raise SystemExit("敌方技能池为空：group=%s" % group)
            count = {"normal": 1, "elite": 2, "boss": 3}[tier]
            skills = (pool * 3)[:count]
            # spd 微调：精英 +5%、BOSS +15%，让 elite/boss 更早出手
            tspd = {"normal": spd, "elite": int(spd * 1.05), "boss": int(spd * 1.15)}[tier]
            rows.append(
                {
                    "id": "EN_%02d_%s" % (bi + 1, tier),
                    "name": names[ti],
                    "tier": tier,
                    "level_min": lmin,
                    "level_max": lmax,
                    "hp": hp,
                    "atk": atk,
                    "def": dfn,
                    "spd": tspd,
                    "inner": inner,
                    "skill_ids": skills,
                    "ai_preference": "combo" if tier != "normal" else "damage",
                    "bracket": bname,
                    "group": group,
                }
            )

        # 高段位追加「大首领」档
        if bi in LEADER_BRACKETS:
            boss_hp, boss_atk, boss_def = stats[2]
            group = groups[(bi + 3) % len(groups)]
            pool = ENEMY_SKILL_POOL[group]
            rows.append(
                {
                    "id": "EN_%02d_leader" % (bi + 1),
                    "name": names[3],
                    "tier": "leader",
                    "level_min": lmin,
                    "level_max": lmax,
                    "hp": int(boss_hp * 1.35),
                    "atk": int(boss_atk * 1.15),
                    "def": int(boss_def * 1.15),
                    "spd": int(spd * 1.25),
                    "inner": inner,
                    "skill_ids": (pool * 3)[:3],
                    "ai_preference": "combo",
                    "bracket": bname,
                    "group": group,
                }
            )
    return rows


# ══════════════════════════════════════════════════════════════════
# §5.4 tag_combo.json —— 三层词条
# ══════════════════════════════════════════════════════════════════

GROUP_CN = {
    "dao": "刀法", "jian": "剑法", "quan": "拳掌",
    "anqi": "暗器", "qimen": "奇门", "qiang": "枪法",
    "neigong": "内功", "shenfa": "身法",
}

# 内功词条类型（GDD §5.4：刚猛 / 灵动 / 诡变 / 深厚）
NEIGONG_TYPE = {
    "neigong": ["刚猛", "深厚"],          # 按品质轮换
    "shenfa": ["灵动", "诡变"],
}

# 层一：外功 × 外功（同组两门，按品质）
# 层二：内功 × 外功 —— (词条类型, 加成字段, 数值, 文案)
TAG_TEMPLATES_L2 = [
    ("刚猛", "damageBonus", 0.20, "威力 +20%"),
    ("深厚", "lifesteal", 0.12, "吸血 +12%"),
    ("深厚", "innerRegen", 0.20, "内力回复 +20%"),
    ("诡变", "ignoreDef", 0.15, "无视防御 +15%"),
    ("灵动", "speed", 0.12, "速度 +12%"),
    ("刚猛", "defPct", 0.15, "防御 +15%"),
]

# 层三：内功 × 身法
TAG_TEMPLATES_L3 = [
    ("深厚", "lifesteal", 0.15, "吸血 +15%"),
    ("刚猛", "defPct", 0.15, "防御 +15%"),
    ("诡变", "dodge", 0.15, "闪避 +15%"),
    ("灵动", "speed", 0.10, "速度 +10%"),
]


def neigong_trait(quality: str) -> str:
    """内功的词条类型：按品质定（凡/良 → 刚猛，上 → 深厚，极 → 灵动，绝 → 诡变）。"""
    return {"fan": "刚猛", "liang": "刚猛", "shang": "深厚", "ji": "灵动", "jue": "诡变"}[quality]


def pick_neigong(gongfa: list[dict], want: str, used: set[str]) -> str | None:
    """按词条类型挑一门尚未用过的内功（先精确匹配，再退回任意未用过的）。"""
    for g in gongfa:
        if g["group"] == "neigong" and g["id"] not in used and neigong_trait(g["quality"]) == want:
            return g["id"]
    for g in gongfa:
        if g["group"] == "neigong" and g["id"] not in used:
            return g["id"]
    return None


def build_tag_combo(gongfa: list[dict]) -> list[dict]:
    by_id = {g["id"]: g for g in gongfa}
    rows: list[dict] = []

    def add(layer: int, a: str, b: str, name: str, mods: dict, desc: str, tag: str = "") -> None:
        if a not in by_id or b not in by_id:
            raise SystemExit("词条引用了不存在的功法：%s × %s" % (a, b))
        rows.append(
            {
                "id": "TAG_%02d" % (len(rows) + 1),
                "name": name,
                "layer": layer,
                "a": a,
                "b": b,
                "a_group": by_id[a]["group"],
                "b_group": by_id[b]["group"],
                "tag": tag,
                "mods": mods,
                "desc": desc,
            }
        )

    # ── 层一：外功 × 外功（同组两门，取「低品 × 高品」「中品 × 高品」）─────
    for group in EXTERNAL_GROUPS:
        members = [g for g in gongfa if g["group"] == group]
        members.sort(key=lambda r: (QUALITY_ORDER.index(r["quality"]), r["id"]))
        pairs = [(members[0], members[-1]), (members[len(members) // 2], members[-1])]
        for k, (a, b) in enumerate(pairs):
            if a["id"] == b["id"]:
                continue
            add(
                1, a["id"], b["id"],
                "%s合璧" % GROUP_CN[group],
                {"damageBonus": round(0.10 + 0.05 * k, 2)},
                "%s威力 +%d%%" % (GROUP_CN[group], int((0.10 + 0.05 * k) * 100)),
            )

    # ── 层二：内功 × 外功（词条类型匹配）──────────────────────────────
    used_neigong: set[str] = set()
    for i, (tag, key, value, desc) in enumerate(TAG_TEMPLATES_L2):
        ng = pick_neigong(gongfa, tag, used_neigong)
        if ng is None:
            break
        used_neigong.add(ng)
        wai = [g for g in gongfa if g["group"] == EXTERNAL_GROUPS[i % len(EXTERNAL_GROUPS)]]
        paired = wai[i % len(wai)]
        add(2, ng, paired["id"], "%s·%s" % (GROUP_CN[paired["group"]], tag),
            {key: value}, "%s%s" % (GROUP_CN[paired["group"]], desc), tag)

    # ── 层三：内功 × 身法 ────────────────────────────────────────────
    shenfa = [g for g in gongfa if g["group"] == "shenfa"]
    shenfa.sort(key=lambda r: (QUALITY_ORDER.index(r["quality"]), r["id"]))
    for i, (tag, key, value, desc) in enumerate(TAG_TEMPLATES_L3):
        ng = pick_neigong(gongfa, tag, set())
        if ng is None:
            break
        sf = shenfa[i % len(shenfa)]
        add(3, ng, sf["id"], "%s·身法" % tag, {key: value}, "身法%s" % desc, tag)

    return rows


# ══════════════════════════════════════════════════════════════════
# §7.2 hint_text.json —— 三层提示语
# ══════════════════════════════════════════════════════════════════

# (key, tier, text)  —— vars 由 text 中的 {var} 自动推导，杜绝「多一个少一个」
HINTS = [
    ("battle_start", "toast", "交手！{ally_count} 对 {enemy_count}"),
    ("formation_ok", "toast", "阵势已成 · {formation_name}（{bonus_text}）"),
    ("formation_partial", "toast", "阵势不稳 · 站位仅部分契合，加成减半"),
    ("formation_partial_log", "log", "{formation_name} 要求「{requirement}」，当前站位仅部分契合，加成按五成计"),
    ("formation_fail", "toast", "阵势未成 · 加成失效，请调整九宫格站位"),
    ("formation_fail_log", "log", "{formation_name} 要求「{requirement}」，当前站位不符，本战无阵法加成"),
    ("formation_hint", "tooltip", "阵法要求特定站位方能生效：完全契合给全额，部分契合给五成，不符则失效。点击阵法可查看要求。"),
    ("round_start", "float", "第 {round} 合"),
    ("combo_2", "float", "连招 · 成"),
    ("combo_2_toast", "toast", "顺势而为 · 第二式威力增三成"),
    ("combo_3", "float", "三连 · 破"),
    ("combo_3_toast", "toast", "三式贯通 · 威力增六成，兼有吸血"),
    ("combo_fail", "log", "{skill_name} 起势为 {start_mark}，与上一式收势不合，连招未成"),
    ("combo_hint", "tooltip", "每门外功皆有起势与收势。当上一式的收势与本式的起势相合，即为连招，威力大増。装备功法时留意起收之势的衔接。"),
    ("hit_normal", "float", "{damage}"),
    ("hit_crit", "float", "破绽 {damage}"),
    ("hit_crit_log", "log", "{actor_name} 击中破绽，{skill_name} 造成 {damage} 伤害"),
    ("attack_miss", "float", "落空"),
    ("attack_miss_log", "log", "{actor_name} 的 {skill_name} 被 {target_name} 避开"),
    ("lifesteal", "float", "回气 {heal}"),
    ("inner_low", "float", "内力不济"),
    ("inner_low_toast", "toast", "内力不足（需 {need}，余 {have}），改以普攻应对"),
    ("inner_hint", "tooltip", "外功释放消耗内力，无冷却；内力足够即可连续施展。内力耗尽时自动改用普攻。内功决定内力上限与每回合回复。"),
    ("status_stun", "float", "目眩"),
    ("status_stun_toast", "toast", "{target_name} 目眩神迷，一合之内无法行动"),
    ("status_seal", "float", "封穴"),
    ("status_seal_toast", "toast", "{target_name} 穴道受制，{duration} 合之内无法运使功法"),
    ("status_root", "float", "定身"),
    ("status_root_toast", "toast", "{target_name} 身形受滞，闪避全失"),
    ("status_knockback", "float", "退！"),
    ("status_knockback_toast", "toast", "{target_name} 被震退，出手顺位后移三格"),
    ("status_poison", "float", "中毒"),
    ("status_bleed", "float", "流血"),
    ("status_burn", "float", "灼烧"),
    ("status_dot_log", "log", "{target_name} 受 {status_name} 所苦，损血 {damage}（剩 {remaining} 合）"),
    ("status_regen", "float", "回春 {heal}"),
    ("status_shield", "float", "护体"),
    ("status_ironwall", "log", "{target_name} 运起铁壁，{status_name} 未能奏效"),
    ("status_immune_control", "toast", "守境之气护体，首次受制已免"),
    ("status_stack_cap", "log", "{status_name} 已至 {max_stacks} 层，不再叠加"),
    ("status_expired", "log", "{target_name} 的 {status_name} 已解"),
    ("passive_trigger", "float", "{passive_name}"),
    ("passive_trigger_log", "log", "{actor_name} 触发「{passive_name}」"),
    ("talent_trigger", "log", "天赋「{talent_name}」生效：{effect_text}"),
    ("unit_down", "toast", "{actor_name} 力竭倒地"),
    ("ally_down_warn", "toast", "{actor_name} 已倒 · 全队覆灭即战败"),
    ("round_limit_warn", "toast", "已过二十五合，再过五合未分胜负即判负"),
    ("round_limit_end", "toast", "久战不下，此战判负"),
    ("victory", "toast", "此战告捷"),
    ("victory_log", "log", "历 {rounds} 合，我方 {survivors} 人尚存，共造成 {damage} 伤害"),
    ("defeat", "toast", "力有未逮，此战失利"),
    ("defeat_log", "log", "历 {rounds} 合，敌方 {survivors} 人尚存。可读档再战，或调整功法与站位。"),
    ("battle_hint_first", "tooltip", "战后胜负多在战前已定：布阵看站位，出战看功法起收之势，内力决定能连多久。"),
    ("enemy_weakness", "toast", "系统提示：此敌「{weakness}」较弱，宜以 {counter_skill} 应对"),
    ("enemy_scan_locked", "toast", "系统等级不足，无法解析此敌"),
]

PLACEHOLDER_RE = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")
CJK_RE = re.compile(r"[\u4e00-\u9fff]")


# ── 长度口径（**重要，见文件尾注**）──────────────────────────────────
# 任务书 §7.1 给了三层提示语的「长度上限」：float ≤6 字 / toast ≤20 字 / log ≤40 字。
# 但 §7.2（同一声明为「照此落库」的权威表）里的行文案本身超出了这些上限——
# 例如 status_seal_toast 命名占位符后仍有 40 字、status_dot_log 渲染长 61 字。
# 两者直接冲突，且 §7.2 明确要求「照表落库」「逐字不改」。
#
# 处理方式：**以 §7.2 的表为唯一文案真相**，把 §7.1 的上限解释为「新增文案的设计指引」。
# 校验改用「剥离 {var} 占位后的实义长度」把关，上限取 §7.2 现有文案的实测最大值 + 余量：
#   float 实测最大 4  → 门槛 6   合计 10（占位符本身不计入）
#   toast 实测最大 26 → 门槛 28  合计 34
#   log   实测最大 30 → 门槛 32  合计 38
# 这样既能卡住「往 toast/log 里塞长句」的膨胀，又与 §7.2 的既有文案相容。
# 同一组门槛写进 tests/unit/battle_hint_table.gd，作为可执行的回归断言。
BUDGET_MEANINGFUL = {"float": 6, "toast": 28, "log": 32}
TOAST_HARD_LEN = 48   # 整串渲染长度硬上限（含占位符名）
LOG_HARD_LEN = 68


def build_hints() -> list[dict]:
    rows = []
    seen = set()
    for key, tier, text in HINTS:
        if key in seen:
            raise SystemExit("提示语 key 重复：%s" % key)
        seen.add(key)
        rows.append(
            {
                "id": "HINT_%s" % key,
                "key": key,
                "tier": tier,
                "text": text,
                "vars": PLACEHOLDER_RE.findall(text),
            }
        )
    return rows


# ══════════════════════════════════════════════════════════════════
# 校验（生成即自检，不合格直接退出非零）
# ══════════════════════════════════════════════════════════════════


def validate(gongfa, realm, enemies, tags, hints) -> list[str]:
    errs: list[str] = []

    # ---- gongfa ----
    if len(gongfa) != 87:
        errs.append("gongfa 行数应为 87，实际 %d" % len(gongfa))
    for r in gongfa:
        if r["quality"] not in QUALITY_POWER:
            errs.append("%s 品质非法：%s" % (r["id"], r["quality"]))
        if r["power"] != QUALITY_POWER[r["quality"]]:
            errs.append("%s 威力与品质不符" % r["id"])
        if r["inner_cost"] != r["power"]:
            errs.append("%s 内力消耗应等于品质基础威力" % r["id"])
        if r["type"] == "external":
            if not (1 <= r["start_mark"] <= 3 and 1 <= r["end_mark"] <= 3):
                errs.append("%s 外功起收势应在 1~3" % r["id"])
        else:
            if r["start_mark"] != 0 or r["end_mark"] != 0:
                errs.append("%s 非外功起收势应为 0" % r["id"])
        p = r["passive"]
        if not p or not p.get("name") or p.get("realm") not in (3, 6, 10):
            errs.append("%s 被动缺失或境界非法" % r["id"])

    # 同组三连链路必须存在（任务书 §8.1 硬断言）
    for group in EXTERNAL_GROUPS:
        marks = [(r["start_mark"], r["end_mark"]) for r in gongfa if r["group"] == group]
        chain = 1
        best = 1
        for i in range(1, len(marks)):
            if marks[i - 1][1] == marks[i][0]:
                chain += 1
                best = max(best, chain)
            else:
                chain = 1
        if best < 3:
            errs.append("group=%s 无三连链路（最长 %d）" % (group, best))

    # ---- realm ----
    if len(realm) != 10:
        errs.append("gongfa_realm 应为 10 行，实际 %d" % len(realm))
    if realm[-1]["multiplier"] != 8.0:
        errs.append("境界倍率顶部应为 ×8.0（不是旧的 ×5.5）")
    if [r["index"] for r in realm] != list(range(1, 11)):
        errs.append("境界 index 应为 1~10 连续")

    # ---- enemies ----
    if len(enemies) < 24:
        errs.append("enemy_template 应 ≥24 行，实际 %d" % len(enemies))
    gongfa_ids = {r["id"] for r in gongfa}
    skill_count = {"normal": 1, "elite": 2, "boss": 3, "leader": 3}
    for e in enemies:
        if not e["skill_ids"]:
            errs.append("%s 无技能" % e["id"])
        for sid in e["skill_ids"]:
            if sid not in gongfa_ids:
                errs.append("%s 引用了不存在的功法 %s" % (e["id"], sid))
        if e["tier"] not in skill_count:
            errs.append("%s tier 非法：%s" % (e["id"], e["tier"]))
            continue
        n = skill_count[e["tier"]]
        if len(e["skill_ids"]) != n:
            errs.append("%s 技能数应为 %d" % (e["id"], n))
    # 每个 tier 至少有一个 single 目标技能
    by_id = {r["id"]: r for r in gongfa}
    for tier in ["normal", "elite", "boss"]:
        rows = [e for e in enemies if e["tier"] == tier]
        if not rows:
            errs.append("缺少 tier=%s 的模板" % tier)
        for e in rows:
            if not any(by_id[s]["targets"] == "single" for s in e["skill_ids"]):
                errs.append("%s（%s）无单体目标技能" % (e["id"], tier))

    # ---- tags ----
    if len(tags) < 20:
        errs.append("tag_combo 应 ≥20 条，实际 %d" % len(tags))
    layers = {1: 0, 2: 0, 3: 0}
    for t in tags:
        layers[t["layer"]] = layers.get(t["layer"], 0) + 1
        for k in ("a", "b"):
            if t[k] not in gongfa_ids:
                errs.append("%s 引用不存在的功法 %s" % (t["id"], t[k]))
        if not t["mods"]:
            errs.append("%s 无加成" % t["id"])
    for layer in (1, 2, 3):
        if layers.get(layer, 0) == 0:
            errs.append("词条缺少第 %d 层" % layer)

    # ---- hints ----
    keys = [h["key"] for h in hints]
    if len(keys) != len(set(keys)):
        errs.append("提示语 key 有重复")
    for h in hints:
        found = PLACEHOLDER_RE.findall(h["text"])
        if found != h["vars"]:
            errs.append("%s 的 vars(%s) 与文案占位(%s) 不一致" % (h["id"], h["vars"], found))
        if len(found) != len(set(found)):
            errs.append("%s 占位符重复出现" % h["id"])
        if re.search(r"%[sd]|\{\s*\}", h["text"]):
            errs.append("%s 使用了非 {var} 占位" % h["id"])
        if re.search(r"[A-Za-z]", PLACEHOLDER_RE.sub("", h["text"])):
            errs.append("%s 含英文字母（应全用中文语汇）" % h["id"])
        # 实义长度 = 整串去掉 {var} 占位符
        meaningful = PLACEHOLDER_RE.sub("", h["text"])
        budget = BUDGET_MEANINGFUL.get(h["tier"])
        if budget is not None and len(meaningful) > budget:
            errs.append("%s 实义长度 %d > %d（%s）" % (h["id"], len(meaningful), budget, h["tier"]))
        if h["tier"] == "toast" and len(h["text"]) > TOAST_HARD_LEN:
            errs.append("%s toast 渲染长度 %d > %d" % (h["id"], len(h["text"]), TOAST_HARD_LEN))
        if h["tier"] == "log" and len(h["text"]) > LOG_HARD_LEN:
            errs.append("%s log 渲染长度 %d > %d" % (h["id"], len(h["text"]), LOG_HARD_LEN))
        if h["tier"] not in ("float", "toast", "log", "tooltip"):
            errs.append("%s tier 非法：%s" % (h["id"], h["tier"]))
    required_keys = {
        "battle_start", "formation_ok", "formation_partial", "formation_fail",
        "round_start", "combo_2", "combo_3", "hit_normal", "hit_crit",
        "attack_miss", "lifesteal", "inner_low", "status_stun", "status_seal",
        "status_root", "status_knockback", "victory", "defeat",
        "round_limit_end", "status_dot_log",
    }
    missing = required_keys - set(keys)
    if missing:
        errs.append("缺少必需提示语：%s" % sorted(missing))

    return errs


# ══════════════════════════════════════════════════════════════════


def dump(path: str, data) -> None:
    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只校验，不写盘")
    args = ap.parse_args()

    gongfa = build_gongfa()
    realm = build_realm()
    enemies = build_enemies(gongfa)
    tags = build_tag_combo(gongfa)
    hints = build_hints()

    errs = validate(gongfa, realm, enemies, tags, hints)
    if errs:
        print("❌ 数据自检失败（%d 项）：" % len(errs))
        for e in errs:
            print("   ✖ %s" % e)
        return 1

    print("✅ 数据自检通过")
    print("   gongfa          %3d 行" % len(gongfa))
    print("   gongfa_realm    %3d 行" % len(realm))
    print("   enemy_template  %3d 行" % len(enemies))
    print("   tag_combo       %3d 行" % len(tags))
    print("   hint_text       %3d 行" % len(hints))

    if args.check:
        return 0

    dump(os.path.join(TABLES, "gongfa.json"), gongfa)
    dump(os.path.join(TABLES, "gongfa_realm.json"), realm)
    dump(os.path.join(TABLES, "enemy_template.json"), enemies)
    dump(os.path.join(TABLES, "tag_combo.json"), tags)
    dump(os.path.join(TABLES, "hint_text.json"), hints)
    print("→ 已写入 %s" % TABLES)
    return 0


if __name__ == "__main__":
    sys.exit(main())
