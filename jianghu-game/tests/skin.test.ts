/**
 * 美术皮肤管线测试（node --test，零依赖运行）
 *   node --test tests/skin.test.ts
 *
 * 口径：docs/rig-spec.md §2/§3/§4（slot 清单、体型、作画规范）
 *
 * 这组测试守住四件事：
 *   ① 期望尺寸/枢轴**由骨架推导**（不是手抄一份表，改骨架不会漏改）
 *   ② 画错的四类典型错误（缺件 / 尺寸错 / 枢轴错 / 未注册 slot）必须报 error
 *   ③ **真实资源**全部合规 —— assets/ 下的每个 skin.json 都跑一遍校验
 *   ④ **配置表 ↔ 资源目录**闭合：units.csv 里的每个 charId 都必须真的有贴图
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ART_SCALE,
  expectedSkinPivot,
  expectedSkinSize,
  fitPartGeometry,
  requiredSkinSlots,
  skinErrors,
  validateSkin,
  weaponSkinFile,
} from '../src/core/anim/skin.ts';
import { RIGS } from '../src/data/rigs.ts';
import { UNIT_ROWS } from '../src/data/generated/tables.ts';
import { buildSkin, collectAssetFiles, readPngSize } from '../tools/gen-skin.ts';
import type { SkinDef } from '../src/core/anim/skin.ts';
import type { SlotName } from '../src/core/anim/types.ts';

const GAME_ROOT = join(import.meta.dirname, '..');
const ASSETS = join(GAME_ROOT, 'assets');

/* ══════════════════ ① 期望值来自骨架 ══════════════════ */

test('期望画布尺寸 = 骨架绘制盒 × 2（@2× 作画规范）', () => {
  const rig = RIGS['male_adult']!;
  // docs/rig-spec.md §4 的画布表（已与骨架同步）
  assert.deepEqual(expectedSkinSize(rig, 'torso'), { w: 80, h: 92 });
  assert.deepEqual(expectedSkinSize(rig, 'pelvis'), { w: 68, h: 32 });
  assert.deepEqual(expectedSkinSize(rig, 'cloak'), { w: 92, h: 116 });
  // 头在骨架里乘了 0.98（"头略小一点"，见 rigs.ts）→ 26 × 0.98 × 2 = 51
  assert.deepEqual(expectedSkinSize(rig, 'head'), { w: 48, h: 51 });
  assert.deepEqual(expectedSkinSize(rig, 'upperArmR'), { w: 24, h: 52 });
  assert.deepEqual(expectedSkinSize(rig, 'weapon'), { w: 14, h: 112 });
  assert.equal(ART_SCALE, 2);

  // 每套体型的每个部件都能算出期望值
  for (const rigId of Object.keys(RIGS)) {
    for (const bone of RIGS[rigId]!.bones) {
      const size = expectedSkinSize(RIGS[rigId]!, bone.slot);
      assert.ok(size && size.w > 0 && size.h > 0, `${rigId}/${bone.slot} 尺寸异常`);
    }
  }
});

test('期望枢轴 = 骨架枢轴（枢轴错位会一摆就穿模）', () => {
  const rig = RIGS['male_adult']!;
  assert.deepEqual(expectedSkinPivot(rig, 'torso'), [0.5, 1], '躯干枢轴在腰');
  assert.deepEqual(expectedSkinPivot(rig, 'footR'), [0.25, 0.5], '脚枢轴偏后');
  assert.deepEqual(expectedSkinPivot(rig, 'weapon'), [0.5, 0.12]);
  assert.equal(expectedSkinPivot(rig, 'notASlot' as SlotName), null, '未注册 slot 应返回 null 而不是瞎猜');
});

test('必需部件 = 骨架全部部件 − 可选件（cloak / weapon）', () => {
  const rig = RIGS['male_adult']!;
  const required = requiredSkinSlots(rig);
  assert.equal(required.length, rig.bones.length - 2);
  assert.ok(!required.includes('cloak'));
  assert.ok(!required.includes('weapon'));
  assert.ok(required.includes('torso'));
});

/* ══════════════════ ② 校验器必须抓得住典型错误 ══════════════════ */

/** 造一份"完全正确"的皮肤作为基线 */
function goodSkin(body = 'male_adult'): SkinDef {
  const rig = RIGS[body]!;
  const parts: SkinDef['parts'] = {};
  for (const bone of rig.bones) {
    const size = expectedSkinSize(rig, bone.slot)!;
    parts[bone.slot] = {
      file: `chars/base_male/parts/${bone.slot}.png`,
      w: size.w,
      h: size.h,
      pivot: [bone.pivot?.x ?? 0.5, bone.pivot?.y ?? 0.5],
    };
  }
  return { id: 'test', body, parts };
}

test('基线皮肤通过校验（先确认校验器不是"一律报错"）', () => {
  const skin = goodSkin();
  assert.deepEqual(skinErrors(validateSkin(skin, RIGS['male_adult']!)), []);
});

