/**
 * CSS Modules 的导入类型（T28）：`import css from "./X.module.css"` 得到
 * `文件名__类名` 形态的作用域类名映射（vite 的 `generateScopedName` 自定义
 * 函数产物）。构建期 `inline-css-asset` 把样式文本内联进 bundle。
 */
declare module "*.module.css" {
    const classes: Readonly<Record<string, string>>;
    export default classes;
}
