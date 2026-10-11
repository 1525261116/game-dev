/**
 * 骨架定义（3 套体型预设）。
 *
 * ⚠️ 铁律：所有人类角色共用**同一套 slot 拓扑**；体型差异只用骨长与缩放表达。
 *         新增角色只能新增贴图，**不允许新增 slot**。
 *
 * 坐标系：屏幕坐标（+x 右、+y 下），pelvis 为原点（y=0），脚底在 +y 方向。
 */
import type { BoneDef, RigDef, SlotName } from '../core/anim/types.ts';

/** 关节静止偏移与部件绘制盒（以 154px 高的成年男性为基准） */
interface BoneSpec {
  slot: SlotName;
  parent: SlotName | null;
  offset: [number, number];
  w: number;
  h: number;
  /** 绘制枢轴（归一化，默认 [0.5, 0.5]） */
  pivot?: [number, number];
  color: string;
}

/** 基准骨架（成人男） */
const BASE: BoneSpec[] = [
  { slot: 'pelvis', parent: null, offset: [0, 0], w: 34, h: 16, color: '#4a4a52' },

  { slot: 'torso', parent: 'pelvis', offset: [0, -6], w: 40, h: 46, pivot: [0.5, 1], color: '#8c3b34' },
  { slot: 'head', parent: 'torso', offset: [0, -46], w: 24, h: 26, pivot: [0.5, 1], color: '#e8d9c5' },

  { slot: 'upperArmR', parent: 'torso', offset: [15, -40], w: 12, h: 26, pivot: [0.5, 0], color: '#8c3b34' },
  { slot: 'forearmR', parent: 'upperArmR', offset: [0, 26], w: 11, h: 24, pivot: [0.5, 0], color: '#8c3b34' },
  { slot: 'handR', parent: 'forearmR', offset: [0, 24], w: 10, h: 10, pivot: [0.5, 0], color: '#e8d9c5' },
  { slot: 'weapon', parent: 'handR', offset: [0, 8], w: 7, h: 56, pivot: [0.5, 0.12], color: '#c9cdd4' },

  { slot: 'upperArmL', parent: 'torso', offset: [-15, -40], w: 12, h: 26, pivot: [0.5, 0], color: '#7b332d' },
  { slot: 'forearmL', parent: 'upperArmL', offset: [0, 26], w: 11, h: 24, pivot: [0.5, 0], color: '#7b332d' },
  { slot: 'handL', parent: 'forearmL', offset: [0, 24], w: 10, h: 10, pivot: [0.5, 0], color: '#e8d9c5' },

  { slot: 'thighR', parent: 'pelvis', offset: [8, 0], w: 14, h: 32, pivot: [0.5, 0], color: '#3a3f4a' },
  { slot: 'shinR', parent: 'thighR', offset: [0, 32], w: 12, h: 30, pivot: [0.5, 0], color: '#3a3f4a' },
  { slot: 'footR', parent: 'shinR', offset: [0, 30], w: 18, h: 8, pivot: [0.25, 0.5], color: '#2b2f36' },

  { slot: 'thighL', parent: 'pelvis', offset: [-8, 0], w: 14, h: 32, pivot: [0.5, 0], color: '#32363f' },
  { slot: 'shinL', parent: 'thighL', offset: [0, 32], w: 12, h: 30, pivot: [0.5, 0], color: '#32363f' },
  { slot: 'footL', parent: 'shinL', offset: [0, 30], w: 18, h: 8, pivot: [0.25, 0.5], color: '#23262c' },

  { slot: 'cloak', parent: 'torso', offset: [0, -38], w: 46, h: 58, pivot: [0.5, 0.05], color: '#2f4f4a' },
];

/**
 * 体型预设参数。
 *  - scale        整体缩放
 *  - shoulder/hip 肩宽与胯宽系数
 *  - limb         四肢长度系数
 *  - torsoScale   躯干尺寸系数
 */
interface BodyParams {
  id: string;
  scale: number;
  shoulder: number;
  hip: number;
  limb: number;
  torsoScale: number;
  palette?: Partial<Record<SlotName, string>>;
}

