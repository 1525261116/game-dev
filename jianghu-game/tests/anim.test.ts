/**
 * 动画内核测试（node --test，零依赖运行）
 *   node --test tests/anim.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ease } from '../src/core/anim/ease.ts';
import { solveWorld, localToWorld, eventsBetween, sampleAnchor } from '../src/core/anim/skeleton.ts';
import { sampleClip, normalizeClip, sampleTrack } from '../src/core/anim/clip.ts';
import { validateClip } from '../src/core/anim/validate.ts';
import { getRig, RIGS, BODY_TYPE_IDS } from '../src/data/rigs.ts';
import { loadJsonDir } from '../tools/load-json.ts';
import { SLOT_NAMES } from '../src/core/anim/types.ts';
import type { MotionClip } from '../src/core/anim/types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOTION_DIR = join(HERE, '..', 'src', 'data', 'motions');

/* ------------------------------------------------------------ 缓动 */

test('缓动：边界值必须精确', () => {
  for (const kind of ['linear', 'sineIn', 'sineOut', 'quadIn', 'backOut'] as const) {
    assert.equal(ease(kind, 0), 0, `${kind}(0)`);
    assert.ok(Math.abs(ease(kind, 1) - 1) < 1e-9, `${kind}(1)`);
  }
});

test('缓动：越界输入被钳制', () => {
  assert.equal(ease('sineOut', -5), 0);
  assert.equal(ease('sineOut', 5), 1);
});

/* ------------------------------------------------------------ 骨架求解 */

test('骨架：每套体型都包含全部必需 slot，且父级引用有效', () => {
  for (const id of BODY_TYPE_IDS) {
    const rig = getRig(id);
    const slots = new Set(rig.bones.map((b) => b.slot));
    for (const s of SLOT_NAMES) {
      // cloak 为可选部件，其余必须存在
      if (s === 'cloak') continue;
      assert.ok(slots.has(s), `${id} 缺少 slot ${s}`);
    }
    for (const b of rig.bones) {
      if (b.parent) assert.ok(slots.has(b.parent), `${id}: ${b.slot} 的父级 ${b.parent} 不存在`);
    }
  }
});

test('骨架：无变换时脚底在原点下方、头顶在原点上方（比例合理）', () => {
  for (const id of BODY_TYPE_IDS) {
    const rig = getRig(id);
    const bones = solveWorld(rig, {});
    const foot = bones.find((b) => b.slot === 'footR')!;
    const head = bones.find((b) => b.slot === 'head')!;
    // 枢轴 y=1 表示关节在盒底，盒体向上延伸 → 顶部 = wy - h*pivotY
    const headTop = head.wy - head.h * (head.pivot?.y ?? 0.5);
    assert.ok(foot.wy > 50 * rig.scale, `${id} 脚底 y=${foot.wy} 偏低`);
    assert.ok(headTop < -60 * rig.scale, `${id} 头顶 y=${headTop} 偏高`);
    assert.ok(rig.height >= 130 && rig.height <= 180, `${id} 身高 ${rig.height} 不在 130~180`);
  }
});

test('骨架：父级旋转会带动子级（层级传播正确）', () => {
  const rig = getRig('male_adult');
  const rest = solveWorld(rig, {});
  const rotated = solveWorld(rig, { torso: { dx: 0, dy: 0, rot: Math.PI / 2, sx: 1, sy: 1 } });
  const handRest = rest.find((b) => b.slot === 'handR')!;
  const handRot = rotated.find((b) => b.slot === 'handR')!;
  assert.notEqual(Math.round(handRest.wx), Math.round(handRot.wx));
  // 子级世界旋转 = 父级旋转 + 自身局部旋转
  assert.ok(Math.abs(handRot.wrot - Math.PI / 2) < 1e-9);
});

test('骨架：局部→世界换算与直接求解一致', () => {
  const rig = getRig('male_adult');
  const bones = solveWorld(rig, {});
  const p = localToWorld(bones, 'head', { x: 0, y: -13 });
  const head = bones.find((b) => b.slot === 'head')!;
  assert.ok(Math.abs(p.x - head.wx) < 1e-9);
  assert.ok(Math.abs(p.y - (head.wy - 13)) < 1e-9);
});

test('骨架：引用不存在的 slot 必须抛错（不静默失败）', () => {
  const rig = getRig('male_adult');
  const bones = solveWorld(rig, {});
  assert.throws(() => localToWorld(bones, 'notASlot' as never, { x: 0, y: 0 }), /不存在/);
});

