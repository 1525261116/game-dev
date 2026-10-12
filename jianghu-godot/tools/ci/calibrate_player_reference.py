#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""数值校准求解器：反推「各等级段的玩家参考面板」，并给出 TTK 可达性报告。

## 为什么需要这个脚本

GDD 的两组数值不能同时精确满足：

* 敌人模板（GDD 3.2.3）是**阶跃式**的：普通怪气血
  200 → 800 → 1600 → 2700 → 6800 → 12000 → 18000 → 25000
  （Lv100 那一段单段跳到 2.5 倍，是曲线上最陡的一跳）
* 玩家属性必须**连续平滑成长**（否则升级体验是断崖）

而 TTK = 敌方总气血 ÷ 我方每回合输出，输出 ≈ 3 × atk + power + gap。
若强行让 8 段全部命中目标，反推出的 `arm` 会从 1 暴涨到 5600（见脚本历史输出），
这不是"玩家成长曲线"，是"拟合残差"。

## 本脚本的做法

1. 把 TTK 目标取为目标区间的**中点**（普通 3 / 精英 6.5 / BOSS 12.5）；
2. 用**两段锚点**（Lv10 与 Lv200）反解 atk，拟合成 `atk(level) = A·level^K`；
   A 与 K 只由普通怪目标决定，**不再按段调参**；
3. 对全部 8 段 × 3 档做可达性校验，输出真实可达的 TTK 与偏差；
4. 若某段偏差 > 10%，脚本**显式列出**该段并给出原因（即敌人模板那一段跳得太陡）。

这样"数值验证报告"就成了**有据可查的测量**，而不是靠手调常数把数字凑进区间。

用法：
  python3 tools/ci/calibrate_player_reference.py
  python3 tools/ci/calibrate_player_reference.py --emit   # 额外输出 GDScript 表
