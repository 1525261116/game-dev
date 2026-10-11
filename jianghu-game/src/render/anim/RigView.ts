/**
 * 骨架视图（RigView）：把动画内核算出的「骨骼世界坐标」用 Phaser 画出来。
 *
 * 职责单一：**只负责画**，不含任何游戏逻辑。
 *   - 输入：动画内核 sampleClip() 算好的 SolvedPose
 *   - 输出：屏幕上的 17 个部件矩形
 *
 * 为什么用「预创建 + 每帧只改属性」而不是「每帧重建对象」？
 *   每帧 new 对象会让浏览器垃圾回收频繁触发，手机上直接掉帧。
 *   部件数量固定为 17 个，一次建好、之后只改位置/角度，性能最好。
 *
 * （美术贴图接入后，这里把 Rectangle 换成 Image 即可，其余逻辑不变。）
 */
import Phaser from 'phaser';
import type { RigDef, SlotName, SolvedPose } from '../../core/anim/types.ts';

/**
 * 绘制层级：数组越靠前画在越下层。
 * 顺序按"离镜头远近"排：披风 → 腿 → 左臂 → 躯干 → 右臂 → 头 → 武器。
 */
const DRAW_ORDER: SlotName[] = [
  'cloak',
  'thighL',
  'shinL',
  'footL',
  'thighR',
  'shinR',
  'footR',
  'upperArmL',
  'forearmL',
  'handL',
  'pelvis',
  'torso',
  'upperArmR',
  'forearmR',
  'handR',
  'head',
  'weapon',
];

/** 把 '#8c3b34' 这种颜色字符串转成 Phaser 要的数字 */
function hexToInt(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16);
}

export class RigView {
  /** 承载全部部件的容器：移动容器即可整体移动角色 */
  private readonly container: Phaser.GameObjects.Container;
  /** slot → 部件矩形，避免每帧查找 */
  private readonly parts = new Map<SlotName, Phaser.GameObjects.Rectangle>();
  /** 基础缩放（不含朝向） */
  private baseScale = 1;
  /** 朝向：1 = 面向右，-1 = 面向左 */
  private facing: 1 | -1 = 1;

  constructor(scene: Phaser.Scene, rig: RigDef, x: number, y: number) {
    this.container = scene.add.container(x, y);

    for (const slot of DRAW_ORDER) {
      const bone = rig.bones.find((b) => b.slot === slot);
      if (!bone) continue; // 该体型没有这个部件（例如 cloaking 可选）

      const rect = scene.add.rectangle(0, 0, bone.w, bone.h, hexToInt(bone.color));
      // 枢轴 = 关节旋转中心，必须与骨架定义一致，否则一摆就穿模
      rect.setOrigin(bone.pivot?.x ?? 0.5, bone.pivot?.y ?? 0.5);
      // 墨迹描边：剪纸 / 皮影的水墨观感
      if (bone.ink !== false) rect.setStrokeStyle(1.6, 0x18181c, 0.72);

      this.container.add(rect);
      this.parts.set(slot, rect);
    }
  }

  /**
   * 套用一帧姿态。
   * @param pose 动画内核算出的世界坐标姿态
   */
  apply(pose: SolvedPose): void {
    for (const bone of pose.bones) {
      const rect = this.parts.get(bone.slot);
      if (!rect) continue;
      rect.setPosition(bone.wx, bone.wy);
      rect.setRotation(bone.wrot);
      rect.setScale(bone.wsx, bone.wsy);
    }
  }

  /** 整体缩放（用于表现镜头推近） */
  setScale(s: number): void {
    this.baseScale = s;
    this.applyTransform();
  }

  /**
   * 设置朝向：1 = 面向右（美术原始朝向），-1 = 面向左。
   *
   * 按 docs/rig-spec.md §4 的规则：**贴图只画"面向右"一个方向**，
   * 朝左直接用程序水平镜像 —— 这一条让贴图量直接省一半。
   */
  setFacing(dir: 1 | -1): void {
    this.facing = dir;
    this.applyTransform();
  }

  /** 缩放与朝向合并应用（用负数缩放实现镜像） */
  private applyTransform(): void {
    this.container.setScale(this.baseScale * this.facing, this.baseScale);
  }

  /** 整体位置 */
  setPosition(x: number, y: number): void {
    this.container.setPosition(x, y);
  }

  /** 销毁（切换角色时调用，避免对象泄漏） */
  destroy(): void {
    this.container.destroy(true);
    this.parts.clear();
  }
}
