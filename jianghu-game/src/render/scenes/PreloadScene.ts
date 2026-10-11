/**
 * 资源加载页（PreloadScene）：玩家等待的地方。
 *
 * 设计原则：**进度条必须对应真实的准备工作**，不做假动画。
 * 假的进度条有两个坏处：① 加载慢了会卡在 99% 骗人；② 出错了你看不出来。
 *
 * 当前阶段的"真实准备工作"是：
 *   ① 清点动作库（确认 62 个动作都在）
 *   ② 用校验器全量检查动作数据（站位、挂点、循环一致性…）
 *   ③ 装载 3 套体型骨架
 * 将来美术贴图 / 音频接入后，真正的 preload() 也放在这里。
 */
import Phaser from 'phaser';
import { validateClip } from '../../core/anim/validate.ts';
import { BODY_TYPE_IDS, getRig } from '../../data/rigs.ts';
import { MOTIONS } from '../anim/MotionLib.ts';
import { validateTablesAtRuntime } from '../../data/tables.ts';
import { FONT, THEME, bodyStyle, dimStyle, titleStyle } from '../ui/Theme.ts';

/** 一个加载步骤：label 是给玩家看的说明，run 是真正要做的事 */
interface LoadStep {
  label: string;
  run: () => void;
}

export class PreloadScene extends Phaser.Scene {
  private barBg!: Phaser.GameObjects.Rectangle;
  private barFill!: Phaser.GameObjects.Rectangle;
  private label!: Phaser.GameObjects.Text;
  private percent!: Phaser.GameObjects.Text;

  private steps: LoadStep[] = [];
  private stepIndex = 0;

  /** 校验发现的错误（会显示在屏幕上，绝不静默吞掉） */
  private errors: string[] = [];

  constructor() {
    super('preload');
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2;

    this.add.text(cx, height * 0.34, '江湖从心', titleStyle(40)).setOrigin(0.5).setResolution(2);
    this.add
      .text(cx, height * 0.34 + 44, '武侠开放世界 · 单机 RPG', dimStyle(13))
      .setOrigin(0.5)
      .setResolution(2);

    // ── 进度条 ──
    const barW = 420;
    const barH = 10;
    this.barBg = this.add
      .rectangle(cx, height * 0.6, barW, barH, THEME.line)
      .setStrokeStyle(1, THEME.gold, 0.55);
    this.barFill = this.add
      .rectangle(cx - barW / 2, height * 0.6, 0, barH, THEME.gold)
      .setOrigin(0, 0.5);

    this.label = this.add.text(cx, height * 0.6 - 32, '正在准备…', bodyStyle(14)).setOrigin(0.5).setResolution(2);
    this.percent = this.add.text(cx, height * 0.6 + 30, '0%', dimStyle(12)).setOrigin(0.5).setResolution(2);

    this.steps = [
      {
        label: `正在清点动作库…（${MOTIONS.length} 个动作）`,
        run: () => {
          if (MOTIONS.length === 0) this.errors.push('动作库为空：src/data/motions/ 下没有可加载的动作');
        },
      },
      {
        label: '正在校验动作数据…',
        run: () => {
          for (const clip of MOTIONS) {
            const errs = validateClip(clip).filter((i) => i.level === 'error');
            if (errs.length > 0) {
              this.errors.push(`${clip.id}: ${errs.map((e) => e.code).join(',')}`);
            }
          }
        },
      },
      {
        label: '正在校验配置表…',
        run: () => {
          const { ok, issues } = validateTablesAtRuntime();
          if (!ok) {
            for (const i of issues) {
              this.errors.push(`配置表 ${i.file} 第 ${i.row} 行「${i.field}」：${i.message}`);
            }
          }
        },
      },
      {
        label: '正在装载体型骨架…',
        run: () => {
          for (const id of BODY_TYPE_IDS) getRig(id);
        },
      },
      {
        label: '准备就绪',
        run: () => {
          /* 收尾，无实际工作 */
        },
      },
    ];

    // 每帧跑一步，这样进度条能真实地动起来
    this.time.delayedCall(120, () => this.runNextStep());
  }

  private runNextStep(): void {
    if (this.stepIndex >= this.steps.length) {
      this.finish();
      return;
    }

    const step = this.steps[this.stepIndex]!;
    this.label.setText(step.label);

    // 捕获步骤内的异常：加载页崩掉是最糟糕的体验，必须显示出来而不是白屏
    try {
      step.run();
    } catch (e) {
      this.errors.push(`${step.label} → ${(e as Error).message}`);
    }

    this.stepIndex++;
    this.setProgress(this.stepIndex / this.steps.length);
    this.time.delayedCall(160, () => this.runNextStep());
  }

  private setProgress(p: number): void {
    const barW = 420;
    this.barFill.width = barW * Math.min(1, Math.max(0, p));
    this.percent.setText(`${Math.round(p * 100)}%`);
  }

  private finish(): void {
    if (this.errors.length > 0) {
      // 有错就明说，并留在本场景方便排查（开发期这是最有用的信息）
      this.label.setText('加载时发现问题：').setColor(THEME.redHex);
      this.percent.setText(this.errors.slice(0, 4).join('\n'));
      this.percent.setAlign('center').setFontSize(11);
      this.tweens.add({ targets: this.barBg, alpha: 0.2, yoyo: true, repeat: -1, duration: 400 });
      return;
    }
    this.time.delayedCall(180, () => this.scene.start('menu'));
  }
}