/* ------------------------------------------------------------ 采样 */

const CLIPS = loadJsonDir<MotionClip>(MOTION_DIR);
const CLIP_LIST = Object.values(CLIPS);

test('动作库：存在且至少包含 3 个 dao 组动作', () => {
  assert.ok(CLIP_LIST.length >= 3, `实际 ${CLIP_LIST.length} 个动作`);
  assert.ok(CLIP_LIST.some((c) => c.id === 'dao_idle'));
  assert.ok(CLIP_LIST.some((c) => c.id === 'dao_atk_a'));
});

test('动作库：全部 clip 通过校验（无 error 级问题）', () => {
  const problems: string[] = [];
  for (const clip of CLIP_LIST) {
    for (const issue of validateClip(clip)) {
      if (issue.level === 'error') problems.push(`${clip.id}: [${issue.code}] ${issue.message}`);
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('动作库：id 全局唯一', () => {
  const ids = CLIP_LIST.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('采样：确定性——同一时刻采样两次结果完全一致', () => {
  const rig = getRig('male_adult');
  const clip = CLIPS['dao_atk_a']!;
  const a = sampleClip(clip, rig, 260);
  const b = sampleClip(clip, rig, 260);
  assert.deepEqual(a.bones, b.bones);
});

test('采样：循环动作首尾姿态一致，且时间取模', () => {
  const rig = getRig('male_adult');
  const clip = CLIPS['dao_idle']!;
  const first = sampleClip(clip, rig, 0);
  const looped = sampleClip(clip, rig, clip.duration);
  for (let i = 0; i < first.bones.length; i++) {
    assert.ok(Math.abs(first.bones[i]!.wrot - looped.bones[i]!.wrot) < 1e-9, `slot ${first.bones[i]!.slot} 旋转不一致`);
  }
  const wrapped = sampleClip(clip, rig, clip.duration + 400);
  const same = sampleClip(clip, rig, 400);
  assert.ok(Math.abs(wrapped.bones[1]!.wrot - same.bones[1]!.wrot) < 1e-9, '取模后姿态应一致');
});

test('采样：非循环动作被钳制在 [0, duration]', () => {
  const rig = getRig('male_adult');
  const clip = CLIPS['dao_atk_a']!;
  const over = sampleClip(clip, rig, clip.duration + 5000);
  const end = sampleClip(clip, rig, clip.duration);
  assert.deepEqual(over.bones, end.bones);
});

test('采样：攻击动作的武器尖端确实发生了位移（动作真的在动）', () => {
  const rig = getRig('male_adult');
  const clip = CLIPS['dao_atk_a']!;
  const wind = sampleClip(clip, rig, clip.duration * 0.3).anchors.weaponTip!;
  const hit = sampleClip(clip, rig, clip.duration * 0.5).anchors.weaponTip!;
  const dist = Math.hypot(hit.x - wind.x, hit.y - wind.y);
  assert.ok(dist > 80, `武器尖端位移仅 ${dist.toFixed(1)}px，动作幅度过小`);
});

test('采样：事件只在跨过时点的那一帧触发一次', () => {
  const rig = getRig('male_adult');
  const clip = CLIPS['dao_atk_a']!;
  const hitAt = clip.events.find((e) => e.type === 'hit')!.t * clip.duration;
  const before = sampleClip(clip, rig, hitAt - 20, hitAt - 40);
  const on = sampleClip(clip, rig, hitAt + 2, hitAt - 20);
  const after = sampleClip(clip, rig, hitAt + 40, hitAt + 2);
  assert.equal(before.firedEvents.length, 0, '命中前不应触发');
  assert.ok(on.firedEvents.some((e) => e.type === 'hit'), '跨过命中点应触发');
  assert.equal(after.firedEvents.filter((e) => e.type === 'hit').length, 0, '不应重复触发');
});

test('eventsBetween：左开右闭区间，且归一化时间按 duration 换算', () => {
  const evs = [{ t: 0.5, type: 'hit' as const }];
  assert.equal(eventsBetween(evs, 500, 500, 1000).length, 0, '等于起点不触发');
  assert.equal(eventsBetween(evs, 499, 500, 1000).length, 1, '跨过终点触发');
  // 毫秒写法（t > 1）同样正确
  const evsMs = [{ t: 450, type: 'hit' as const }];
  assert.equal(eventsBetween(evsMs, 450, 450, 1000).length, 0);
  assert.equal(eventsBetween(evsMs, 449, 450, 1000).length, 1);
});

test('轨道采样：超出关键帧范围时钳制到端点值', () => {
  const track = {
    slot: 'torso' as const,
    keys: [
      { t: 0.2, rot: 0 },
      { t: 0.8, rot: 1, ease: 'linear' as const },
    ],
  };
  assert.equal(sampleTrack(track, 0).rot, 0);
  assert.equal(sampleTrack(track, 1).rot, 1);
  assert.ok(Math.abs(sampleTrack(track, 0.5).rot - 0.5) < 1e-6);
});

test('normalizeClip：毫秒关键帧被归一化并排序', () => {
  const clip: MotionClip = {
    id: 'tmp_test',
    group: 'dao',
    duration: 1000,
    loop: false,
    priority: 2,
    anchors: { weaponTip: [{ t: 500, slot: 'weapon', x: 0, y: 10 }] },
    events: [],
    tracks: [
      { slot: 'torso', keys: [{ t: 800, rot: 1 }, { t: 200, rot: 0 }] },
    ],
  };
  const n = normalizeClip(clip);
  assert.equal(n.tracks[0]!.keys[0]!.t, 0.2);
  assert.equal(n.tracks[0]!.keys[1]!.t, 0.8);
  assert.equal(n.anchors.weaponTip![0]!.t, 0.5);
});

test('挂点采样：在关键帧之间线性插值', () => {
  const keys = [
    { t: 0, slot: 'pelvis' as const, x: 0, y: 0 },
    { t: 1, slot: 'pelvis' as const, x: 100, y: 50 },
  ];
  const mid = sampleAnchor(keys, 0.5);
  assert.equal(mid.local.x, 50);
  assert.equal(mid.local.y, 25);
});

/* ------------------------------------------------------------ 校验器 */

test('校验器：能抓出重复 slot 轨道', () => {
  const bad: MotionClip = {
    id: 'bad_dup',
    group: 'dao',
    duration: 500,
    loop: false,
    priority: 2,
    anchors: { weaponTip: [{ t: 0, slot: 'weapon', x: 0, y: 10 }] },
    events: [],
    tracks: [
      { slot: 'torso', keys: [{ t: 0, rot: 0 }, { t: 1, rot: 0 }] },
      { slot: 'torso', keys: [{ t: 0, rot: 1 }, { t: 1, rot: 1 }] },
    ],
  };
  const codes = validateClip(bad).map((i) => i.code);
  assert.ok(codes.includes('DUP_SLOT'));
});

test('校验器：能抓出未注册 slot（保护换肤体系）', () => {
  const bad = {
    id: 'bad_slot',
    group: 'dao',
    duration: 500,
    loop: false,
    priority: 2,
    anchors: {},
    events: [],
    tracks: [{ slot: 'tail', keys: [{ t: 0 }, { t: 1 }] }],
  } as unknown as MotionClip;
  const codes = validateClip(bad).map((i) => i.code);
  assert.ok(codes.includes('BAD_SLOT'));
});

test('校验器：循环动作首尾不一致会报错', () => {
  const bad: MotionClip = {
    id: 'bad_loop',
    group: 'dao',
    duration: 500,
    loop: true,
    priority: 0,
    anchors: {},
    events: [],
    tracks: [{ slot: 'torso', keys: [{ t: 0, rot: 0 }, { t: 1, rot: 0.5 }] }],
  };
  const codes = validateClip(bad).map((i) => i.code);
  assert.ok(codes.includes('LOOP_MISMATCH'));
});

test('校验器：攻击类动作缺少打击挂点会报错', () => {
  const bad: MotionClip = {
    id: 'dao_atk_a',
    group: 'dao',
    duration: 500,
    loop: false,
    priority: 2,
    anchors: {},
    events: [],
    tracks: [{ slot: 'torso', keys: [{ t: 0, rot: 0 }, { t: 1, rot: 0 }] }],
  };
  const codes = validateClip(bad).map((i) => i.code);
  assert.ok(codes.includes('NO_STRIKE_ANCHOR'));
});

/* ------------------------------------------------------------ 一致性护栏 */

test('护栏：RIGS 数量与体型 ID 列表一致', () => {
  assert.equal(Object.keys(RIGS).length, BODY_TYPE_IDS.length);
});