test('缺件 → error（文件名必须严格等于 slot 名）', () => {
  const skin = goodSkin();
  delete skin.parts.torso;
  const issues = validateSkin(skin, RIGS['male_adult']!);
  const missing = issues.find((i) => i.code === 'MISSING_PART');
  assert.ok(missing, '缺少躯干必须报错');
  assert.match(missing.message, /torso/);
});

test('尺寸画错 → error，并告诉美术"应该是多少"', () => {
  const skin = goodSkin();
  skin.parts.torso = { ...skin.parts.torso!, w: 90, h: 103 };
  const err = skinErrors(validateSkin(skin, RIGS['male_adult']!)).find((i) => i.code === 'BAD_SIZE');
  assert.ok(err);
  assert.match(err.message, /80×92/);
  assert.match(err.message, /90×103/);
});

test('枢轴画错 → error', () => {
  const skin = goodSkin();
  skin.parts.footR = { ...skin.parts.footR!, pivot: [0.5, 0.5] };
  const err = skinErrors(validateSkin(skin, RIGS['male_adult']!)).find((i) => i.code === 'BAD_PIVOT');
  assert.ok(err);
  assert.match(err.message, /枢轴/);
});

test('未注册 slot → error（铁律：只能新增贴图，不能新增 slot）', () => {
  const skin = goodSkin();
  (skin.parts as Record<string, unknown>)['tail'] = {
    file: 'chars/x/parts/tail.png',
    w: 10,
    h: 10,
    pivot: [0.5, 0.5],
  };
  const err = skinErrors(validateSkin(skin, RIGS['male_adult']!)).find((i) => i.code === 'UNKNOWN_SLOT');
  assert.ok(err);
  assert.match(err.message, /tail/);
});

test('文件不存在 → error（传了文件集合时）', () => {
  const skin = goodSkin();
  const files = new Set<string>(); // 什么文件都没有
  const errs = skinErrors(validateSkin(skin, RIGS['male_adult']!, files)).filter(
    (i) => i.code === 'FILE_MISSING',
  );
  assert.ok(errs.length > 0, '所有部件都应报"文件不存在"');
  assert.ok(
    errs.some((e) => e.message.includes('assets/chars/base_male/parts/torso.png')),
    `报错应逐部件给出路径，实际：${errs.map((e) => e.message).join(' | ')}`,
  );
});

test('武器贴图路径按「武器组 × 品质」共享', () => {
  assert.equal(weaponSkinFile('dao', 'fan'), 'weapons/dao/dao_fan.png');
  assert.equal(weaponSkinFile('jian', 'jue'), 'weapons/jian/jian_chuan.png');
  assert.equal(weaponSkinFile('quan', 'fan'), null, '拳掌没有武器贴图');
  assert.equal(weaponSkinFile('dao', 'unknown'), null);
});

/* ══════════════════ ②.5 对位几何（AI 生图落地用） ══════════════════ */

test('对位：contain 缩放不拉伸，且枢轴钉在画布枢轴上', () => {
  // 躯干：内容 127×289 → 画布 80×92，枢轴 0.5,1
  const fit = fitPartGeometry({ w: 127, h: 289 }, { w: 80, h: 92 }, { x: 0.5, y: 1 });
  assert.equal(fit.destW, 40, '289→92 缩放 0.318×，127→40');
  assert.equal(fit.destH, 92);
  // 内容底边中心必须落在画布 (40, 92)
  assert.equal(fit.left + fit.destW / 2, 40);
  assert.equal(fit.top + fit.destH, 92);
});

test('对位：顶边枢轴（肩/肘/膝/腕）与 25% 枢轴（脚）也正确', () => {
  const arm = fitPartGeometry({ w: 66, h: 646 }, { w: 24, h: 52 }, { x: 0.5, y: 0 });
  assert.equal(arm.destH, 52);
  assert.equal(arm.top, 0, '肩在顶边 → 内容顶边贴住画布顶边');
  // 内容宽为奇数像素时，中心只能落在 ±0.5px 内（枢轴是百分比，量化误差不可避免）
  assert.ok(Math.abs(arm.left + arm.destW / 2 - 12) <= 0.5);

  const foot = fitPartGeometry({ w: 200, h: 60 }, { w: 36, h: 16 }, { x: 0.25, y: 0.5 });
  assert.ok(Math.abs(foot.left + 0.25 * foot.destW - 0.25 * 36) <= 0.5);
  assert.ok(Math.abs(foot.top + 0.5 * foot.destH - 0.5 * 16) <= 0.5);
});

