import { defineConfig, globalIgnores } from "eslint/config";
import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const baseDirectory = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory });

const eslintConfig = defineConfig([
  ...compat.extends("next/core-web-vitals", "next/typescript"),
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
    // 「学伴面板里不得再有定时器」的**永久闸门**（M1b-2 Task 6 审查补入）。
    //
    // Task 6 把 15 秒的课堂生命期轮询从面板搬进了 `use-classroom-session.ts`。搬完之后实质
    // 边界已由编译器把守 —— 面板拿不到「课堂是活的」这件事，`code` 只是字符串。残余的风险
    // 只剩「将来有人用面板里仍在的 `api` + `code` 重新长一条定时器」，而那种回归没有任何
    // 编译期信号。这条规则把它变成 run lint 就能发现的错误。
    //
    // 只管 `setInterval`：`setTimeout` 在面板里是合法的（Toast 自动消失、语音识别、滚动
    // 回弹都在用），它们是一次性的、且都随卸载清理。
    //
    // 范围是本目录下**除会话生命期模块以外**的全部文件（M1b-2 Task 11 收窄）：`chat/` 里
    // 还住着 `use-chat-socket.ts`，按 §4.10 B7 的判定它是**会话生命期**代码而不是面板
    // （socket 归会话层，面板在它不挂载时也照常收消息）。在这份文件里合法地长一条重连定时器
    // 会收到一条**指错地方**的报错，还会把人往「加 eslint-disable」上推。用 `ignores` 排除
    // 单份文件、而不是把 glob 收窄成一份面板文件清单：收窄后**将来新增的面板文件**会静默落在
    // 闸门之外，那正是这条规则要防的方向，而排除法的失效方向只是「多守住一份会话文件」。
    files: ["src/app/classroom/chat/**/*.{ts,tsx}"],
    ignores: ["src/app/classroom/chat/use-chat-socket.ts"],
    rules: {
      "no-restricted-syntax": ["error",
        {
          selector: "CallExpression[callee.name='setInterval']",
          message: "学伴面板里不得再有定时器：会话生命期的轮询归 use-classroom-session.ts（M1b-2 Task 6）。",
        },
        {
          // `window.setInterval(...)` / `globalThis.setInterval(...)` 这类成员调用。
          selector: "CallExpression[callee.property.name='setInterval']",
          message: "学伴面板里不得再有定时器：会话生命期的轮询归 use-classroom-session.ts（M1b-2 Task 6）。",
        },
      ],
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
