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

    external: EXTERNALS,

    // ── SEA-compatible require override ─────────────────────────────────
    // Inside a Node.js SEA binary, the built-in `require` is `embedderRequire`
    // which can ONLY load Node core built-ins (fs, path, etc.).  It throws
    // ERR_UNKNOWN_BUILTIN_MODULE for any npm package (firebase-admin, @grpc…).
    //
    // Fix: shadow `require` at the very top of the bundle with one created by
    // `module.createRequire(process.execPath)`.  This resolver looks for
    // node_modules/ relative to the SEA binary, which is exactly what we ship
    // in production/node_modules/.
    banner: {
      js: [
        `const{createRequire:__cr}=require("module");`,
        `const require=__cr(process.execPath);`,
      ].join(""),
    },

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
