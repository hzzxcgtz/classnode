import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["server/src/**/*.ts"],
    rules: {
      // 路由 catch 块多数只需向客户端返回稳定错误，不应强制记录潜在敏感异常。
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrors: "none",
      }],
    },
  },
  {
    files: ["src/**/*.tsx"],
    rules: {
      // 本项目是静态导出且头像/附件多为运行时 URL、SVG data URL，Next Image 无法提供优化收益。
      "@next/next/no-img-element": "off",
    },
  },
  {
    files: ["scripts/**/*.js", "serve-frontend.js"],
    rules: {
      // These standalone Node utilities intentionally run as CommonJS.
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "server/dist/**",
    "server/frontend/**",
    "src-tauri/resources/**",
    "src-tauri/target/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
