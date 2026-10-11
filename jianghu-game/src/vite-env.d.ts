/// <reference types="vite/client" />
/**
 * Vite 环境类型声明。
 *
 * 作用：让 TypeScript 认识 Vite 特有的能力，例如
 *   - `import.meta.glob()`：一次性批量导入一堆文件（我们用它加载 62 个动作）
 *   - `import.meta.env`：读取环境变量
 *
 * 这三行是 Vite 项目的标准做法，不要删。
 */