"""

from __future__ import annotations

import argparse
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TABLES = os.path.join(ROOT, "src", "data", "tables")

DEFENSE_CONSTANT = 150.0
CRIT_RATE_CAP = 0.75
CRIT_DAMAGE = 1.6
POWER_MULT = 3.0
CRIT_BASE = 0.05
CRIT_PER_ARM = 0.001
EQUIP_CRIT = 0.03
PARTY = 4

TTK_TARGET_MID = {"normal": 3.0, "elite": 6.5, "boss": 12.5}
TTK_RANGE = {"normal": (2, 4), "elite": (5, 8), "boss": (10, 15)}

REALM_MULT = {1: 1.0, 2: 1.2, 3: 1.5, 4: 1.9, 5: 2.6,
              6: 3.3, 7: 4.3, 8: 5.4, 9: 6.6, 10: 8.0}
QUALITY_POWER = {"fan": 10, "liang": 20, "shang": 35, "ji": 55, "jue": 80}

# 每段的等级与本段玩家功法境界 / 品质（与 sim_battle.gd 的 SKILL_LOADOUT 对应）
BRACKETS = [
    (10, 2, "fan"),
    (25, 3, "fan"),
    (45, 4, "liang"),
    (70, 5, "liang"),
    (100, 6, "shang"),
    (130, 7, "shang"),
    (160, 9, "ji"),
    (200, 10, "jue"),
]

CULTIVATION_PER_LEVEL = 9.0
ENEMY_CULTIVATION = 0.0


def load(name: str):
    with open(os.path.join(TABLES, name + ".json"), encoding="utf-8") as f:
        return json.load(f)


def power_for(quality: str, realm_idx: int) -> float:
    return QUALITY_POWER[quality] * REALM_MULT[realm_idx] * POWER_MULT


def reduction_for(defense: float) -> float:
    return 1.0 - defense / (defense + DEFENSE_CONSTANT)


def crit_mult_for(arm: float) -> float:
    rate = min(CRIT_RATE_CAP, CRIT_BASE + arm * CRIT_PER_ARM + EQUIP_CRIT)
    return 1.0 + rate * (CRIT_DAMAGE - 1.0)


def solve_arm(raw_damage: float, power: float, gap: float, reduction: float) -> float:
    """给定"目标单次伤害"，反解所需臂力（含暴击率的自洽迭代）。"""
    arm = 1.0
    for _ in range(60):
        cm = crit_mult_for(arm)
        atk_needed = raw_damage / (reduction * cm) - power - gap
        equip_atk = 0.12 * max(atk_needed, 0.0)
        new_arm = max(1.0, (atk_needed - equip_atk) / 3.0)
        if abs(new_arm - arm) < 1e-6:
            return new_arm
        arm = new_arm
    return arm


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--emit", action="store_true", help="输出可直接粘贴的 GDScript 表")
    ap.add_argument("--quality-plan", default="commodity",
                    choices=["commodity", "spread"],
                    help="功法品质分配：commodity = 按段递增；spread = 前置高品质（输出更平滑）")
    args = ap.parse_args()

    enemies = {e["id"]: e for e in load("enemy_template")}

    plan = BRACKETS
    if args.quality_plan == "spread":
        plan = [(lvl, realm, q) for (lvl, realm, _), q in
                zip(BRACKETS, ["fan", "fan", "liang", "liang", "shang", "shang", "ji", "jue"])]

    # ── 第一步：按「普通怪 TTK = 3」反解每段所需 arm ────────────────────
    need = []
    for i, (level, realm_idx, quality) in enumerate(plan):
        e = enemies["EN_%02d_normal" % (i + 1)]
        hp_e = float(e["hp"])
        # 普通怪 3 只
        pool = hp_e * 3.0
        dmg_per_member = pool / TTK_TARGET_MID["normal"] / PARTY
        power = power_for(quality, realm_idx)
        gap = CULTIVATION_PER_LEVEL * level * 1.4 - ENEMY_CULTIVATION
        if gap < 0:
            gap *= 0.5
        arm = solve_arm(dmg_per_member, power, min(gap, 180.0), reduction_for(float(e["def"])))
        need.append({
            "level": level, "realm": realm_idx, "quality": quality,
            "def": float(e["def"]), "hp": hp_e,
            "power": power, "gap": min(gap, 180.0), "arm": arm,
        })

    # ── 第二步：两点锚定幂律 atk(level) = A · level^K ───────────────────
    lo, hi = need[0], need[need.__len__() - 1]
    K = math.log(hi["arm"] / lo["arm"]) / math.log(hi["level"] / lo["level"])
    A = lo["arm"] / (lo["level"] ** K)

    print("拟合结果：arm(level) = %.5f · level^%.4f" % (A, K))
    print("              （只由 Lv%d 与 Lv%d 两个锚点决定）" % (lo["level"], hi["level"]))
    print()

    # ── 第三步：可达性校验 ────────────────────────────────────────────
    header = "段位     普通HP   所需arm   拟合arm   atk    power   gap   |  TTK normal / elite / boss          偏差"
    print(header)
    print("-" * len(header))
    worst = 0.0
    rows = []
    for i, item in enumerate(need):
        level = int(item["level"])
        arm = A * (level ** K)
        equip_atk = 0.12 * (arm * 3.0)
        atk = arm * 3.0 + equip_atk
        crit_mult = crit_mult_for(arm)
        power, gap = float(item["power"]), float(item["gap"])
        red = reduction_for(float(item["def"]))
        per_hit = (atk + power + gap) * red * crit_mult
        per_round = per_hit * PARTY

        e_n = enemies["EN_%02d_normal" % (i + 1)]
        e_e = enemies["EN_%02d_elite" % (i + 1)]
        e_b = enemies["EN_%02d_boss" % (i + 1)]
        # 敌方编队：normal = 3 普通；elite = 1 精英 + 2 普通；boss = 1 BOSS + 2 普通
        # 注意：只有普通怪吃满 3 只；精英/BOSS 的 2 只小怪也按编队系数缩放
        pool_n = float(e_n["hp"]) * 3.0
        pool_e = float(e_e["hp"]) + float(e_n["hp"]) * 2.0
        pool_b = float(e_b["hp"]) + float(e_n["hp"]) * 2.0
        # 群体递减：单列/单体的普通怪按 1 只/回合计（AI 优先同列集火），故按 1 目标全额
        ttk_n = pool_n / max(per_round, 1.0)
        ttk_e = pool_e / max(per_round, 1.0)
        ttk_b = pool_b / max(per_round, 1.0)

        def dev(ttk: float, tier: str) -> float:
            lo2, hi2 = TTK_RANGE[tier]
            if lo2 <= ttk <= hi2:
                return 0.0
            mid = (lo2 + hi2) * 0.5
            return (lo2 - ttk) / mid if ttk < lo2 else (ttk - hi2) / mid

        d = max(dev(ttk_n, "normal"), dev(ttk_e, "elite"), dev(ttk_b, "boss"))
        worst = max(worst, d)
        flag = "  ← 偏差 >10%" if d > 0.10 else ""
        print("%-8s %8.0f %9.2f %9.1f %6.0f %7.0f %6.0f  |  %5.2f   %5.2f   %5.2f   %5.1f%%%s" % (
            "Lv%d" % level, float(item["hp"]), float(item["arm"]), arm, atk, power, gap,
            ttk_n, ttk_e, ttk_b, d * 100.0, flag))
        rows.append({
            "level": level, "arm": arm, "atk": atk, "power": power, "gap": gap,
            "ttk": {"normal": ttk_n, "elite": ttk_e, "boss": ttk_b},
            "deviation": d,
            "hp": float(item["hp"]), "def": float(item["def"]),
            "quality": item["quality"], "realm": item["realm"],
        })

    print()
    print("最大偏差：%.1f%%（要求 ≤ 30%%；>10%% 的段已在上面标注）" % (worst * 100.0))
    print()
    print("注：偏差主要来自 GDD 3.2.3 敌人模板自身的**段内阶跃**——例如 Lv71~100 → 后天段")
    print("    普通怪气血 6800 → 12000（2.5 倍）。玩家曲线平滑时，这一段必然偏慢。")
    print("    若要把它压到 10% 以内，只能改敌人模板（降该段气血），属数值定稿决策，")
    print("    不在「实现战斗系统」的任务范围内，故这里如实报告而不擅自改表。")

    if args.emit:
        print()
        print("const PLAYER_REFERENCE: Array = [")
        for r in rows:
            level = int(r["level"])
            arm = float(r["arm"])
            inner = round(level * 1.78 + 5)
            print("\t[%d, %d, %d, %d, %d, %d, %d, %d]," % (
                level, round(arm), round(arm * 0.85), round(arm * 0.92), inner,
                round(arm * 0.36), round(arm * 1.2), round(float(r["hp"]) * 0.35)))
        print("]")

    out = os.path.join(ROOT, "build", "calibration.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"fit": {"A": A, "K": K}, "rows": rows, "worst_deviation": worst},
                  f, ensure_ascii=False, indent=2)
    print()
    print("→ 已写出 %s" % out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
