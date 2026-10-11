/**
 * 骨架求解：把「局部位姿」换算为「世界变换」。
 *
 * 坐标系：屏幕坐标，+x 右、+y 下。
 * 世界变换规则（与所有 2D 骨骼系统一致）：
 *   child.w = parent.w ∘ (poseOffset + bone.offset，先按父旋转/缩放)
 *   child.wrot = parent.wrot + childLocalRot
 *   child.wsx  = parent.wsx * childLocalScale
 */
import type {
  BoneDef,
  PoseLocal,
  RigDef,
  SlotName,
  SolvedPose,
  Vec2,
  WorldAnchor,
  WorldBone,
  AnchorName,
  AnchorKey,
  MotionClip,
  AnimEvent,
} from './types.ts';
import { IDENTITY_POSE } from './types.ts';

export type PoseMap = Partial<Record<SlotName, PoseLocal>>;

/** 把一维关键帧值在 [t0,t1] 之间插值 */
export function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

/** 求解整副骨架的世界变换 */
export function solveWorld(rig: RigDef, pose: PoseMap): WorldBone[] {
  const bySlot = new Map<SlotName, BoneDef>();
  for (const b of rig.bones) bySlot.set(b.slot, b);

  const solved = new Map<SlotName, WorldBone>();

  const resolve = (bone: BoneDef): WorldBone => {
    const cached = solved.get(bone.slot);
    if (cached) return cached;

    const local: PoseLocal = pose[bone.slot] ?? IDENTITY_POSE;

    // 关节自身的局部偏移在父坐标系中，先加上静止偏移，再乘父缩放/旋转
    let px = 0;
    let py = 0;
    let prot = 0;
    let psx = 1;
    let psy = 1;

    if (bone.parent) {
      const parentDef = bySlot.get(bone.parent);
      if (!parentDef) throw new Error(`骨骼 ${bone.slot} 的父级 ${bone.parent} 不存在`);
      const pw = resolve(parentDef);
      px = pw.wx;
      py = pw.wy;
      prot = pw.wrot;
      psx = pw.wsx;
      psy = pw.wsy;
    }

    const lx = (bone.offset.x + local.dx) * psx;
    const ly = (bone.offset.y + local.dy) * psy;
    const cos = Math.cos(prot);
    const sin = Math.sin(prot);
    const wx = px + lx * cos - ly * sin;
    const wy = py + lx * sin + ly * cos;

    const world: WorldBone = {
      ...bone,
      wx,
      wy,
      wrot: prot + local.rot,
      wsx: psx * local.sx,
      wsy: psy * local.sy,
    };
    solved.set(bone.slot, world);
    return world;
  };

  for (const b of rig.bones) resolve(b);
  return rig.bones.map((b) => solved.get(b.slot)!);
}

/** 把局部坐标（相对某 slot 的关节）换算到世界坐标 */
export function localToWorld(
  bones: WorldBone[],
  slot: SlotName,
  local: Vec2,
  angle = 0,
): WorldAnchor {
  const b = bones.find((x) => x.slot === slot);
  if (!b) throw new Error(`挂点引用了不存在的 slot: ${slot}`);
  const lx = local.x * b.wsx;
  const ly = local.y * b.wsy;
  const cos = Math.cos(b.wrot);
  const sin = Math.sin(b.wrot);
  return {
    x: b.wx + lx * cos - ly * sin,
    y: b.wy + lx * sin + ly * cos,
    angle: b.wrot + angle,
  };
}

/** 在挂点关键帧序列上按时间插值 */
export function sampleAnchor(keys: AnchorKey[], u: number): { local: Vec2; slot: SlotName; angle: number } {
  if (keys.length === 0) throw new Error('挂点关键帧为空');
  const sorted = keys;
  if (u <= sorted[0]!.t) {
    const k = sorted[0]!;
    return { local: { x: k.x, y: k.y }, slot: k.slot ?? 'pelvis', angle: k.angle ?? 0 };
  }
  const last = sorted[sorted.length - 1]!;
  if (u >= last.t) {
    return { local: { x: last.x, y: last.y }, slot: last.slot ?? 'pelvis', angle: last.angle ?? 0 };
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (u >= a.t && u <= b.t) {
      const span = b.t - a.t;
      const w = span <= 0 ? 0 : (u - a.t) / span;
      return {
        local: { x: lerp(a.x, b.x, w), y: lerp(a.y, b.y, w) },
        slot: b.slot ?? a.slot ?? 'pelvis',
        angle: lerp(a.angle ?? 0, b.angle ?? 0, w),
      };
    }
  }
  return { local: { x: last.x, y: last.y }, slot: last.slot ?? 'pelvis', angle: last.angle ?? 0 };
}

/**
 * 事件是否落在 (prev, now] 区间（用于回放时触发一次）。
 *
 * ⚠️ 事件时间 `t` 与关键帧同规则：`t <= 1` 视为归一化时间，`t > 1` 视为毫秒。
 *    因此必须传入 duration 才能换算成毫秒比较。
 */
export function eventsBetween(
  events: AnimEvent[],
  prevMs: number,
  nowMs: number,
  durationMs: number,
): AnimEvent[] {
  return events.filter((e) => {
    const at = e.t > 1 ? e.t : e.t * durationMs;
    return at > prevMs && at <= nowMs;
  });
}

export type { MotionClip, SolvedPose, AnchorName };