const BODIES: BodyParams[] = [
  { id: 'male_adult', scale: 1.0, shoulder: 1.0, hip: 1.0, limb: 1.0, torsoScale: 1.0 },
  {
    id: 'female_adult',
    scale: 0.94,
    shoulder: 0.86,
    hip: 1.06,
    limb: 0.98,
    torsoScale: 0.96,
    palette: { torso: '#8f4a63', upperArmR: '#8f4a63', forearmR: '#8f4a63', upperArmL: '#7d4056', forearmL: '#7d4056' },
  },
  {
    id: 'burly',
    scale: 1.12,
    shoulder: 1.28,
    hip: 1.12,
    limb: 1.02,
    torsoScale: 1.12,
    palette: { torso: '#5d4a33', upperArmR: '#5d4a33', forearmR: '#5d4a33', upperArmL: '#4f3f2c', forearmL: '#4f3f2c' },
  },
];

const ARM_SLOTS: ReadonlySet<SlotName> = new Set(['upperArmR', 'forearmR', 'handR', 'upperArmL', 'forearmL', 'handL']);
const LEG_SLOTS: ReadonlySet<SlotName> = new Set(['thighR', 'shinR', 'footR', 'thighL', 'shinL', 'footL']);
const ARM_LEN_SLOTS: ReadonlySet<SlotName> = new Set(['upperArmR', 'forearmR', 'handR', 'upperArmL', 'forearmL', 'handL']);
const LEG_LEN_SLOTS: ReadonlySet<SlotName> = new Set(['thighR', 'shinR', 'thighL', 'shinL']);

function buildRig(p: BodyParams): RigDef {
  const bones: BoneDef[] = BASE.map((b) => {
    let { offset, w, h } = { offset: b.offset, w: b.w, h: b.h };
    let ox = offset[0];
    let oy = offset[1];

    // 肩/胯宽度
    if (ARM_SLOTS.has(b.slot)) ox *= p.shoulder;
    if (LEG_SLOTS.has(b.slot)) ox *= p.hip;
    // 四肢长度
    if (ARM_LEN_SLOTS.has(b.slot)) oy *= p.limb;
    if (LEG_LEN_SLOTS.has(b.slot)) oy *= p.limb;
    // 躯干尺寸
    if (b.slot === 'torso' || b.slot === 'pelvis' || b.slot === 'cloak') {
      w *= p.torsoScale;
      h *= p.torsoScale;
    }
    if (b.slot === 'head') h *= 0.98;

    return {
      slot: b.slot,
      parent: b.parent,
      offset: { x: ox, y: oy },
      w,
      h,
      pivot: { x: b.pivot?.[0] ?? 0.5, y: b.pivot?.[1] ?? 0.5 },
      color: p.palette?.[b.slot] ?? b.color,
      ink: true,
    };
  });

  // 计算总高（脚底到头顶），供战斗缩放参考
  let footY = 0;
  let headTopY = 0;
  const bySlot = new Map(bones.map((b) => [b.slot, b] as const));
  const worldY = (slot: SlotName): number => {
    const b = bySlot.get(slot)!;
    return (b.parent ? worldY(b.parent) : 0) + b.offset.y;
  };
  footY = Math.max(worldY('footR'), worldY('footL')) + 8;
  headTopY = worldY('head') - 26;
  const height = (footY - headTopY) * p.scale;

  return { id: p.id, height: Math.round(height), scale: p.scale, bones };
}

export const RIGS: Record<string, RigDef> = Object.fromEntries(
  BODIES.map((b) => [b.id, buildRig(b)]),
);

export const DEFAULT_RIG_ID = 'male_adult';

export function getRig(id: string): RigDef {
  const r = RIGS[id];
  if (!r) throw new Error(`未知体型: ${id}（可用：${Object.keys(RIGS).join(' / ')}）`);
  return r;
}

export const BODY_TYPE_IDS = BODIES.map((b) => b.id);
