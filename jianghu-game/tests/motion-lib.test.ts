/**
 * 动作库覆盖率测试（node --test，零依赖运行）
 *   node --test tests/motion-lib.test.ts
 *
 * 这组测试是「动作库」的守门员，防的是这三类事故：
 *   ① 某个功法配的动作文件不存在 → 战斗时该功法没有动作可播
 *   ② 生成的动作用了未注册 slot / 循环动作首尾不一致 → 运行时跳帧或崩溃
 *   ③ 攻击动作的打击点根本没动 → 挥了个空刀，特效却不知道该从哪出发
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateClip } from '../src/core/anim/validate.ts';
import { sampleClip } from '../src/core/anim/clip.ts';
import { getRig } from '../src/data/rigs.ts';
import { loadJsonDir } from '../tools/load-json.ts';
import { GONGFA_VISUAL } from '../src/data/gongfa_visual.ts';
import type { MotionArchetype, MotionClip, MotionGroup } from '../src/core/anim/types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOTION_DIR = join(HERE, '..', 'src', 'data', 'motions');

/** 加载全部动作文件：文件名 → clip 对象 */
const CLIPS = loadJsonDir<MotionClip>(MOTION_DIR);
const RIG = getRig('male_adult');

/** 6 个武器组，每组 9 个原型 */
const WEAPON_GROUPS: MotionGroup[] = ['dao', 'jian', 'quan', 'anqi', 'qimen', 'qiang'];
const WEAPON_ARCHETYPES: MotionArchetype[] = [
  'idle', 'ready', 'atk_a', 'atk_b', 'sweep', 'cast', 'hit', 'dodge', 'down',
];
/** 内功组 4 个 */
const NEIGONG_ARCHETYPES: MotionArchetype[] = ['idle', 'meditate', 'cast', 'aura'];
/** 身法组 4 个 */
const SHENFA_ARCHETYPES: MotionArchetype[] = ['dash', 'leap', 'vanish', 'land'];
/** 攻击类原型：必须有打击挂点 */
const ATTACK_ARCHETYPES: MotionArchetype[] = ['atk_a', 'atk_b', 'sweep', 'cast'];

/** 全部期望的动作 id */
function expectedIds(): string[] {
  const out: string[] = [];
  for (const g of WEAPON_GROUPS) for (const a of WEAPON_ARCHETYPES) out.push(`${g}_${a}`);
  for (const a of NEIGONG_ARCHETYPES) out.push(`neigong_${a}`);
  for (const a of SHENFA_ARCHETYPES) out.push(`shenfa_${a}`);
  return out;
}

/* ------------------------------------------------------------ 完整性 */

test('动作库：62 个动作齐全（6 武器组 × 9 + 内功 4 + 身法 4）', () => {
  const want = expectedIds();
  assert.equal(want.length, 62, '期望的 id 数量应为 62');
  const missing = want.filter((id) => !CLIPS[id]);
  assert.deepEqual(missing, [], `缺失动作文件：${missing.join(', ')}`);
});

test('动作库：文件名与 clip.id 一致，且符合「组_原型」命名规范', () => {
  for (const [file, clip] of Object.entries(CLIPS)) {
    assert.equal(clip.id, file, `${file}.json 里的 id 应等于文件名`);
    assert.ok(
      file.startsWith(`${clip.group}_`),
      `${file} 的 id 前缀应是它的动作组「${clip.group}」`,
    );
  }
});

test('动作库：全部动作通过校验器（无 error）', () => {
  for (const [file, clip] of Object.entries(CLIPS)) {
    const errs = validateClip(clip).filter((i) => i.level === 'error');
    assert.deepEqual(
      errs.map((e) => e.code),
      [],
      `${file} 校验失败：\n${errs.map((e) => `  [${e.code}] ${e.message}`).join('\n')}`,
    );
  }
});

/* ------------------------------------------------------------ 最关键的断言 */

test('★ 87 门功法全覆盖：每门功法所需的动作都存在（否则该功法无动作可播）', () => {
  const missing: string[] = [];
  for (const v of GONGFA_VISUAL) {
    const id = `${v.group}_${v.motion}`;
    if (!CLIPS[id]) missing.push(`${v.name}（${v.id}，${v.group}）需要动作 ${id}`);
  }
  assert.deepEqual(missing, [], `以下功法没有可播的动作：\n${missing.join('\n')}`);
});

