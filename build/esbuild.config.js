/**
 * esbuild bundler configuration for bm_backend.
 *
 * Externalised packages are those that contain native .node binaries
 * (firebase-admin / gRPC family) or are otherwise impossible to inline:
 *   - firebase-admin  → native gRPC binaries
 *   - @grpc/grpc-js   → depends on native http2, tls internals
 *   - @google-cloud/* → optional native addons
 *   - @firebase/*     → re-exports firebase-admin internals
 *
 * Everything else (express, mongoose, axios, multer, stripe, etc.) is
 * pure JavaScript and will be inlined into the bundle.
 */

const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");

// Ensure output directory exists
const distDir = path.resolve(__dirname, "../dist");
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

const EXTERNALS = [
  // ── Firebase & gRPC (native binaries) ──────────────────────────────────
  "firebase-admin",
  "@firebase/app",
  "@firebase/auth",
  "@firebase/firestore",
  "@firebase/messaging",
  "@grpc/grpc-js",
  "@grpc/proto-loader",
  "grpc",
  "google-gax",
  "@google-cloud/storage",
  "@google-cloud/firestore",
  "protobufjs",
  // ── Node built-ins (always external) ───────────────────────────────────
  // esbuild handles these automatically for platform:node, listed for clarity
];

// ── SEA-compatible external-require plugin ────────────────────────────────────
//
// Problem: Inside a Node.js SEA binary the embedded script's `require` is
// `embedderRequire`, which ONLY resolves Node core built-ins (fs, path …).
// Calling require("firebase-admin") throws ERR_UNKNOWN_BUILTIN_MODULE.
//
// Solution: For every external npm package this plugin generates a tiny virtual
// module instead of letting esbuild mark it as `external`.  That virtual module
// calls `require("module")` (a core built-in → works in SEA) to obtain
// `createRequire`, then uses `createRequire(process.execPath)` to build a
// real filesystem resolver pointing at <binary-dir>/node_modules/.
//
// NOTE: we cannot use a `banner` to shadow `require` because inside the CJS
// module wrapper `require` is already a function parameter — redeclaring it
// with `const` is a SyntaxError.
// ─────────────────────────────────────────────────────────────────────────────
const externalFilter = new RegExp(
  `^(${EXTERNALS.map((e) =>
    e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  ).join("|")})(\/|$)`
);

const seaExternalPlugin = {
  name: "sea-external",
  setup(build) {
    // Intercept resolution of every external package
    build.onResolve({ filter: externalFilter }, (args) => ({
      path: args.path,
      namespace: "sea-external",
    }));

    // Return a virtual CJS module that loads the package via createRequire
    build.onLoad({ filter: /.*/, namespace: "sea-external" }, (args) => ({
      contents: [
        `const{createRequire:_cr}=require("module");`,
        `module.exports=_cr(process.execPath)(${JSON.stringify(args.path)});`,
      ].join(""),
      loader: "js",
    }));
  },
};

(async () => {
  console.log("⚙️  esbuild: bundling server.js → dist/bundle.js …");

  const result = await esbuild.build({
    entryPoints: [path.resolve(__dirname, "../server.js")],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    outfile: path.resolve(distDir, "bundle.js"),

    // Tree-shaking & minification
    treeShaking: true,
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,

    // Never emit source maps in production
    sourcemap: false,

    // Strip comments
    legalComments: "none",

    // Bake NODE_ENV into the bundle
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },

    // The plugin handles all EXTERNALS — no separate `external` array needed
    plugins: [seaExternalPlugin],

    logLevel: "info",
    metafile: true,
  });

  // Print a lightweight dependency summary
  const outputs = Object.keys(result.metafile.outputs);
  for (const out of outputs) {
    const sizeKb = (result.metafile.outputs[out].bytes / 1024).toFixed(1);
    console.log(`   ✅  ${out}  (${sizeKb} KB)`);
  }

  console.log("✅  esbuild: bundling complete.");
})().catch((err) => {
  console.error("❌  esbuild failed:", err.message);
  process.exit(1);
});
