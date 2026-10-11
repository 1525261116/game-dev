/**
 * 动作采样：把 MotionClip 在任意时刻求值为完整位姿。
 *
 * 关键帧时间有两种写法（本文件统一处理）：
 *  - `t` ∈ [0,1] → 归一化时间（推荐，便于整体缩放时长）
 *  - `t` > 1      → 视为毫秒
 */
import { ease } from './ease.ts';
import { eventsBetween, localToWorld, sampleAnchor, solveWorld, lerp } from './skeleton.ts';
import type { PoseMap } from './skeleton.ts';
import type {
  Keyframe,
  MotionClip,
  PoseLocal,
  RigDef,
  SolvedPose,
  SlotName,
  Track,
  Vec2,
} from './types.ts';

/** 关键帧时间归一化 */
export function keyTime(k: Keyframe, durationMs: number): number {
  return k.t > 1 ? k.t / durationMs : k.t;
}

const DEFAULT_KEY: Required<Pick<Keyframe, 'dx' | 'dy' | 'rot' | 'sx' | 'sy' | 'ease'>> = {
  dx: 0,
  dy: 0,
  rot: 0,
  sx: 1,
  sy: 1,
  ease: 'sineOut',
};

const poseOf = (k: Keyframe): PoseLocal => ({
  dx: k.dx ?? 0,
  dy: k.dy ?? 0,
  rot: k.rot ?? 0,
  sx: k.sx ?? 1,
  sy: k.sy ?? 1,
});

/**
 * 在一条轨道上采样出局部位姿。
 * 约定：`track.keys` 必须已由 normalizeClip 归一化并按 t 升序。
 */
export function sampleTrack(track: Track, u: number): PoseLocal {
  const keys = track.keys;
  if (keys.length === 0) return { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 };

  const first = keys[0]!;
  if (u <= first.t) return poseOf(first);

  const last = keys[keys.length - 1]!;
  if (u >= last.t) return poseOf(last);

  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (u >= a.t && u <= b.t) {
      const span = b.t - a.t;
      const raw = span <= 0 ? 0 : (u - a.t) / span;
      const w = ease(b.ease ?? DEFAULT_KEY.ease, raw);
      const pa = poseOf(a);
      const pb = poseOf(b);
      return {
        dx: lerp(pa.dx, pb.dx, w),
        dy: lerp(pa.dy, pb.dy, w),
        rot: lerp(pa.rot, pb.rot, w),
        sx: lerp(pa.sx, pb.sx, w),
        sy: lerp(pa.sy, pb.sy, w),
      };
    }
  }
  return poseOf(last);
}

/** 把 clip 的毫秒关键帧统一成归一化时间 */
export function normalizeClip(clip: MotionClip): MotionClip {
  const fix = (keys: Keyframe[]) =>
    keys
      .map((k) => ({ ...k, t: keyTime(k, clip.duration) }))
      .sort((a, b) => a.t - b.t);
  return {
    ...clip,
    anchors: Object.fromEntries(
      Object.entries(clip.anchors).map(([name, keys]) => [
        name,
        keys.map((k) => ({ ...k, t: keyTime(k as Keyframe, clip.duration) })),
      ]),
    ) as MotionClip['anchors'],
    tracks: clip.tracks.map((t) => ({ ...t, keys: fix(t.keys) })),
  };
}

/**
 * 采样一帧。
 * @param timeMs 当前播放时间（毫秒）；loop=true 时自动取模
 * @param prevMs 上一帧时间，用于筛出本帧应触发的事件
 */
export function sampleClip(
  clipRaw: MotionClip,
  rig: RigDef,
  timeMs: number,
  prevMs = -1,
): SolvedPose {
  const clip = normalizeClip(clipRaw);
  const duration = clip.duration;
  let t = timeMs;
  if (clip.loop && duration > 0) {
    t = ((timeMs % duration) + duration) % duration;
  } else if (t < 0) {
    t = 0;
  } else if (t > duration) {
    t = duration;
  }
  const u = duration <= 0 ? 0 : t / duration;

  const pose: PoseMap = {};
  for (const track of clip.tracks) {
    pose[track.slot as SlotName] = sampleTrack(track, u);
  }

  const bones = solveWorld(rig, pose);

  const anchors: SolvedPose['anchors'] = {};
  for (const [name, keys] of Object.entries(clip.anchors)) {
    if (!keys || keys.length === 0) continue;
    const s = sampleAnchor(keys, u);
    anchors[name as keyof SolvedPose['anchors']] = localToWorld(
      bones,
      s.slot,
      s.local as Vec2,
      s.angle,
    );
  }

  return {
    timeMs: t,
    bones,
    anchors,
    firedEvents: prevMs < 0 ? [] : eventsBetween(clip.events, prevMs, t, duration),
  };
}
