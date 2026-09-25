import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Only what is not source. Everything else is linted on purpose: TypeScript
    // is supposed to live in `api/` and `web/`, and a file that turns up
    // outside them should fail loudly rather than go unchecked.
    ignores: ["**/node_modules/**", "**/dist/**", ".scratch-*/**"],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Resolves each file against its own package's tsconfig, so `api/`
        // and `web/` need no per-package ESLint configuration.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // This file and any other config at the root are outside both tsconfigs.
    files: ["*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
