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
import { getRig, DEFAULT_RIG_ID } from '../../data/rigs.ts';
import { getMotion } from './MotionLib.ts';
import { RigView } from './RigView.ts';
import { resolveUnitSkin } from './SkinRegistry.ts';
import type Phaser from 'phaser';
import type { MotionClip, RigDef } from '../../core/anim/types.ts';

/** 建角色视图时的可选参数（不传 = 用占位色块，行为与接入贴图之前一致） */
export interface CharacterOptions {
  /** 皮肤 id（units.csv 的 charId）。给了就用贴图，没给/没加载到就回退色块 */
  skinId?: string;
  /** 武器组与主要功法品质：决定武器外观（按「组 × 品质」共享贴图） */
  weaponGroup?: string;
  weaponQuality?: string;
  /** 体型 id；不传则取皮肤声明的体型，再退回默认体型 */
  rigId?: string;
}

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

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    facing: 1 | -1 = 1,
    opts: CharacterOptions = {},
  ) {
    // 皮肤决定体型与贴图；两者都没有时退回占位色块（保证美术没到位也能跑）
    const skin = resolveUnitSkin(opts.skinId, opts.weaponGroup, opts.weaponQuality);
    this.rig = getRig(opts.rigId ?? skin?.body ?? DEFAULT_RIG_ID);
    this.view = new RigView(scene, this.rig, x, y, skin);
    this.view.setFacing(facing);
  }

  /** 当前使用的皮肤 id（调试面板用） */
  get skinId(): string | null {
    return this.view.skinId;
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

  setAlpha(a: number): void {
    this.view.setAlpha(a);
  }

  /** 命中闪白（只对贴图生效；色块静默跳过） */
  flashWhite(): void {
    this.view.flashWhite();
  }

  destroy(): void {
    this.view.destroy();
  }
}
