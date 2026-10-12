# -*- coding: utf-8 -*-
"""把《江湖从心》GDD 各章合并为单文件 Markdown 交付稿（只产出 .md）。

用法：
    python3 build_gdd_md.py

产出：江湖从心_完整策划设计_v1.0.md（项目根目录）

说明：按项目约定，正式交付格式只做 Markdown，不再导出 DOCX。
      （历史导出脚本 build_gdd_docx.py 保留但非必需。）
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent
GDD = ROOT / "jianghu-design" / "GDD"

CHAPTERS = [
    ("00_总览与设计目标.md", "第 0 章 总览与设计目标", "制作人 / 主策"),
    ("01_玩法与核心循环.md", "第 1 章 玩法与核心循环", "全体"),
    ("02_系统设计.md", "第 2 章 系统设计", "系统策划"),
    ("03_数值框架.md", "第 3 章 数值框架", "数值策划"),
    ("04_关卡与内容规划.md", "第 4 章 关卡与内容规划", "关卡策划 / 主程"),
    ("05_生产计划与执行.md", "第 5 章 生产计划与执行", "制作人"),
]

TECH_DOCS = [
    "技术方案与执行计划_v1.0_待确认.md",
    "引擎选型评估报告_v1.0.md",
    "技术架构综合比较_v1.0.md",
    "动画复用方案_v1.0.md",
    "方案C_实施方案与分工估算_v1.0.md",
    "开源方案调研_Phaser生态.md",
    "Godot可行性评估_动画复用专项.md",
    "Godot_MCP_可行性评估.md",
]


def main() -> int:
    parts = [
        "# 江湖从心 · 完整策划设计 v1.0（执行版）",
        "",
        "> 武侠开放世界 · 单机 RPG · 多端（移动端 + PC）",
        "> 依据《江湖从心_策划案_v0.2》与 `jianghu-design/` 全部设计稿收敛而成",
        "",
        "---",
        "",
        "## 目录",
        "",
    ]
    parts += [f"- {title}" for _, title, _ in CHAPTERS]
    parts += [
        "",
        "## 配套技术文档",
        "",
    ]
    parts += [f"- [`jianghu-design/12_tech/{d}`](jianghu-design/12_tech/{d})" for d in TECH_DOCS]
    parts += [
        "",
        "## 如何使用本文件",
        "",
        "| 章节 | 内容 | 主要读者 |",
        "|------|------|----------|",
    ]
    parts += [f"| {title} | — | {who} |" for _, title, who in CHAPTERS]
    parts += [
        "",
        "> 本文件由 `build_gdd_md.py` 从 `jianghu-design/GDD/` 各章自动合并生成。",
        "> **与既有设计稿冲突时以本文件为准**（冲突裁决表见第 0 章 0.9 节）。",
        "",
        "---",
        "",
    ]

    for name, _, _ in CHAPTERS:
        text = (GDD / name).read_text(encoding="utf-8").strip()
        parts.append(text)
        parts += ["", "---", ""]

    out = ROOT / "江湖从心_完整策划设计_v1.0.md"
    out.write_text("\n".join(parts).rstrip() + "\n", encoding="utf-8")
    print(f"[ok] {out}  ({len(out.read_text(encoding='utf-8').splitlines())} 行)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
