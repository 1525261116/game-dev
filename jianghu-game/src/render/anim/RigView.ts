/**
 * 骨架视图（RigView）：把动画内核算出的「骨骼世界坐标」用 Phaser 画出来。
 *
 * 职责单一：**只负责画**，不含任何游戏逻辑。
 *   - 输入：动画内核 sampleClip() 算好的 SolvedPose
 *   - 输出：屏幕上的 17 个部件（**有贴图用贴图，没贴图用色块**）
 *
 * 为什么用「预创建 + 每帧只改属性」而不是「每帧重建对象」？
 *   每帧 new 对象会让浏览器垃圾回收频繁触发，手机上直接掉帧。
 *   部件数量固定为 17 个，一次建好、之后只改位置/角度，性能最好。
 *
 * ══════════════════════════════════════════════════════════════════
 * 贴图接入的关键设计（这一版新增）：
 *
 *   ① **两种部件对象二选一**：`Phaser.GameObjects.Image`（有图）或
 *      `.Rectangle`（无图）。二者的公有 API（setPosition / setRotation /
 *      setScale / setOrigin）一致，所以 apply() 里不需要分支。
 *
 *   ② **贴图缩放要乘在姿态缩放之上**：色块的宽高建对象时就定好了，
 *      而贴图有"画布 @2× → 游戏内 1×"的换算，所以每个部件要记住一对
 *      baseScale(texW→boneW)，apply() 时用 baseScale × 姿态缩放。
 *      忘了这一步的典型症状是：一播动作角色就忽大忽小。
 *
 *   ③ **缺图必须能跑**：美术画到一半（只画了 5 个部件）时游戏不能黑屏 ——
 *      缺哪个部件就那个部件回落成色块，其余照常显示贴图。
 *
 *   ④ **换色（palette）**：`art` 复用同一套图 + 逐 slot tint，是 rig-spec §8
 *      「1 个弟子 = 10 分钟」的实现方式。
 * ══════════════════════════════════════════════════════════════════
 */
import Phaser from 'phaser';
import type { ResolvedSkin } from './SkinRegistry.ts';
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

/** 一个部件：对象 + 贴图→骨架盒的基准缩放（色块为 1,1） */
interface PartEntry {
  obj: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
  baseSx: number;
  baseSy: number;
}

export class RigView {
  /** 承载全部部件的容器：移动容器即可整体移动角色 */
  private readonly container: Phaser.GameObjects.Container;
  /** slot → 部件，避免每帧查找 */
  private readonly parts = new Map<SlotName, PartEntry>();
  /** 基础缩放（不含朝向） */
  private baseScale = 1;
  /** 朝向：1 = 面向右，-1 = 面向左 */
  private facing: 1 | -1 = 1;
  /** 当前生效的皮肤（供调试面板显示） */
  readonly skinId: string | null;

  constructor(scene: Phaser.Scene, rig: RigDef, x: number, y: number, skin: ResolvedSkin | null = null) {
    this.container = scene.add.container(x, y);
    this.skinId = skin?.id ?? null;

    for (const slot of DRAW_ORDER) {
      const bone = rig.bones.find((b) => b.slot === slot);
      if (!bone) continue; // 该体型没有这个部件（例如不用飘带、拳掌没有武器）

      const pivot = { x: bone.pivot?.x ?? 0.5, y: bone.pivot?.y ?? 0.5 };
      const key = skin?.parts[slot];
      const hasTexture = !!key && scene.textures.exists(key);

      if (hasTexture) {
        const img = scene.add.image(0, 0, key!);
        img.setOrigin(pivot.x, pivot.y);
        // 画布 @2× → 游戏内按骨架盒尺寸显示
        const tex = scene.textures.get(key!);
        const baseSx = tex.getSourceImage().width > 0 ? bone.w / tex.getSourceImage().width : 1;
        const baseSy = tex.getSourceImage().height > 0 ? bone.h / tex.getSourceImage().height : 1;
        img.setScale(baseSx, baseSy);
        const tint = skin?.tint?.[slot];
        if (tint !== undefined) img.setTint(tint);
        this.container.add(img);
        this.parts.set(slot, { obj: img, baseSx, baseSy });
      } else {
        // 回退：占位色块（美术未到位 / 该部件故意留空）
        const rect = scene.add.rectangle(0, 0, bone.w, bone.h, hexToInt(bone.color));
        rect.setOrigin(pivot.x, pivot.y);
        // 墨迹描边：剪纸 / 皮影的水墨观感
        if (bone.ink !== false) rect.setStrokeStyle(1.6, 0x18181c, 0.72);
        this.container.add(rect);
        this.parts.set(slot, { obj: rect, baseSx: 1, baseSy: 1 });
      }
    }
  }

  /**
   * 套用一帧姿态。
   * 注意贴图要乘上 baseScale —— 见文件头 ② 的说明。
   */
  apply(pose: SolvedPose): void {
    for (const bone of pose.bones) {
      const entry = this.parts.get(bone.slot);
      if (!entry) continue;
      entry.obj.setPosition(bone.wx, bone.wy);
      entry.obj.setRotation(bone.wrot);
      entry.obj.setScale(entry.baseSx * bone.wsx, entry.baseSy * bone.wsy);
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

  /** 整体透明度（阵亡淡出等表现用） */
  setAlpha(a: number): void {
    this.container.setAlpha(a);
  }

  /**
   * 命中闪白：贴图用 tint 高亮一帧。
   * 色块没有 tint，所以只对贴图生效（不报错、静默跳过）。
   */
  flashWhite(): void {
    for (const [slot, entry] of this.parts) {
      if (!(entry.obj instanceof Phaser.GameObjects.Image)) continue;
      const img = entry.obj as Phaser.GameObjects.Image;
      const prev = img.tintTopLeft;
      img.setTintFill(0xffffff);
      setTimeout(() => {
        if (img.active) img.setTint(prev === 0xffffff ? 0xffffff : prev);
      }, 60);
      void slot;
    }
  }

  /** 销毁（切换角色时调用，避免对象泄漏） */
  destroy(): void {
    this.container.destroy(true);
    this.parts.clear();
  }
}
