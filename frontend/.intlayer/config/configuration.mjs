const internationalization = {
  "locales": [
    "en",
    "lg",
    "sw"
  ],
  "requiredLocales": [
    "en",
    "lg",
    "sw"
  ],
  "strictMode": "loose",
  "defaultLocale": "en"
};
const dictionary = {
  "fill": true,
  "contentAutoTransformation": false,
  "location": "local",
  "importMode": "static"
};
const routing = {
  "mode": "no-prefix",
  "storage": {
    "cookies": [
      {
        "name": "INTLAYER_LOCALE",
        "attributes": {
          "path": "/"
        }
      }
    ],
    "headers": [
      {
        "name": "x-intlayer-locale"
      }
    ]
  },
  "basePath": ""
};
const content = {
  "fileExtensions": [
    ".content.ts",
    ".content.js",
    ".content.cjs",
    ".content.mjs",
    ".content.json",
    ".content.json5",
    ".content.jsonc",
    ".content.tsx",
    ".content.jsx",
    ".content.md",
    ".content.mdx",
    ".content.yaml",
    ".content.yml"
  ],
  "contentDir": [
    "/home/claude/p/frontend"
  ],
  "codeDir": [
    "/home/claude/p/frontend"
  ],
  "excludedPath": [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.intlayer/**",
    "**/.next/**",
    "**/.nuxt/**",
    "**/.expo/**",
    "**/.vercel/**",
    "**/.turbo/**",
    "**/.tanstack/**",
    "**/.output/**",
    "**/.svelte-kit/**"
  ],
  "watch": true
};
const system = {
  "baseDir": "/home/claude/p/frontend",
  "moduleAugmentationDir": "/home/claude/p/frontend/.intlayer/types",
  "unmergedDictionariesDir": "/home/claude/p/frontend/.intlayer/unmerged_dictionary",
  "remoteDictionariesDir": "/home/claude/p/frontend/.intlayer/remote_dictionary",
  "dictionariesDir": "/home/claude/p/frontend/.intlayer/dictionary",
  "dynamicDictionariesDir": "/home/claude/p/frontend/.intlayer/dynamic_dictionary",
  "fetchDictionariesDir": "/home/claude/p/frontend/.intlayer/fetch_dictionary",
  "typesDir": "/home/claude/p/frontend/.intlayer/types",
  "mainDir": "/home/claude/p/frontend/.intlayer/main",
  "configDir": "/home/claude/p/frontend/.intlayer/config",
  "cacheDir": "/home/claude/p/frontend/.intlayer/cache",
  "tempDir": "/home/claude/p/frontend/.intlayer/tmp"
};
const editor = {
  "editorURL": "http://localhost:8000",
  "cmsURL": "https://app.intlayer.org",
  "backendURL": "https://back.intlayer.org",
  "port": 8000,
  "enabled": false,
  "dictionaryPriorityStrategy": "local_first",
  "liveSync": false,
  "liveSyncPort": 4000,
  "liveSyncURL": "http://localhost:4000"
};
const analytics = {
  "enabled": true,
  "flushInterval": 20000,
  "sampleRate": 1
};
const log = {
  "mode": "default",
  "prefix": "\u001b[38;5;239m[intlayer] \u001b[0m"
};
const ai = {};
const build = {
  "mode": "auto",
  "minify": false,
  "purge": false,
  "chunkGrouping": true,
  "dictionariesPreload": true,
  "traversePattern": [
    "**/*.{tsx,ts,js,mjs,cjs,jsx,vue,svelte,astro}",
    "!**/node_modules/**",
    "!**/dist/**",
    "!**/build/**",
    "!**/.intlayer/**",
    "!**/.next/**",
    "!**/.nuxt/**",
    "!**/.expo/**",
    "!**/.vercel/**",
    "!**/.turbo/**",
    "!**/.tanstack/**",
    "!**/.output/**",
    "!**/.svelte-kit/**",
    "!**/*.config.*",
    "!**/*.test.*",
    "!**/*.spec.*",
    "!**/*.stories.*",
    "!**/*.d.ts",
    "!**/*.d.ts.map",
    "!**/*.map"
  ],
  "outputFormat": [
    "esm",
    "cjs"
  ],
  "cache": true,
  "checkTypes": false
};
const compiler = {
  "enabled": false,
  "dictionaryKeyPrefix": "",
  "noMetadata": false,
  "saveComponents": false
};
const schemas = undefined;
const plugins = undefined;

export { internationalization, dictionary, routing, content, system, editor, analytics, log, ai, build, compiler, schemas, plugins };
