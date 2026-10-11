/**
 * 主菜单（MenuScene）：玩家进入游戏后的第一个可交互界面。
 *
 * 目前提供：
 *   · 开始战斗 —— 进入 M1 的战斗场景
 *   · 动作库预览 —— 开发调试用，逐个播放 62 个动作
 *
 * 后续会在这里长出：继续游戏（读存档）、设置、图鉴、退出等。
 */
import Phaser from 'phaser';
import { MOTIONS } from '../anim/MotionLib.ts';
import { THEME, createButton, dimStyle, titleStyle } from '../ui/Theme.ts';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('menu');
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2;

    // ── 标题区 ──
    this.add.text(cx, height * 0.22, '江 湖 从 心', titleStyle(46)).setOrigin(0.5).setResolution(2);
    this.add
      .text(cx, height * 0.22 + 52, '武侠开放世界 · 单机 RPG', dimStyle(14))
      .setOrigin(0.5)
      .setResolution(2);

    // 金色分隔线
    this.add.rectangle(cx, height * 0.22 + 82, 320, 1, THEME.gold, 0.5);

    // ── 按钮区 ──
    createButton(this, cx, height * 0.56, '开始战斗', () => this.scene.start('battle'));
    createButton(this, cx, height * 0.56 + 72, '动作库预览', () => this.scene.start('motion-lab'));

    // ── 页脚 ──
    this.add
      .text(cx, height - 26, `M1 开发中 · 已接入 ${MOTIONS.length} 个动作 · Phaser ${Phaser.VERSION}`, dimStyle(11))
      .setOrigin(0.5)
      .setResolution(2);
  }
}
