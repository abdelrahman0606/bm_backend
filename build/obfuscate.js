/**
 * JavaScript obfuscator — production-safe settings for Node.js.
 *
 * Safety constraints observed:
 *   - controlFlowFlattening: OFF  — breaks async/await and generators
 *   - deadCodeInjection: OFF      — can confuse tree-shaken paths
 *   - selfDefending: OFF          — uses eval internally; breaks strict runtimes
 *   - debugProtection: OFF        — server-side irrelevant; adds overhead
 *   - disableConsoleOutput: OFF   — server logs must remain visible
 *   - renameGlobals: OFF          — breaks CommonJS (module, exports, require)
 *
 * Enabled obfuscation:
 *   - stringArray + base64 encoding — string literals are hidden
 *   - identifierNamesGenerator: hexadecimal — short, unpredictable names
 *   - numbersToExpressions — numeric literals are obfuscated
 *   - unicodeEscapeSequence — string characters are escaped
 */

const JavaScriptObfuscator = require("javascript-obfuscator");
const fs = require("fs");
const path = require("path");

const INPUT = path.resolve(__dirname, "../dist/bundle.js");
const OUTPUT = path.resolve(__dirname, "../dist/bundle.obf.js");

if (!fs.existsSync(INPUT)) {
  console.error(`❌  Obfuscator: input file not found: ${INPUT}`);
  console.error("    Run the esbuild step first: npm run build:bundle");
  process.exit(1);
}

console.log("🔒  Obfuscator: reading dist/bundle.js …");
const source = fs.readFileSync(INPUT, "utf8");
const inputSizeKb = (Buffer.byteLength(source) / 1024).toFixed(1);
console.log(`   Input size: ${inputSizeKb} KB`);

console.log("🔒  Obfuscator: applying obfuscation …");
const obfuscationResult = JavaScriptObfuscator.obfuscate(source, {
  // ── Target ────────────────────────────────────────────────────────────
  target: "node",

  // ── String protection ─────────────────────────────────────────────────
  stringArray: true,
  stringArrayEncoding: ["base64"],
  stringArrayThreshold: 0.75,
  stringArrayCallsTransform: true,
  stringArrayCallsTransformThreshold: 0.5,
  stringArrayWrappersCount: 2,
  stringArrayWrappersType: "function",
  stringArrayWrappersParametersMaxCount: 4,
  stringArrayWrappersChainedCalls: true,
  splitStrings: false, // keep off; fragments crash large bundles

  // ── Identifier renaming ───────────────────────────────────────────────
  identifierNamesGenerator: "hexadecimal",
  renameProperties: false, // OFF — breaks object property access in CJS
  renameGlobals: false,   // OFF — breaks require/module/exports

  // ── Number obfuscation ────────────────────────────────────────────────
  numbersToExpressions: true,
  simplify: true,

  // ── Unicode escaping ─────────────────────────────────────────────────
  unicodeEscapeSequence: false, // OFF — inflates bundle 3-4× for CJS

  // ── Control flow (all OFF for Node.js safety) ─────────────────────────
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
  debugProtection: false,
  debugProtectionInterval: 0,

  // ── Console ──────────────────────────────────────────────────────────
  disableConsoleOutput: false,

  // ── Output ───────────────────────────────────────────────────────────
  compact: true,
  sourceMap: false,
});

const obfuscated = obfuscationResult.getObfuscatedCode();
fs.writeFileSync(OUTPUT, obfuscated, "utf8");

const outputSizeKb = (Buffer.byteLength(obfuscated) / 1024).toFixed(1);
console.log(`   Output size: ${outputSizeKb} KB`);
console.log("✅  Obfuscator: dist/bundle.obf.js written.");
