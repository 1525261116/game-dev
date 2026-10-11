/**
 * 动作 clip 校验器（纯逻辑）。
 *
 * 用途：① 时间轴编辑器保存前校验 ② CI/测试全量校验 ③ 新增动作时的自动兜底。
 * 原则：**宁可占位兜底，也不允许运行时崩溃**——但开发期必须报错。
 */
import { MOTION_GROUPS, SLOT_NAMES } from './types.ts';
import type { MotionClip, SlotName } from './types.ts';
import { normalizeClip } from './clip.ts';

export const MOTION_LIMITS = {
  minDuration: 200,
  maxDuration: 2000,
  maxKeysPerTrack: 24,
  minKeysPerTrack: 2,
} as const;

const SLOT_SET: ReadonlySet<string> = new Set(SLOT_NAMES);

export interface ValidationIssue {
  level: 'error' | 'warn';
  code: string;
  message: string;
}

export function validateClip(raw: MotionClip): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (code: string, message: string) =>
    issues.push({ level: 'error', code, message });
  const warn = (code: string, message: string) =>
    issues.push({ level: 'warn', code, message });

  if (!raw.id) err('NO_ID', '缺少 id');
  if (!MOTION_GROUPS.includes(raw.group)) err('BAD_GROUP', `未知动作组: ${raw.group}`);
  if (raw.duration < MOTION_LIMITS.minDuration || raw.duration > MOTION_LIMITS.maxDuration) {
    err('BAD_DURATION', `时长 ${raw.duration}ms 超出 [${MOTION_LIMITS.minDuration}, ${MOTION_LIMITS.maxDuration}]`);
  }
  if (typeof raw.priority !== 'number') err('NO_PRIORITY', '缺少 priority（打断优先级）');
  if (!Array.isArray(raw.tracks) || raw.tracks.length === 0) err('NO_TRACKS', '没有任何轨道');

  // 轨道：slot 合法性 + 不重复
  const seen = new Set<SlotName>();
  for (const track of raw.tracks) {
    if (!SLOT_SET.has(track.slot)) {
      err('BAD_SLOT', `轨道引用了未注册的 slot: ${track.slot}（新增 slot 会破坏换肤体系）`);
      continue;
    }
    if (seen.has(track.slot)) err('DUP_SLOT', `slot ${track.slot} 出现重复轨道（后者会覆盖前者）`);
    seen.add(track.slot);

    if (track.keys.length < MOTION_LIMITS.minKeysPerTrack) {
      warn('FEW_KEYS', `${track.slot} 关键帧过少（${track.keys.length}）`);
    }
    if (track.keys.length > MOTION_LIMITS.maxKeysPerTrack) {
      warn('MANY_KEYS', `${track.slot} 关键帧过多（${track.keys.length}），建议 ≤ ${MOTION_LIMITS.maxKeysPerTrack}`);
    }
    let prev = -Infinity;
    for (const k of track.keys) {
      if (k.t < 0) err('NEG_TIME', `${track.slot} 存在负时间关键帧`);
      if (k.t < prev) err('UNSORTED', `${track.slot} 关键帧未按时间升序`);
      prev = k.t;
    }
  }

  // 挂点
  for (const [name, keys] of Object.entries(raw.anchors)) {
    if (!keys || keys.length === 0) {
      warn('EMPTY_ANCHOR', `挂点 ${name} 为空`);
      continue;
    }
    for (const k of keys) {
      const slot = k.slot ?? 'pelvis';
      if (!SLOT_SET.has(slot)) err('BAD_ANCHOR_SLOT', `挂点 ${name} 引用了不存在的 slot: ${slot}`);
    }
    let prev = -Infinity;
    for (const k of keys) {
      if (k.t < prev) err('ANCHOR_UNSORTED', `挂点 ${name} 关键帧未按时间升序`);
      prev = k.t;
    }
  }

  // 攻击类动作必须有打击挂点，否则特效无处安放
  const ATTACK_ARCHETYPES = ['atk_a', 'atk_b', 'cast', 'sweep'];
  if (ATTACK_ARCHETYPES.some((a) => raw.id.endsWith(a))) {
    const hasStrikeAnchor =
      (raw.anchors.weaponTip?.length ?? 0) > 0 ||
      (raw.anchors.palm?.length ?? 0) > 0 ||
      (raw.anchors.throwPoint?.length ?? 0) > 0;
    if (!hasStrikeAnchor) {
      err('NO_STRIKE_ANCHOR', `${raw.id} 是攻击类动作，但缺少 weaponTip / palm / throwPoint 挂点`);
    }
  }

  // 循环动作：首尾姿态必须一致，否则会跳帧
  if (raw.loop) {
    const norm = normalizeClip(raw);
    for (const track of norm.tracks) {
      const a = track.keys[0]!;
      const b = track.keys[track.keys.length - 1]!;
      const diff =
        Math.abs((a.dx ?? 0) - (b.dx ?? 0)) +
        Math.abs((a.dy ?? 0) - (b.dy ?? 0)) +
        Math.abs((a.rot ?? 0) - (b.rot ?? 0)) +
        Math.abs((a.sx ?? 1) - (b.sx ?? 1)) +
        Math.abs((a.sy ?? 1) - (b.sy ?? 1));
      if (diff > 1e-6) {
        err('LOOP_MISMATCH', `循环动作 ${track.slot} 首尾姿态不一致（差 ${diff.toFixed(4)}），会跳帧`);
      }
    }
    const last = norm.tracks[0]?.keys.at(-1);
    if (last && Math.abs(last.t - 1) > 1e-6) {
      warn('LOOP_TAIL', '循环动作首帧不在 t=0 或末帧不在 t=1');
    }
  }

  // 事件时间
  for (const ev of raw.events ?? []) {
    if (ev.t < 0) err('BAD_EVENT_TIME', `事件 ${ev.type} 时间为负`);
  }

  return issues;
}

export function assertClipValid(raw: MotionClip): void {
  const issues = validateClip(raw).filter((i) => i.level === 'error');
  if (issues.length > 0) {
    const detail = issues.map((i) => `  [${i.code}] ${i.message}`).join('\n');
    throw new Error(`动作 ${raw.id} 校验失败：\n${detail}`);
  }
}

/** 批量校验，返回 文件名 → 问题列表 */
export function validateAll(clips: Record<string, MotionClip>): Record<string, ValidationIssue[]> {
  const out: Record<string, ValidationIssue[]> = {};
  for (const [file, clip] of Object.entries(clips)) {
    const issues = validateClip(clip);
    if (issues.length > 0) out[file] = issues;
  }
  return out;
}
