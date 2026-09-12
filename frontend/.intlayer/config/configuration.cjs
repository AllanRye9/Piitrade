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
    "/workspaces/Piitrade/frontend"
  ],
  "codeDir": [
    "/workspaces/Piitrade/frontend"
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
  "baseDir": "/workspaces/Piitrade/frontend",
  "moduleAugmentationDir": "/workspaces/Piitrade/frontend/.intlayer/types",
  "unmergedDictionariesDir": "/workspaces/Piitrade/frontend/.intlayer/unmerged_dictionary",
  "remoteDictionariesDir": "/workspaces/Piitrade/frontend/.intlayer/remote_dictionary",
  "dictionariesDir": "/workspaces/Piitrade/frontend/.intlayer/dictionary",
  "dynamicDictionariesDir": "/workspaces/Piitrade/frontend/.intlayer/dynamic_dictionary",
  "fetchDictionariesDir": "/workspaces/Piitrade/frontend/.intlayer/fetch_dictionary",
  "typesDir": "/workspaces/Piitrade/frontend/.intlayer/types",
  "mainDir": "/workspaces/Piitrade/frontend/.intlayer/main",
  "configDir": "/workspaces/Piitrade/frontend/.intlayer/config",
  "cacheDir": "/workspaces/Piitrade/frontend/.intlayer/cache",
  "tempDir": "/workspaces/Piitrade/frontend/.intlayer/tmp"
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

module.exports.internationalization = internationalization;
module.exports.dictionary = dictionary;
module.exports.routing = routing;
module.exports.content = content;
module.exports.system = system;
module.exports.editor = editor;
module.exports.analytics = analytics;
module.exports.log = log;
module.exports.ai = ai;
module.exports.build = build;
module.exports.compiler = compiler;
module.exports.schemas = schemas;
module.exports.plugins = plugins;
