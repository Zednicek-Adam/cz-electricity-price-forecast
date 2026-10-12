import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Only what is not source. Everything else is linted on purpose: TypeScript
    // is supposed to live in `web/`, and a file that turns up outside it
    // should fail loudly rather than go unchecked.
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.wrangler/**",
      "**/.venv/**",
      ".scratch-*/**",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Resolves each file against its own package's tsconfig, so `web/`
        // needs no ESLint configuration of its own.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // This file and any other config at the root are outside the tsconfig.
    files: ["*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
