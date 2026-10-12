/**
 * 游戏入口。
 *
 * 这里只做两件事：
 *   ① 配置 Phaser（分辨率、缩放策略、渲染后端）
 *   ② 注册全部场景
 * 其余任何逻辑都不应该出现在这个文件里 —— 保持入口极短，是可维护性的基本要求。
 */
import Phaser from 'phaser';

import { VIEW_H, VIEW_W } from './render/ui/layout.ts';
import { BootScene } from './render/scenes/BootScene.ts';
import { PreloadScene } from './render/scenes/PreloadScene.ts';
import { MenuScene } from './render/scenes/MenuScene.ts';
import { BattleScene } from './render/scenes/BattleScene.ts';
import { BattleLabScene } from './render/scenes/BattleLabScene.ts';
import { MotionLabScene } from './render/scenes/MotionLabScene.ts';

const config: Phaser.Types.Core.GameConfig = {
  // AUTO = 优先 WebGL，不支持时自动回退 Canvas（兼容老旧手机）
  type: Phaser.AUTO,
  parent: 'game',

  // 逻辑分辨率固定 1280×720（见 src/render/ui/layout.ts）：
  // 写代码时永远按这套坐标思考，不用管用户屏幕多大。
  // 从 960×540 提上来是为了：① 画布被浏览器放大的倍数 1.56× → 1.17×（更清楚）
  // ② 给"放大角色"腾出纵向空间（同一屏能放下 141px 高的角色而不撞车）
  width: VIEW_W,
  height: VIEW_H,
  backgroundColor: '#efe9da',

  scale: {
    // FIT：等比缩放填满屏幕并居中，绝不变形（移动端关键）
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },

  // 场景列表：数组里的第一个会自动启动，其余按 key 手动切换
  scene: [BootScene, PreloadScene, MenuScene, BattleScene, BattleLabScene, MotionLabScene],
};

// 全局只允许存在一个 Phaser.Game 实例
export const game = new Phaser.Game(config);

/**
 * 开发期把实例挂到 window。
 *
 * 为什么需要它？
 *   Vite 热更新会给模块地址加上 `?t=` 时间戳，于是"在控制台里 import 一次
 *   main.ts"很可能拿到**另一份模块实例**，结果是又 new 了一个 Phaser.Game
 *   （画面上出现两块画布）。挂到 window 后，调试脚本 / 截图脚本 / 你自己在
 *   控制台里切场景，拿到的永远是**同一个**实例。
 *
 * 生产构建时 `import.meta.env.DEV` 为 false，这段会被摇树掉。
 */
if (import.meta.env.DEV) {
  (globalThis as typeof globalThis & { __jianghuGame?: Phaser.Game }).__jianghuGame = game;
}
