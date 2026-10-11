/**
 * 游戏入口。
 *
 * 这里只做两件事：
 *   ① 配置 Phaser（分辨率、缩放策略、渲染后端）
 *   ② 注册全部场景
 * 其余任何逻辑都不应该出现在这个文件里 —— 保持入口极短，是可维护性的基本要求。
 */
import Phaser from 'phaser';

import { BootScene } from './render/scenes/BootScene.ts';
import { PreloadScene } from './render/scenes/PreloadScene.ts';
import { MenuScene } from './render/scenes/MenuScene.ts';
import { BattleScene } from './render/scenes/BattleScene.ts';
import { MotionLabScene } from './render/scenes/MotionLabScene.ts';

const config: Phaser.Types.Core.GameConfig = {
  // AUTO = 优先 WebGL，不支持时自动回退 Canvas（兼容老旧手机）
  type: Phaser.AUTO,
  parent: 'game',

  // 逻辑分辨率固定 960×540：写代码时永远按这套坐标思考，不用管用户屏幕多大
  width: 960,
  height: 540,
  backgroundColor: '#efe9da',

  scale: {
    // FIT：等比缩放填满屏幕并居中，绝不变形（移动端关键）
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },

  // 场景列表：数组里的第一个会自动启动，其余按 key 手动切换
  scene: [BootScene, PreloadScene, MenuScene, BattleScene, MotionLabScene],
};

// 全局只允许存在一个 Phaser.Game 实例
export const game = new Phaser.Game(config);
