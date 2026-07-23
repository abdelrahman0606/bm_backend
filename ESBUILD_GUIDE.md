# Complete esbuild Guide for Node.js Projects
# الدليل الشامل لـ esbuild في مشاريع Node.js

---

## English

### 1. What is esbuild?

**esbuild** is an extremely fast JavaScript/TypeScript bundler and minifier written in Go.
It takes your source files, resolves all `import` and `require()` dependencies, strips TypeScript types, tree-shakes unused code, minifies, and packages everything into a single, optimized JavaScript output file.

---

### 2. Quick Start Steps

#### Step 1: Install esbuild
```bash
npm install --save-dev esbuild
```

#### Step 2: Create a Build Script (`build/esbuild.config.js`)
```javascript
const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");

// Ensure output directory exists
const distDir = path.resolve(__dirname, "../dist");
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

esbuild.build({
  entryPoints: ["server.js"],       // Main entry point file
  bundle: true,                     // Inline all dependencies into one file
  platform: "node",                 // Target Node.js runtime environment
  target: "node22",                 // Set target Node.js version (e.g. node18, node20, node22)
  format: "cjs",                    // Module format: 'cjs' (CommonJS) or 'esm' (ES Modules)
  outfile: "dist/bundle.js",        // Target output file path

  // Optimizations
  treeShaking: true,                // Eliminate dead/unused code
  minifyIdentifiers: true,          // Shorten variable & function names
  minifySyntax: true,               // Simplify syntax expressions
  minifyWhitespace: true,           // Strip spaces, tabs, and newlines

  // Output options
  sourcemap: false,                 // Disable source maps for production
  legalComments: "none",            // Strip license header comments

  // Static replacement / environment injection
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },

  // Packages to leave external (NOT bundled)
  external: [
    "firebase-admin",               // Native gRPC binaries
    "@grpc/grpc-js",
  ],

  logLevel: "info",
}).catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
```

#### Step 3: Configure `package.json`
```json
"scripts": {
  "build": "node build/esbuild.config.js"
}
```

#### Step 4: Run the Build
```bash
npm run build
```

---

### 3. Detailed Option Explanation

| Option | Type | Description |
|---|---|---|
| `entryPoints` | `Array<string>` | The starting file(s) of your application (e.g., `['server.js']` or `['src/index.ts']`). |
| `bundle` | `boolean` | `true` inlines all imported code and dependencies into the final bundle. `false` transforms files individually without bundling. |
| `platform` | `"node"` \| `"browser"` \| `"neutral"` | Setting `"node"` ensures Node.js built-ins (`fs`, `path`, `http`, `crypto`, `events`, etc.) are recognized as built-in modules and not bundled. |
| `target` | `string` | Specifies the JavaScript syntax target version (`"node18"`, `"node20"`, `"node22"`, `"es2022"`). Syntaxes unsupported by the target are transpiled down. |
| `format` | `"cjs"` \| `"esm"` | `"cjs"` produces CommonJS (`module.exports`). `"esm"` produces ES Modules (`export default`). Choose `"cjs"` if your project uses `require()`. |
| `outfile` | `string` | Path for single output file when bundling one entry point. |
| `outdir` | `string` | Directory path when bundling multiple entry points. |
| `treeShaking` | `boolean` | Automatically removes unused functions, classes, and variables from the output bundle. |
| `minify` | `boolean` | Shorthand for enabling `minifyIdentifiers`, `minifySyntax`, and `minifyWhitespace`. |
| `sourcemap` | `boolean` \| `"inline"` | Controls source map generation. Set `false` in production for maximum file size reduction and security. |
| `define` | `Object` | Replaces global identifier references with static values at build time (e.g., `"process.env.NODE_ENV": "\"production\""`). |
| `external` | `Array<string>` | Packages listed here will **NOT** be bundled into the file. They will remain standard `require('pkg')` / `import 'pkg'` calls at runtime. |
| `loader` | `Object` | Defines how non-JS files are processed (e.g., `{ '.png': 'dataurl', '.json': 'json', '.ts': 'ts' }`). |
| `banner` | `Object` | Injects code at the very top of the generated bundle (e.g., `{ js: '#!/usr/bin/env node' }`). |
| `footer` | `Object` | Injects code at the very end of the generated bundle. |