test('★ 攻击类动作的打击点必须真的在动（不能挥空刀）', () => {
  let checked = 0;
  for (const [id, clip] of Object.entries(CLIPS)) {
    const arche = id.slice(clip.group.length + 1) as MotionArchetype;
    if (!ATTACK_ARCHETYPES.includes(arche)) continue;
    checked++;

    // ① 必须有打击挂点，否则特效不知道从哪出发
    const key = clip.anchors.weaponTip
      ? 'weaponTip'
      : clip.anchors.palm
        ? 'palm'
        : clip.anchors.throwPoint
          ? 'throwPoint'
          : null;
    assert.ok(key, `${id} 是攻击类动作，但缺少 weaponTip / palm / throwPoint 挂点`);

    // ② 打击点必须真的移动了足够距离
    const pts = [0, 0.25, 0.5, 0.75, 1]
      .map((u) => sampleClip(clip, RIG, clip.duration * u).anchors[key!])
      .filter(Boolean) as { x: number; y: number }[];
    let travel = 0;
    for (let i = 1; i < pts.length; i++) {
      travel += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    }
    assert.ok(
      travel > 40,
      `${id} 的打击点几乎没动（仅 ${travel.toFixed(1)}px），等于挥空刀`,
    );
  }
  // 应有 25 个攻击类动作：6 武器组 × 4 种攻击原型（atk_a/atk_b/sweep/cast）= 24，
  // 加上内功组的 neigong_cast = 25。身法组没有攻击类动作。
  assert.equal(checked, 25, `攻击类动作数量应为 25，实际 ${checked}`);
});

test('★ 循环动作（idle / meditate / aura）首尾姿态一致，不会跳帧', () => {
  const loops = Object.entries(CLIPS).filter(([, c]) => c.loop);
  assert.ok(loops.length >= 8, `循环动作数量偏少（${loops.length}）`);

  for (const [id, clip] of loops) {
    for (const track of clip.tracks) {
      const a = track.keys[0]!;
      const b = track.keys[track.keys.length - 1]!;
      const diff =
        Math.abs((a.dx ?? 0) - (b.dx ?? 0)) +
        Math.abs((a.dy ?? 0) - (b.dy ?? 0)) +
        Math.abs((a.rot ?? 0) - (b.rot ?? 0)) +
        Math.abs((a.sx ?? 1) - (b.sx ?? 1)) +
        Math.abs((a.sy ?? 1) - (b.sy ?? 1));
      assert.ok(diff < 1e-6, `${id} 的 ${track.slot} 首尾不一致（差 ${diff.toFixed(6)}）`);
    }
  }
});

/* ------------------------------------------------------------ 参数合理性 */

test('每段动作时长都在校验器允许区间 [200, 2000] ms', () => {
  for (const [id, clip] of Object.entries(CLIPS)) {
    assert.ok(
      clip.duration >= 200 && clip.duration <= 2000,
      `${id} 时长 ${clip.duration}ms 越界`,
    );
  }
});

test('打断优先级符合规范：倒地 9 > 受击 5 > 功法 3 > 普攻 2 > 待机 0', () => {
  for (const [id, clip] of Object.entries(CLIPS)) {
    assert.ok(clip.priority >= 0 && clip.priority <= 9, `${id} 优先级 ${clip.priority} 越界`);
  }
  // 倒地必须是最高优先级之一，否则会被普通攻击打断
  for (const id of Object.keys(CLIPS).filter((k) => k.endsWith('_down'))) {
    assert.equal(CLIPS[id]!.priority, 9, `${id} 的优先级应为 9（倒地不可被普通动作打断）`);
  }
  // 待机必须是最低优先级
  for (const id of Object.keys(CLIPS).filter((k) => k.endsWith('_idle') || k.endsWith('_meditate') || k.endsWith('_aura'))) {
    assert.equal(CLIPS[id]!.priority, 0, `${id} 的优先级应为 0（待机/持续状态不可抢打断）`);
  }
});

test('每个动作都有关键帧，且同一 slot 不重复', () => {
  for (const [id, clip] of Object.entries(CLIPS)) {
    assert.ok(clip.tracks.length > 0, `${id} 没有任何轨道`);
    const seen = new Set<string>();
    for (const t of clip.tracks) {
      assert.ok(!seen.has(t.slot), `${id} 的 slot ${t.slot} 出现了重复轨道`);
      seen.add(t.slot);
      assert.ok(t.keys.length >= 2, `${id} 的 ${t.slot} 关键帧少于 2 个`);
    }
  }
});
