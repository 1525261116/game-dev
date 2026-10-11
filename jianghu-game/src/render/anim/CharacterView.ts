/**
 * 角色视图（CharacterView）：把「骨架渲染 + 动作播放 + 朝向」打包成一个可复用的整体。
 *
 * 为什么需要它？
 *   战斗场景里会同时出现 6~10 个角色。如果每个角色都自己写"推进时间、采样动作、
 *   套用姿态、处理命中事件"，代码会重复十几遍且容易不一致。
 *   抽出 CharacterView 之后，每个角色只是一次 `new CharacterView(...)`。
 *
 * 分层：本文件属于表现层，只读动作数据、只画画面，不产生任何数值。
 */
import { sampleClip } from '../../core/anim/clip.ts';
import { getRig } from '../../data/rigs.ts';
import { getMotion } from './MotionLib.ts';
import { RigView } from './RigView.ts';
import type Phaser from 'phaser';
import type { MotionClip, RigDef } from '../../core/anim/types.ts';

export class CharacterView {
  private readonly view: RigView;
  private readonly rig: RigDef;

  /** 当前播放的动作（null = 静止不动） */
  private clip: MotionClip | null = null;
  /** 已播放时间（毫秒） */
  private elapsed = 0;
  /** 上一帧时间，用于筛选"这一帧内触发的事件" */
  private prevT = -1;

  /** 非循环动作是否已播完（战斗流程靠它判断"该下一个了"） */
  finished = true;

  /** 命中事件回调：由战斗场景注入，用来在该帧播打击特效 */
  onHit?: () => void;
  /** 动作播放完毕回调 */
  onFinished?: () => void;

  constructor(scene: Phaser.Scene, x: number, y: number, facing: 1 | -1 = 1, rigId = 'male_adult') {
    this.rig = getRig(rigId);
    this.view = new RigView(scene, this.rig, x, y);
    this.view.setFacing(facing);
  }

  /** 播放指定 id 的动作；返回 false 表示动作库中没有这个动作 */
  play(clipId: string): boolean {
    const clip = getMotion(clipId);
    if (!clip) return false;
    this.clip = clip;
    this.elapsed = 0;
    this.prevT = -1;
    this.finished = false;
    return true;
  }

  /** 当前正在播的动作 id（供 UI 显示 / 调试） */
  get currentClipId(): string | null {
    return this.clip?.id ?? null;
  }

  /** 每帧推进；delta 为距上一帧的毫秒数 */
  update(delta: number): void {
    if (!this.clip) return;
    const clip = this.clip;

    this.elapsed += delta;
    // 循环动作取模，非循环动作停在末尾
    const t = clip.loop ? this.elapsed % clip.duration : Math.min(this.elapsed, clip.duration);

    const pose = sampleClip(clip, this.rig, t, this.prevT);
    this.view.apply(pose);

    // 把动作内的时间轴事件转成外部回调（表现层专用，不参与数值）
    for (const ev of pose.firedEvents) {
      if (ev.type === 'hit') this.onHit?.();
    }
    this.prevT = t;

    if (!clip.loop && this.elapsed >= clip.duration && !this.finished) {
      this.finished = true;
      this.onFinished?.();
    }
  }

  setScale(s: number): void {
    this.view.setScale(s);
  }

  setFacing(dir: 1 | -1): void {
    this.view.setFacing(dir);
  }

  setPosition(x: number, y: number): void {
    this.view.setPosition(x, y);
  }

  destroy(): void {
    this.view.destroy();
  }
}
