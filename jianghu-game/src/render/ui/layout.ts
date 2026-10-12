/**
 * 画布与战场布局（**唯一真相**）
 *
 * 为什么要有这个文件？
 *   原来 960×540 这套坐标被硬编码在 BattleScene / BattleLabScene / main.ts 三处，
 *   结果"改分辨率"变成一场抓漏游戏。现在所有空间数字都从这里取，改一处全线生效。
 *
 * ══════════════════════════════════════════════════════════════════
 * 纵向预算（这张表是调参的核心，改任何一个数字都要重算）
 *
 *   一个单位的纵向占用 = 头顶信息栈(125) + 角色高度(148 × CHAR_SCALE)
 *   三个「列」在同一个 x 上上下堆叠（slot 0/1/2 都是同一排、同 x），
 *   所以 **行距必须 ≥ 纵向占用**，否则上一行的脚会压到下一行的信息栈。
 *
 *   CHAR_SCALE = 0.95 → 占用 = 125 + 140.6 ≈ 266？不 —— 见下面的实测口径：
 *     角色原点在骨盆，头顶在 −78×S，脚底在 +70×S
 *     信息栈在 −125 .. −79（状态图标/血条/内力条/姓名行）
 *     → 占用 = 125 + 70×S
 *     S=0.95 → 125 + 66.5 = 191.5 → 行距取 200，留 8.5px 余量
 *
 *   可用高度 = 720 − HUD(70) − 底部按钮区(72) = 578
 *   三行占用 = 200×2 + 191.5 = 591.5 > 578 ✗
 *   → 所以第一行上移、按钮压到底：首行 y=200 时栈顶 75（HUD 70 之下 ✓），
 *     末行脚底 666.5，按钮 677..711（10px 余量 ✓）
 * ══════════════════════════════════════════════════════════════════
 */
import type { SlotIndex } from '../../core/battle/types.ts';

/** 逻辑分辨率。相对旧的 960×540 正好 ×4/3 —— 所有旧布局数字乘以 4/3 即可 */
export const VIEW_W = 1280;
export const VIEW_H = 720;

/** 旧画布 → 新画布的等比系数（用于把为 960×540 写死的常量搬过来） */
export const SCALE_FROM_960 = VIEW_W / 960;

/**
 * 战场参数。
 *
 * 相比 960×540 那一版，这里做的是**真实放大**：
 *   角色缩放 0.52 → 0.95（角色高 77 → 141 逻辑像素）
 *   同时画布被浏览器放大的倍数从 1.56× 降到 1.17×（同一窗口下），所以是"更大且更清楚"。
 */
export const FIELD = {
  /** 三排的 x（纵深）：前排最靠中线，后排最靠本阵后方 */
  depthX: [520, 390, 260] as const,
  /** 三个「列」的起始 y 与行距（同列三个单位上下堆叠） */
  baseY: 200,
  stepY: 200,
  /** 角色缩放（相对骨架 148px） */
  charScale: 0.95,
  /** 头顶信息栈（相对角色原点，负 = 向上） */
  statusY: -86,
  hpBarY: -99,
  innerBarY: -107,
  infoY: -119,
  /** 脚下投影 */
  shadowY: 66,
  /** 血条/内力条宽度与高度 */
  hpBarW: 104,
  hpBarH: 7,
  innerBarH: 4,
  /** 状态图标尺寸 */
  statusIcon: 14,
  /** 站位环（场地标记） */
  ringW: 78,
  ringH: 24,
  /** 中央留白区（禁止常驻 UI）：中线左右各 160px */
  centerGapHalf: 160,
} as const;

/** 九宫格站位 → 屏幕坐标（己方左、敌方右镜像） */
export function slotPosition(slot: SlotIndex, side: 'ally' | 'enemy'): { x: number; y: number } {
  const row = Math.floor(slot / 3); // 0 前排 / 1 中排 / 2 后排
  const col = slot % 3; // 0 上 / 1 中 / 2 下
  const depthX = FIELD.depthX[row]!;
  const y = FIELD.baseY + col * FIELD.stepY;
  return side === 'ally' ? { x: depthX, y } : { x: VIEW_W - depthX, y };
}

/** HUD 横幅高度（第一行的信息栈从 y=75 开始，所以不能再高） */
export const HUD_H = 70;

/** 底部按钮的 y 与尺寸 */
export const BUTTON_Y = 694;
export const BUTTON_W = 168;
export const BUTTON_H = 34;
