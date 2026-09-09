import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // TypeScript lives in `api/` and `web/` and nowhere else; the rest of the
    // repository is Python, SQL, Markdown or scratch space.
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      ".scratch-*/**",
      "analysis/**",
      "data/**",
      "db/**",
      "docs/**",
      "forecast/**",
      "prototypes/**",
    ],
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
