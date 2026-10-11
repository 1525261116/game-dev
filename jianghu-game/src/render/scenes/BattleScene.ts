/**
 * 战斗场景（BattleScene）：九宫格布阵 + 双方对阵。
 *
 * ⚠️ 本轮的边界（诚实说明）：
 *   这一版做的是**表现层的地基** —— 布阵、站位、动作播放、事件驱动的打击反馈。
 *   **真正的伤害结算还没有接入**（那是 core/battle/simulate.ts 的职责，下一轮做）。
 *   所以现在点「出手」只会演动作，不会掉血。
 *
 * 为什么要先搭表现层？
 *   因为你的架构铁律是「战斗先算完、再回放」。表现层必须先能"照着指令演"，
 *   接上结算时才只是把"指令"换成"从战斗日志读到的真实指令"，表现代码一行都不用改。
 */
import Phaser from 'phaser';
import { CharacterView } from '../anim/CharacterView.ts';
import { THEME, bodyStyle, createButton, dimStyle, titleStyle } from '../ui/Theme.ts';
import type { MotionGroup } from '../../core/anim/types.ts';
import type { SlotIndex } from '../../core/battle/types.ts';

/** 逻辑分辨率（与 main.ts 保持一致） */
const VIEW_W = 960;
const VIEW_H = 540;
/** 九宫格单格尺寸 */
const CELL_W = 92;
const CELL_H = 104;

/**
 * 九宫格站位 → 屏幕坐标。
 *
 * 站位编号来自 core/battle/types.ts：
 *   行（前后）＝ front 0/1/2 · mid 3/4/5 · back 6/7/8
 *   列（上下）＝ 每排内的第 0/1/2 个
 * 视觉上：前排最靠近战场中央，后排退到本方底线。
 */
function slotPosition(slot: SlotIndex, side: 'ally' | 'enemy'): { x: number; y: number } {
  const row = Math.floor(slot / 3); // 0 前排 / 1 中排 / 2 后排
  const col = slot % 3; // 0 上 / 1 中 / 2 下
  // 我方前中后三排的横向位置；敌方做镜像
  const depthX = [352, 258, 164][row]!;
  const y = 158 + col * 116;
  return side === 'ally' ? { x: depthX, y } : { x: VIEW_W - depthX, y };
}

/** 一个参战单位的最小配置（后续会换成真正的角色数据） */
interface Fighter {
  name: string;
  group: MotionGroup;
  slot: SlotIndex;
}

/** 我方 3 人：刀 / 剑 / 拳掌 */
const ALLIES: Fighter[] = [
  { name: '刀客', group: 'dao', slot: 0 },
  { name: '剑客', group: 'jian', slot: 1 },
  { name: '拳师', group: 'quan', slot: 2 },
];

/** 敌方 3 人：长兵 / 暗器 / 奇门 —— 六种武器组正好全部登场 */
const ENEMIES: Fighter[] = [
  { name: '枪手', group: 'qiang', slot: 0 },
  { name: '暗器手', group: 'anqi', slot: 1 },
  { name: '奇门客', group: 'qimen', slot: 2 },
];

export class BattleScene extends Phaser.Scene {
  private allies: CharacterView[] = [];
  private enemies: CharacterView[] = [];
  /** 我方出手轮次，用来轮流让不同角色攻击 */
  private turn = 0;
  private tip!: Phaser.GameObjects.Text;

  constructor() {
    super('battle');
  }

  create(): void {
    this.allies = [];
    this.enemies = [];
    this.turn = 0;

    this.add.text(24, 18, '战斗 · 九宫格对阵', titleStyle(18)).setResolution(2);
    this.add
      .text(24, 44, '本轮只演动作，伤害结算下一轮接入', dimStyle(12))
      .setResolution(2);

    this.drawGrid();

    // 中轴分隔线：让"我方 / 敌方"一眼可辨
    this.add.rectangle(VIEW_W / 2, VIEW_H / 2 + 10, 1, 380, THEME.gold, 0.28);

    // ── 布阵 ──
    for (const f of ALLIES) {
      const p = slotPosition(f.slot, 'ally');
      const c = new CharacterView(this, p.x, p.y, 1); // 我方面向右（朝敌人）
      c.setScale(0.55);
      c.play(`${f.group}_idle`); // 待机动作：循环播放，一直"活着"
      this.allies.push(c);
      this.add.text(p.x, p.y + 58, f.name, dimStyle(11)).setOrigin(0.5).setResolution(2);
    }

    for (const f of ENEMIES) {
      const p = slotPosition(f.slot, 'enemy');
      const c = new CharacterView(this, p.x, p.y, -1); // 敌方镜像面向左
      c.setScale(0.55);
      c.play(`${f.group}_idle`);
      this.enemies.push(c);
      this.add.text(p.x, p.y + 58, f.name, dimStyle(11)).setOrigin(0.5).setResolution(2);
    }

    // ── 提示与按钮 ──
    this.tip = this.add
      .text(VIEW_W / 2, VIEW_H - 74, '点「出手」让我方角色依次攻击', bodyStyle(13))
      .setOrigin(0.5)
      .setResolution(2);

    createButton(this, VIEW_W / 2, VIEW_H - 34, '出手', () => this.attack(), 180, 44);
    createButton(this, VIEW_W - 74, 34, '返回', () => this.scene.start('menu'), 110, 36);
  }

  /** 画九宫格的 9 个站位框（双方各一套） */
  private drawGrid(): void {
    for (let slot = 0 as SlotIndex; slot < 9; slot = (slot + 1) as SlotIndex) {
      for (const side of ['ally', 'enemy'] as const) {
        const p = slotPosition(slot, side);
        this.add
          .rectangle(p.x, p.y, CELL_W, CELL_H, THEME.paperLight, 0.35)
          .setStrokeStyle(1, THEME.line, 0.9);
      }
    }
  }

  /**
   * 出手一次。
   *
   * 关键点：**命中时机不硬编码**。
   * 我们给攻击者挂一个 onHit 回调，动作数据里 `hit` 事件发生在第几毫秒，
   * 回调就在第几毫秒触发 —— 也就是"改动作数据，打击反馈自动跟着变"。
   */
  private attack(): void {
    const i = this.turn % ALLIES.length;
    const attacker = this.allies[i]!;
    const attackerCfg = ALLIES[i]!;

    const j = this.turn % ENEMIES.length;
    const target = this.enemies[j]!;
    const targetCfg = ENEMIES[j]!;

    this.tip.setText(`${attackerCfg.name} 出手 → ${targetCfg.name}`);

    // 命中那一刻，目标播受击动作
    attacker.onHit = () => {
      target.play(`${targetCfg.group}_hit`);
      this.cameras.main.shake(90, 0.004); // 轻微震屏，强化打击感
    };

    // 攻击动作播完，回到待机
    attacker.onFinished = () => {
      attacker.onHit = undefined;
      attacker.onFinished = undefined;
      target.play(`${targetCfg.group}_idle`);
      attacker.play(`${attackerCfg.group}_idle`);
      this.tip.setText('点「出手」让我方角色依次攻击');
    };

    attacker.play(`${attackerCfg.group}_atk_a`);

    // 最后一个人出手时，震屏强一点，作为收招反馈
    if (i === ALLIES.length - 1) this.cameras.main.flash(120, 140, 107, 47, false);

    this.turn++;
  }

  override update(_time: number, delta: number): void {
    // 表现层只管推进动画；数值一律不在这里计算
    for (const c of this.allies) c.update(delta);
    for (const c of this.enemies) c.update(delta);
  }
}
