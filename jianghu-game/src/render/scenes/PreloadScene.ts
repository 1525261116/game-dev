/**
 * 资源加载页（PreloadScene）：玩家等待的地方。
 *
 * 设计原则：**进度条必须对应真实的准备工作**，不做假动画。
 * 假的进度条有两个坏处：① 加载慢了会卡在 99% 骗人；② 出错了你看不出来。
 *
 * 当前阶段的"真实准备工作"是：
 *   ① **加载美术贴图**：assets/ 下的皮肤 PNG + 战斗背景
 *   ② 清点动作库（确认 62 个动作都在）
 *   ③ 用校验器全量检查动作数据（站位、挂点、循环一致性…）、配置表、皮肤
 *   ④ 装载 3 套体型骨架
 *
 * 贴图是怎么被找到的？
 *   用 Vite 的 `import.meta.glob` 在**构建期**列出 assets/ 下的全部皮肤与 PNG，
 *   不写任何资源清单 —— 美术往目录里丢文件就能生效，代码零改动。
 */
import Phaser from 'phaser';
import { validateClip } from '../../core/anim/validate.ts';
import { BODY_TYPE_IDS, RIGS, getRig } from '../../data/rigs.ts';
import { MOTIONS } from '../anim/MotionLib.ts';
import { validateTablesAtRuntime } from '../../data/tables.ts';
import { registerSkins, toAssetRelPath } from '../anim/SkinRegistry.ts';
import { skinErrors, validateSkin } from '../../core/anim/skin.ts';
import { FONT, THEME, bodyStyle, dimStyle, titleStyle } from '../ui/Theme.ts';
import type { SkinDef } from '../../core/anim/skin.ts';

/* ══════════════════ 资源清单（构建期静态分析，无需手工登记） ══════════════════ */

/** 全部 skin.json（eager：模块加载即解析成对象） */
const SKIN_MODULES = import.meta.glob('../../../assets/chars/*/skin.json', {
  eager: true,
  import: 'default',
}) as Record<string, SkinDef>;