---

### 4. Handling Native Modules & Binaries (`.node` files)

Packages that rely on C/C++ native addons (e.g. `firebase-admin`, `grpc`, `bcrypt`, `canvas`, `sqlite3`, `sharp`) contain `.node` binary files.

**Rule:** `.node` binary files **cannot** be bundled inside a JavaScript file.

#### How to handle them:
1. Always list packages containing native binaries in the `external` array:
   ```javascript
   external: ["firebase-admin", "@grpc/grpc-js", "bcrypt", "sqlite3"]
   ```
2. In production deployments, ensure these external packages are included in `node_modules/` alongside your bundle.

---

### 5. Handling Dynamic Requires (`require(variable)`)

If your code or a dependency uses dynamic require syntax like:
```javascript
const moduleName = getModuleName();
require("./plugins/" + moduleName);
```
esbuild cannot statically determine which file to bundle and will issue a warning:
`Dynamic require may fail at run time`.

#### Solutions:
- **Solution 1:** Externalize the dynamically required package by adding it to `external`.
- **Solution 2:** Replace dynamic requires with explicit static imports or a `switch` statement if possible.

---

### 6. TypeScript & JSX Support

esbuild natively parses and strips TypeScript types (`.ts`, `.tsx`) **without needing `tsc` or Babel**.

- **No extra config required:** Point `entryPoints` directly to `.ts` files:
  ```javascript
  entryPoints: ["src/server.ts"]
  ```
- **Type Checking:** esbuild does **not** check types (for maximum speed). Run `tsc --noEmit` separately in your CI/CD pipeline to verify type correctness:
  ```json
  "scripts": {
    "type-check": "tsc --noEmit",
    "build": "npm run type-check && node build/esbuild.config.js"
  }
  ```

---

### 7. CommonJS (`cjs`) vs. ES Modules (`esm`)

| Project Setup | `format` setting | Output Syntax | Notes |
|---|---|---|---|
| Standard Node.js (`require`) | `"cjs"` | `require()` / `module.exports` | Most compatible with existing Node.js codebases. |
| Modern ESM (`import`/`export`) | `"esm"` | `import` / `export` | Required if `package.json` contains `"type": "module"`. |

If you encounter `ReferenceError: exports is not defined in ES module scope`, check your `format` setting and ensure it matches your project's module system.

---

### 8. Troubleshooting Matrix

| Problem / Error | Cause | Solution |
|---|---|---|
| `Could not resolve "xyz"` | Package is missing or path is incorrect. | Install package or add `"xyz"` to `external`. |
| `Dynamic require may fail at run time` | Code contains `require(variable)`. | Add the module to `external`. |
| App crashes on server after build | Native binary `.node` file was not externalized. | Add package to `external` and copy its `node_modules`. |
| `process.env.X` is `undefined` | Env variable not provided at runtime or build time. | Use `define` in esbuild config or load `dotenv` at startup. |
| Output file is empty or missing exports | Entry point file path is incorrect. | Verify `entryPoints` relative path. |

---
---

## العربي

### 1. ما هو esbuild؟

**esbuild** هي أداة تجميع وتصغير (Bundler & Minifier) فائقة السرعة لكود JavaScript و TypeScript مكتوبة بلغة Go.  
تقوم بقراءة ملفات المشروع، تتبع كافة الاعتماديات (`import` و `require`), حذف كود TypeScript غير المستفاد منه (Type Stripping), حذف الكود الميت (Tree Shaking), ضغط الكود، ودمج كل شيء في **ملف JavaScript واحد** مجهّز للإنتاج.

---

### 2. خطوات الاستخدام السريعة

#### الخطوة 1: تثبيت esbuild
```bash
npm install --save-dev esbuild
```

