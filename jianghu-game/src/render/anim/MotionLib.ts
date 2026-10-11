/**
 * 动作库注册表：把 src/data/motions/ 下的 62 个动作 JSON 全部收进来。
 *
 * 用的是 Vite 的 `import.meta.glob`：
 *   它在**构建时**扫描目录，把所有匹配的文件一次性打包进来。
 *   好处是——以后你新增或删除动作文件，这里**一行代码都不用改**。
 *
 * 分层说明：本文件属于「表现层」（render），只负责"有哪些动作可用"，
 *           不含任何游戏数值逻辑；数值逻辑在 core/ 里。
 */
import type { MotionClip } from '../../core/anim/types.ts';

/** 批量导入全部动作 JSON（eager: true = 立即加载，不做懒加载） */
const modules = import.meta.glob<{ default: MotionClip }>('../../data/motions/*.json', {
  eager: true,
});

/** 全部动作，按 id 排序 —— 顺序稳定，"下一个动作"才是可预期的 */
export const MOTIONS: MotionClip[] = Object.values(modules)
  .map((m) => m.default)
  .sort((a, b) => a.id.localeCompare(b.id));

/** 按 id 查动作，O(1) */
export const MOTIONS_BY_ID: Record<string, MotionClip> = Object.fromEntries(
  MOTIONS.map((m) => [m.id, m]),
);

/** 取一个动作；不存在时返回 undefined（调用方自行决定兜底策略） */
export function getMotion(id: string): MotionClip | undefined {
  return MOTIONS_BY_ID[id];
}
