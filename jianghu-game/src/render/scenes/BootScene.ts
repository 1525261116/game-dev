/**
 * 启动场景（BootScene）：游戏的最初一帧。
 *
 * 它只做一件事：决定"接下来去哪"，然后立刻把控制权交出去。
 *
 * 为什么不把所有初始化都塞在这里？
 *   因为启动阶段越短，玩家看到黑屏的时间越短。真正的加载工作属于 PreloadScene，
 *   那里有进度条可以告诉玩家"在等什么"。
 */
import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create(): void {
    // 目前无需预热资源，直接进入加载页。
    // 将来如果有"必须先于进度条存在"的极少量资源（例如加载条本身的贴图），放这里。
    this.scene.start('preload');
  }
}