#### الخطوة 2: إنشاء ملف الإعدادات (`build/esbuild.config.js`)
```javascript
const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");

// التأكد من وجود مجلد الإخراج
const distDir = path.resolve(__dirname, "../dist");
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

esbuild.build({
  entryPoints: ["server.js"],       // ملف البداية الرئيسي للمشروع
  bundle: true,                     // دمج جميع الاعتماديات في ملف واحد
  platform: "node",                 // تحديد بيئة التشغيل كـ Node.js
  target: "node22",                 // تحديد إصدار Node.js المستهدف (مثل node18, node20, node22)
  format: "cjs",                    // صيغة الموديول: 'cjs' (CommonJS) أو 'esm' (ES Modules)
  outfile: "dist/bundle.js",        // مسار ملف الناتج النهائي

  // التحسين والضغط
  treeShaking: true,                // استبعاد الكود غير المستخدم نهائياً
  minifyIdentifiers: true,          // اختصار أسماء المتغيرات والدوال
  minifySyntax: true,               // تبسيط التعبيرات البرمجية
  minifyWhitespace: true,           // إزالة المسافات والأسطر الفارغة

  // إعدادات المخرجات والأمان
  sourcemap: false,                 // إلغاء خريطة المصدر للإنتاج
  legalComments: "none",            // إزالة التعليقات التوضيحية

  // التعويض الاستاتيكي لمتغيرات البيئة
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },

  // الحزم الخارجية التي لا يتم دمجها داخل الملف (تظل استدعاءات خارجية)
  external: [
    "firebase-admin",               // الحزم التي تحتوي ملفات C++ ناتيف
    "@grpc/grpc-js",
  ],

  logLevel: "info",
}).catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
```

#### الخطوة 3: إضافة سكريبت في `package.json`
```json
"scripts": {
  "build": "node build/esbuild.config.js"
}
```

#### الخطوة 4: تشغيل عملية البناء
```bash
npm run build
```

---

### 3. شرح تفصيلي لجميع خيارات الإعداد (Options)

| الخيار (Option) | النوع | الوصف الشامل |
|---|---|---|
| `entryPoints` | `Array<string>` | مسار ملف (أو ملفات) البداية للمشروع (مثل `['server.js']` أو `['src/index.ts']`). |
| `bundle` | `boolean` | عند ضبطه كـ `true`, يقوم esbuild بدمج جميع الكود المستورد والاعتماديات في ملف ناتج واحد. |
| `platform` | `"node"` \| `"browser"` \| `"neutral"` | عند اختيار `"node"`, يتم التعرف على مكتبات Node.js المدمجة (`fs`, `path`, `http`, `crypto`) كمكتبات نظام وعدم محاولة تجميعها داخل الكود. |
| `target` | `string` | يحدد إصدار JavaScript المستهدف (`"node18"`, `"node20"`, `"node22"`). يتم تحويل الكود ليكون متوافقاً مع هذا الإصدار. |
| `format` | `"cjs"` \| `"esm"` | `"cjs"` ينشئ كود بصيغة CommonJS (`require`). `"esm"` ينشئ كود بصيغة ES Modules (`import`). اختار `"cjs"` إذا كان مشروعك يستعمل `require`. |
| `outfile` | `string` | مسار ملف الإخراج عند تجميع نقطة بداية واحدة. |
| `outdir` | `string` | مسار مجلد الإخراج عند تجميع عدة نقاط بداية. |
| `treeShaking` | `boolean` | يقوم بإزالة الدوال والمتغيرات التي لا يتم استخدامها في الكود تلقائياً لتقليل حجم الملف النهائي. |
| `minify` | `boolean` | تفعيل اختصارات الضغط (اختصار المتغيرات، تبسيط الصيغ، حذف المسافات). |
| `sourcemap` | `boolean` \| `"inline"` | التحكم في إنشاء ملفات Source Map. يُفضل تعطيلها (`false`) في بيئة الإنتاج للحماية وتقليل الحجم. |
| `define` | `Object` | استبدال التعبيرات البرمجية بقيم ثابتة أثناء البناء (مثل استبدال `process.env.NODE_ENV` بـ `"production"`). |
| `external` | `Array<string>` | الحزم المذكورة هنا **لن يتم دمجها** داخل ملف الناتج النهائي وتظل استدعاءات `require('pkg')` خارجية عند التشغيل. |
| `loader` | `Object` | تحديد كيفية التعامل مع الملفات غير البرمجية (مثل الصور أو ملفات JSON أو TypeScript). |
| `banner` | `Object` | إدراج كود في بداية ملف الناتج النهائي مباشرة (مثل إدراج `#!/usr/bin/env node`). |
| `footer` | `Object` | إدراج كود في نهاية ملف الناتج النهائي. |

---

### 4. التعامل مع مكتبات C++ الأصليّة (Native Modules & `.node` files)

