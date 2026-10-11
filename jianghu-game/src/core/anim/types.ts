/**
 * 动画内核 · 类型定义（纯逻辑，禁止依赖 Phaser）
 *
 * 设计要点（见 docs/rig-spec.md）：
 *  1. slot 命名全局统一，只允许新增贴图、不允许新增 slot
 *  2. 动作数据 = JSON 时间轴（本文件描述其结构）
 *  3. 挂点（anchor）由动作提供，特效只认挂点、不认动作名
 */

/** 统一 slot 名（所有人类角色共用，**新增角色只能新增贴图**） */
export const SLOT_NAMES = [
  'pelvis',
  'torso',
  'head',
  'upperArmL',
  'forearmL',
  'handL',
  'upperArmR',
  'forearmR',
  'handR',
  'thighL',
  'shinL',
  'footL',
  'thighR',
  'shinR',
  'footR',
  'cloak',
  'weapon',
] as const;

export type SlotName = (typeof SLOT_NAMES)[number];

/** 允许的缓动（只保留 4+1 种，统一手感、降低选择成本） */
export type EaseKind = 'linear' | 'sineIn' | 'sineOut' | 'quadIn' | 'backOut';

export interface Vec2 {
  x: number;
  y: number;
}

/** 单个部件在某一时刻的**局部**变换（相对其父骨骼） */
export interface PoseLocal {
  /** 相对静止位姿的额外位移（px，屏幕坐标：+x 右、+y 下） */
  dx: number;
  dy: number;
  /** 相对父骨骼的旋转（弧度） */
  rot: number;
  /** 缩放（1 = 原始） */
  sx: number;
  sy: number;
}

export const IDENTITY_POSE: PoseLocal = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 };

/** 关键帧：只写需要变化的字段，其余取默认 */
export interface Keyframe {
  /** 归一化时间 0~1（也允许传毫秒数，由 clip 的 duration 决定解释方式，见 clip.ts） */
  t: number;
  dx?: number;
  dy?: number;
  rot?: number;
  sx?: number;
  sy?: number;
  ease?: EaseKind;
}

/** 一条轨道 = 一个部件的所有关键帧 */
export interface Track {
  slot: SlotName;
  keys: Keyframe[];
}

/** 挂点名（特效依赖这些名字，**新增动作不得删除已有挂点**） */
export type AnchorName =
  | 'weaponTip' // 武器尖端：斩击/突刺的起点与方向
  | 'palm' // 掌锋：掌风/气劲发射点
  | 'throwPoint' // 掷出点：暗器
  | 'bodyCenter' // 身体中心：环形气劲/护体光
  | 'footPoint' // 脚底：位移残影/落地墨点
  | 'hitPoint'; // 命中落点（由动作给出的参考点，实战时再按目标修正）

/** 挂点关键帧：位置相对**某个 slot 的局部坐标系** */
export interface AnchorKey {
  t: number;
  /** 挂在哪个 slot 上（缺省 = pelvis） */
  slot?: SlotName;
  x: number;
  y: number;
  /** 朝向（弧度），用于特效旋转 */
  angle?: number;
}

export type AnimEventType = 'sfx' | 'hit' | 'vfx' | 'vfxStop' | 'shake';

/** 动作内部事件（表现用，不参与数值计算） */
export interface AnimEvent {
  t: number;
  type: AnimEventType;
  id?: string;
}

/** 一个动作 clip */
export interface MotionClip {
  id: string;
  /** 动作组：6 武器组 + neigong + shenfa */
  group: MotionGroup;
  /** 时长（毫秒） */
  duration: number;
  /** 是否循环（idle 必须循环且首尾一致） */
  loop: boolean;
  /** 打断优先级：down(9) > hit(5) > cast(3) > attack(2) > idle(0) */
  priority: number;
  anchors: Partial<Record<AnchorName, AnchorKey[]>>;
  events: AnimEvent[];
  tracks: Track[];
}

export type MotionGroup =
  | 'dao'
  | 'jian'
  | 'quan'
  | 'anqi'
  | 'qimen'
  | 'qiang'
  | 'neigong'
  | 'shenfa';

export const MOTION_GROUPS: readonly MotionGroup[] = [
  'dao',
  'jian',
  'quan',
  'anqi',
  'qimen',
  'qiang',
  'neigong',
  'shenfa',
] as const;

/** 动作原型（56 个 clip = 6 组 × 8 + 内功 4 + 身法 4） */
export type MotionArchetype =
  // 武器组通用 8 个
  | 'idle'
  | 'ready'
  | 'atk_a'
  | 'atk_b'
  | 'sweep'
  | 'cast'
  | 'hit'
  | 'dodge'
  | 'down'
  // 内功组
  | 'meditate'
  | 'aura'
  // 身法组
  | 'dash'
  | 'leap'
  | 'vanish'
  | 'land';

/* ------------------------------------------------------------------ 骨架 */

/** 骨骼定义：关节枢轴 + 该部件的绘制盒（占位渲染用） */
export interface BoneDef {
  slot: SlotName;
  parent: SlotName | null;
  /** 关节相对父关节的静止偏移（px） */
  offset: Vec2;
  /** 部件绘制盒（宽 × 高），枢轴 = 盒中心 + pivot */
  w: number;
  h: number;
  /** 绘制枢轴在盒内的归一化位置（0~1，默认 0.5,0.5） */
  pivot?: Vec2;
  /** 占位色（美术接入前用色块验证） */
  color: string;
  /** 是否画墨迹描边（剪纸/皮影风） */
  ink?: boolean;
}

/** 体型定义：同一套 slot，不同骨长与整体缩放 */
export interface RigDef {
  id: string;
  /** 角色总高（px），用于战斗缩放参考 */
  height: number;
  /** 整体缩放 */
  scale: number;
  bones: BoneDef[];
}

/* ------------------------------------------------------------------ 求解结果 */

/** 求解后的世界变换（供渲染层使用） */
export interface WorldBone extends BoneDef {
  wx: number;
  wy: number;
  wrot: number;
  wsx: number;
  wsy: number;
}

/** 求解后的挂点世界坐标 */
export interface WorldAnchor {
  x: number;
  y: number;
  angle: number;
}

export interface SolvedPose {
  timeMs: number;
  bones: WorldBone[];
  anchors: Partial<Record<AnchorName, WorldAnchor>>;
  /** 本次采样命中的事件（t 落在 [prevTime, timeMs) 区间内） */
  firedEvents: AnimEvent[];
}