test('对位：height 模式按高度贴合（宽度可溢出画布，相邻部件本就要重叠）', () => {
  // 内容很宽时 contain 会被宽度卡住；height 模式则强行按高度贴合、宽度溢出
  const box = { w: 400, h: 289 };
  const contain = fitPartGeometry(box, { w: 80, h: 92 }, { x: 0.5, y: 1 });
  assert.equal(contain.destW, 80, 'contain 受宽度限制');
  assert.ok(contain.destH < 92);

  const byHeight = fitPartGeometry(box, { w: 80, h: 92 }, { x: 0.5, y: 1 }, 'height');
  assert.equal(byHeight.destH, 92);
  assert.ok(byHeight.destW > 80, 'height 模式下宽度按比例放大并溢出画布');
  assert.equal(byHeight.top + byHeight.destH, 92, '枢轴仍然钉住');
});

test('对位：内容比画布小很多时会放大（不设上限），且尺寸至少 1px', () => {
  const tiny = fitPartGeometry({ w: 10, h: 10 }, { w: 80, h: 92 }, { x: 0.5, y: 0.5 });
  assert.ok(tiny.scale > 1);
  assert.ok(tiny.destW > 0 && tiny.destH > 0);
});

/* ══════════════════ ③ 真实资源全部合规 ══════════════════ */

test('PNG 尺寸读取：能从真实文件头读出宽高', () => {
  const file = join(ASSETS, 'chars', 'base_male', 'parts', 'torso.png');
  assert.ok(existsSync(file), '占位贴图应先由 tools/gen-placeholder-art.ts 生成');
  const size = readPngSize(readFileSync(file));
  assert.equal(size.w, 80);
  assert.equal(size.h, 92);
});

test('★ assets/ 下每一个角色目录都能通过皮肤校验（真实资源回归）', () => {
  const files = collectAssetFiles();
  const charIds = [...files]
    .map((f) => /^chars\/([^/]+)\/skin\.json$/.exec(f)?.[1])
    .filter((x): x is string => !!x)
    .sort();

  assert.ok(charIds.length >= 6, `至少应有 6 个角色皮肤，实际 ${charIds.length}`);

  for (const id of charIds) {
    const { skin, issues } = buildSkin(id, undefined, files);
    const errs = skinErrors(issues);
    assert.deepEqual(
      errs,
      [],
      `${id} 的贴图不合规：\n${errs.map((e) => `  [${e.code}] ${e.message}`).join('\n')}`,
    );
    assert.equal(skin.id, id);
    assert.ok(skin.body in RIGS, `${id} 的体型 ${skin.body} 不存在`);
    // 必需部件一个都不能少
    for (const slot of requiredSkinSlots(RIGS[skin.body]!)) {
      assert.ok(skin.parts[slot], `${id} 缺少必需部件 ${slot}`);
    }
  }
});

test('★ 复用的贴图必须与自己的体型一致（跨体型复用会画布不匹配）', () => {
  const files = collectAssetFiles();
  const female = buildSkin('ren_anqi', undefined, files);
  assert.deepEqual(skinErrors(female.issues), [], 'female_adult 的角色必须复用 female_adult 的底图');
  assert.equal(female.skin.body, 'female_adult');
  assert.match(female.skin.parts.torso!.file, /base_female\//);
});

/* ══════════════════ ④ 配置表 ↔ 资源目录 闭合 ══════════════════ */

test('★ units.csv 里的每个 charId 都必须在 assets/chars/ 下真实存在', () => {
  const files = collectAssetFiles();
  const skinIds = new Set(
    [...files]
      .map((f) => /^chars\/([^/]+)\/skin\.json$/.exec(f)?.[1])
      .filter((x): x is string => !!x),
  );
  assert.ok(skinIds.size > 0, '没有找到任何 skin.json');

  for (const unit of UNIT_ROWS) {
    assert.ok(
      skinIds.has(unit.charId),
      `单位「${unit.name}」的 charId=${unit.charId} 在 assets/chars/ 下不存在 —— 会退回色块占位`,
    );
  }
});

test('★ 每个 charId 对应的武器组贴图齐全（否则高品质角色会掉回手臂贴图）', () => {
  const files = collectAssetFiles();
  for (const unit of UNIT_ROWS) {
    const { skin } = buildSkin(unit.charId, undefined, files);
    if (!skin.weaponGroup) continue;
    for (const q of ['fan', 'liang', 'shang', 'ji', 'jue']) {
      const f = weaponSkinFile(skin.weaponGroup, q);
      assert.ok(f && files.has(f), `${unit.name} 的武器组 ${skin.weaponGroup} 缺少 ${q} 档贴图：${f}`);
    }
  }
});

test('每个部件贴图的文件名都等于某个已注册 slot（防止"画了但没接上"）', () => {
  const slotNames = new Set<string>(RIGS['male_adult']!.bones.map((b) => b.slot));
  const files = collectAssetFiles();
  for (const f of files) {
    const m = /^chars\/[^/]+\/parts\/(.+)\.png$/.exec(f);
    if (!m) continue;
    assert.ok(slotNames.has(m[1]!), `${f} 的文件名不是已注册 slot`);
  }
});