الحزم التي تعتمد على كود ناتيف C/C++ (مثل `firebase-admin`, `grpc`, `bcrypt`, `canvas`, `sqlite3`) تحتوي على ملفات ثنائية بصيغة `.node`.

**قاعدة هامة:** الملفات الثنائية `.node` **لا يمكن** دمجها داخل ملف JavaScript واحد.

#### كيفية التعامل معها:
1. قم دائماً بوضع الحزم التي تحتوي ملفات ناتيف داخل مصفوفة `external`:
   ```javascript
   external: ["firebase-admin", "@grpc/grpc-js", "bcrypt", "sqlite3"]
   ```
2. في بيئة السيرفر (Production), تأكد من وجود مجلد `node_modules/` يحتوي على هذه الحزم المحددة فقط بجانب الملف النهائي.

---

### 5. التعامل مع الاستدعاء الديناميكي (`require(variable)`)

إذا كان الكود يشتمل على استدعاءات ديناميكية مثل:
```javascript
const moduleName = getModuleName();
require("./plugins/" + moduleName);
```
فإن esbuild لا يستطيع التنبؤ بالملف المطلوب تجميعه استاتيكياً، وسيظهر تحذير:
`Dynamic require may fail at run time`.

#### الحلول:
- **الحل الأول:** إدراج الموديول أو الحزمة المطلوبة ديناميكياً ضمن القائمة `external`.
- **الحل الثاني:** إعادة كتابة الاستدعاء الديناميكي ليكون استدعاء ثابتاً (Static Import) أو باستخدام تعبير `switch`.

---

### 6. دعم TypeScript و JSX

يدعم esbuild قراءة وتحويل ملفات TypeScript (`.ts`, `.tsx`) **بدون الحاجة لـ `tsc` أو Babel**.

- **بدون إعدادات إضافية:** قم بتوجيه `entryPoints` مباشرة لملفات `.ts`:
  ```javascript
  entryPoints: ["src/server.ts"]
  ```
- **فحص الأنواع (Type Checking):** esbuild لا يقوم بفحص الأنواع (لتوفير السرعة الفائقة). قم بتشغيل `tsc --noEmit` بشكل منفصل في سكريبت البناء للتأكد من صحة الأنواع:
  ```json
  "scripts": {
    "type-check": "tsc --noEmit",
    "build": "npm run type-check && node build/esbuild.config.js"
  }
  ```

---

### 7. الفرق بين CommonJS (`cjs`) و ES Modules (`esm`)

| نظام المشروع | خيار `format` | صيغة الناتج | ملاحظات |
|---|---|---|---|
| Node.js التقليدي (`require`) | `"cjs"` | `require()` / `module.exports` | الأكثر توافقاً مع مشاريع Node.js الحالية. |
| ESM الحديث (`import`/`export`) | `"esm"` | `import` / `export` | مطلوب إذا كان `package.json` يحتوي على `"type": "module"`. |

إذا ظهر لك خطأ `ReferenceError: exports is not defined in ES module scope`, تأكد من ضبط خيار `format` ليتوافق مع نظام الموديولات في مشروعك.

---

### 8. دليل حل المشكلات والأخطاء الشائعة

| الخطأ / المشكلة | السبب | الحل |
|---|---|---|
| `Could not resolve "xyz"` | الحزمة مفقودة أو المسار غير صحيح. | قم بتثبيت الحزمة أو أضف `"xyz"` إلى قائمة `external`. |
| `Dynamic require may fail at run time` | الكود يحتوي على استدعاء ديناميكي `require(متغير)`. | أضف الموديول المستهدف إلى قائمة `external`. |
| التطبيق يتوقف على السيرفر بعد البناء | حزمة تحتوي ملفات ناتيف `.node` لم تضاف للخوارج. | أضف الحزمة إلى `external` وانسخ مجلدها من `node_modules`. |
| `process.env.X` قيمته `undefined` | متغير البيئة غير محدد أثناء البناء أو التشغيل. | استخدم `define` في ملف الإعدادات أو استدعِ `dotenv` في بداية التشغيل. |
| ملف الناتج فارغ أو لا يصدر التصديرات | مسار ملف البداية غير صحيح. | تحقق من المسار المكتوب في `entryPoints`. |