/** 全部贴图 URL（key 会在下面规范化成"相对 assets/"的路径） */
const PNG_URLS = import.meta.glob('../../../assets/**/*.png', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>;

/** 规范化后的资源路径集合：`chars/x/parts/y.png` */
const ASSET_PATHS: ReadonlySet<string> = new Set(Object.keys(PNG_URLS).map(toAssetRelPath));

/** 全部皮肤定义（id 由 skin.json 的 id 字段决定） */
export const SKIN_DEFS: SkinDef[] = Object.values(SKIN_MODULES).map((s) => s);

/** 一个加载步骤：label 是给玩家看的说明，run 是真正要做的事 */
interface LoadStep {
  label: string;
  run: () => void;
}

export class PreloadScene extends Phaser.Scene {
  private barBg!: Phaser.GameObjects.Rectangle;
  private barFill!: Phaser.GameObjects.Rectangle;
  private label!: Phaser.GameObjects.Text;
  private percent!: Phaser.GameObjects.Text;

  private steps: LoadStep[] = [];
  private stepIndex = 0;

  /** 校验发现的错误（会显示在屏幕上，绝不静默吞掉） */
  private errors: string[] = [];

  constructor() {
    super('preload');
  }

  /**
   * 真正的资源加载。
   *
   * 为什么在 preload() 里搭界面？
   *   因为 Phaser 会**先跑完 preload 再进 create**，进度条必须在这个阶段
   *   就已经存在，否则玩家看到的是白屏而不是进度。
   */
  preload(): void {
    this.buildLoadingUi();

    // 进度条对应真实的加载工作（不做假动画）
    this.load.on('progress', (p: number) => this.setProgress(p));
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      this.errors.push(`贴图加载失败：${file.key}`);
    });

    // 排队加载全部贴图：纹理 key 就用"相对 assets/ 的路径"
    for (const [globKey, url] of Object.entries(PNG_URLS)) {
      this.load.image(toAssetRelPath(globKey), url);
    }

    // 登记皮肤（key 由路径推导，不依赖加载完成）
    registerSkins(SKIN_DEFS, ASSET_PATHS);
  }

  private buildLoadingUi(): void {
    const { width, height } = this.scale;
    const cx = width / 2;

    this.add.text(cx, height * 0.34, '江湖从心', titleStyle(40)).setOrigin(0.5).setResolution(2);
    this.add
      .text(cx, height * 0.34 + 44, '武侠开放世界 · 单机 RPG', dimStyle(13))
      .setOrigin(0.5)
      .setResolution(2);

    const barW = 420;
    const barH = 10;
    this.barBg = this.add
      .rectangle(cx, height * 0.6, barW, barH, THEME.line)
      .setStrokeStyle(1, THEME.gold, 0.55);
    this.barFill = this.add
      .rectangle(cx - barW / 2, height * 0.6, 0, barH, THEME.gold)
      .setOrigin(0, 0.5);

    this.label = this.add
      .text(cx, height * 0.6 - 32, `正在加载美术资源…（${Object.keys(PNG_URLS).length} 张贴图）`, bodyStyle(14))
      .setOrigin(0.5)
      .setResolution(2);
    this.percent = this.add.text(cx, height * 0.6 + 30, '0%', dimStyle(12)).setOrigin(0.5).setResolution(2);
  }

  create(): void {
    this.steps = [
      {
        label: `正在清点动作库…（${MOTIONS.length} 个动作）`,
        run: () => {
          if (MOTIONS.length === 0) this.errors.push('动作库为空：src/data/motions/ 下没有可加载的动作');
        },
      },
      {
        label: '正在校验动作数据…',
        run: () => {
          for (const clip of MOTIONS) {
            const errs = validateClip(clip).filter((i) => i.level === 'error');
            if (errs.length > 0) {
              this.errors.push(`${clip.id}: ${errs.map((e) => e.code).join(',')}`);
            }
          }
        },
      },
      {
        label: '正在校验配置表…',
        run: () => {
          const { ok, issues } = validateTablesAtRuntime();
          if (!ok) {
            for (const i of issues) {
              this.errors.push(`配置表 ${i.file} 第 ${i.row} 行「${i.field}」：${i.message}`);
            }
          }
        },
      },
      {
        label: '正在校验美术皮肤…',
        run: () => {
          for (const skin of SKIN_DEFS) {
            const rig = RIGS[skin.body];
            if (!rig) {
              this.errors.push(`皮肤 ${skin.id} 声明了不存在的体型 ${skin.body}`);
              continue;
            }
            for (const issue of skinErrors(validateSkin(skin, rig, ASSET_PATHS))) {
              this.errors.push(`皮肤 ${skin.id} [${issue.code}] ${issue.message}`);
            }
          }
        },
      },
      {
        label: '正在装载体型骨架…',
        run: () => {
          for (const id of BODY_TYPE_IDS) getRig(id);
        },
      },
      {
        label: `美术资源就绪（${SKIN_DEFS.length} 套皮肤 / ${Object.keys(PNG_URLS).length} 张贴图）`,
        run: () => {
          /* 统计信息，无实际工作 */
        },
      },
      {
        label: '准备就绪',
        run: () => {
          /* 收尾，无实际工作 */
        },
      },
    ];

    // 每帧跑一步，这样进度条能真实地动起来
    this.time.delayedCall(120, () => this.runNextStep());
  }

  private runNextStep(): void {
    if (this.stepIndex >= this.steps.length) {
      this.finish();
      return;
    }

    const step = this.steps[this.stepIndex]!;
    this.label.setText(step.label);

    // 捕获步骤内的异常：加载页崩掉是最糟糕的体验，必须显示出来而不是白屏
    try {
      step.run();
    } catch (e) {
      this.errors.push(`${step.label} → ${(e as Error).message}`);
    }

    this.stepIndex++;
    this.setProgress(this.stepIndex / this.steps.length);
    this.time.delayedCall(160, () => this.runNextStep());
  }

  private setProgress(p: number): void {
    const barW = 420;
    this.barFill.width = barW * Math.min(1, Math.max(0, p));
    this.percent.setText(`${Math.round(p * 100)}%`);
  }

  private finish(): void {
    if (this.errors.length > 0) {
      // 有错就明说，并留在本场景方便排查（开发期这是最有用的信息）
      this.label.setText('加载时发现问题：').setColor(THEME.redHex);
      this.percent.setText(this.errors.slice(0, 4).join('\n'));
      this.percent.setAlign('center').setFontSize(11);
      this.tweens.add({ targets: this.barBg, alpha: 0.2, yoyo: true, repeat: -1, duration: 400 });
      return;
    }
    this.time.delayedCall(180, () => this.scene.start('menu'));
  }
}
