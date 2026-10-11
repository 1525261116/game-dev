/**
 * 动作库预览场景（MotionLab）：开发与调试用，不是给玩家看的正式场景。
 *
 * 用途：把 62 个动作逐个播一遍，用来肉眼确认动作数据对不对。
 * 从主菜单的「动作库预览」进入，按 ESC 或点「返回」回到主菜单。
 */
import Phaser from 'phaser';
import { sampleClip } from '../../core/anim/clip.ts';
import { getRig } from '../../data/rigs.ts';
import { MOTIONS } from '../anim/MotionLib.ts';
import { RigView } from '../anim/RigView.ts';
import { FONT, THEME, bodyStyle, createButton, dimStyle, titleStyle } from '../ui/Theme.ts';
import type { MotionClip } from '../../core/anim/types.ts';

/** 非循环动作播完后的停顿（毫秒），停顿完自动切下一个 */
const AUTO_NEXT_GAP = 500;

export class MotionLabScene extends Phaser.Scene {
  private readonly rig = getRig('male_adult');
  private view!: RigView;
  private hud!: Phaser.GameObjects.Text;
  private hitFx!: Phaser.GameObjects.Text;

  private index = 0;
  private elapsed = 0;
  private prevT = -1;

  constructor() {
    super('motion-lab');
  }

  create(): void {
    const { width, height } = this.scale;

    this.add.text(24, 18, '动作库预览', titleStyle(18)).setResolution(2);
    this.add.text(24, 44, `共 ${MOTIONS.length} 个动作 · 空格或点击画面切换`, dimStyle(12)).setResolution(2);

    // 返回主菜单
    createButton(this, width - 90, 34, '返回', () => this.scene.start('menu'), 120, 36);

    // 骨架
    this.view = new RigView(this, this.rig, width / 2, height * 0.68);
    this.view.setScale(1.3);

    // 地面参考线：用来判断小人有没有浮空或陷地
    const groundY = height * 0.68 + 64 * 1.3;
    this.add
      .line(0, 0, width / 2 - 200, groundY, width / 2 + 200, groundY, 0x5a503c, 0.28)
      .setOrigin(0, 0);

    this.hud = this.add.text(24, height - 46, '', bodyStyle(13)).setResolution(2);

    // 命中提示：默认透明，hit 事件触发时闪一下 —— 用来验证事件系统在工作
    this.hitFx = this.add
      .text(width - 24, 74, '命中!', {
        fontFamily: FONT,
        fontSize: '22px',
        color: THEME.redHex,
        fontStyle: 'bold',
      })
      .setOrigin(1, 0)
      .setResolution(2)
      .setAlpha(0);

    this.input.keyboard?.on('keydown-SPACE', () => this.next());
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('menu'));
    this.input.on('pointerdown', () => this.next());
  }

  private current(): MotionClip {
    return MOTIONS[this.index]!;
  }

  private next(): void {
    this.index = (this.index + 1) % MOTIONS.length;
    this.elapsed = 0;
    this.prevT = -1;
  }

  private flashHit(): void {
    this.hitFx.setAlpha(1);
    this.tweens.add({ targets: this.hitFx, alpha: 0, duration: 420 });
  }

  override update(_time: number, delta: number): void {
    const clip = this.current();
    this.elapsed += delta;

    const t = clip.loop ? this.elapsed % clip.duration : Math.min(this.elapsed, clip.duration);
    const pose = sampleClip(clip, this.rig, t, this.prevT);
    this.view.apply(pose);

    for (const ev of pose.firedEvents) {
      if (ev.type === 'hit') this.flashHit();
    }
    this.prevT = t;

    if (!clip.loop && this.elapsed > clip.duration + AUTO_NEXT_GAP) {
      this.next();
      return;
    }

    const pct = Math.round((t / clip.duration) * 100);
    this.hud.setText(
      `${clip.id}　${clip.duration}ms　${clip.loop ? '循环' : '单次'}　` +
        `优先级 ${clip.priority}　${clip.group}　进度 ${pct}%　` +
        `（${this.index + 1} / ${MOTIONS.length}）`,
    );
  }
}
