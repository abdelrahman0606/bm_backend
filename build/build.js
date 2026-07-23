/**
 * build/build.js — Main orchestration script for the production build using Node.js SEA.
 *
 * Steps:
 *  1. Clean dist/
 *  2. Run esbuild       → dist/bundle.js
 *  3. Run obfuscator    → dist/bundle.obf.js
 *  4. Node SEA          → Generate blob and inject into node executable
 *  5. Copy native node_modules (firebase-admin, grpc) → production/node_modules
 *  6. Scaffold production directory layout
 *
 * Usage:
 *   node build/build.js
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

// ── Helpers ────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const PRODUCTION = path.join(ROOT, "production");

function log(msg) {
  console.log(`\n${"─".repeat(60)}\n  ${msg}\n${"─".repeat(60)}`);
}

function run(label, cmd, opts = {}) {
  console.log(`\n▶  ${label}`);
  console.log(`   $ ${cmd}\n`);
  try {
    execSync(cmd, { stdio: "inherit", cwd: ROOT, ...opts });
  } catch (err) {
    console.error(`\n❌  Step failed: ${label}`);
    process.exit(1);
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyDir(src, dest) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ── Step 1: Clean dist/ ─────────────────────────────────────────────────────

log("Step 1 — Clean previous dist/");
if (fs.existsSync(DIST)) {
  fs.rmSync(DIST, { recursive: true, force: true });
  console.log("   Removed dist/");
}
ensureDir(DIST);

// ── Step 2: esbuild ─────────────────────────────────────────────────────────

log("Step 2 — Bundle with esbuild");
run("esbuild", `node ${path.join("build", "esbuild.config.js")}`);

// ── Step 3: Obfuscate ───────────────────────────────────────────────────────

log("Step 3 — Obfuscate bundle");
run("obfuscator", `node ${path.join("build", "obfuscate.js")}`);

// ── Step 4: Node SEA — generate executable ──────────────────────────────────

log("Step 4 — Generate executable with Node.js SEA");
ensureDir(PRODUCTION);

// 1. Create sea-config.json
const seaConfigPath = path.join(DIST, "sea-config.json");
const seaBlobPath = path.join(DIST, "sea-prep.blob");
const seaConfig = {
  main: path.join("dist", "bundle.obf.js").replace(/\\/g, "/"),
  output: path.join("dist", "sea-prep.blob").replace(/\\/g, "/"),
  disableExperimentalSEAWarning: true
};
fs.writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2));

// 2. Generate the blob
run("Generate SEA Blob", `node --experimental-sea-config ${path.join("dist", "sea-config.json")}`);

// 3. Copy the current Node binary
const isWindows = os.platform() === "win32";
const exeName = isWindows ? "server.exe" : "server";
const outPath = path.join(PRODUCTION, exeName);
console.log(`   Copying Node executable to ${outPath}`);
fs.copyFileSync(process.execPath, outPath);

// 4. Inject the blob using postject
const machoFlag = os.platform() === 'darwin' ? '--macho-segment-name NODE_SEA' : '';
run(
  "Inject SEA Blob",
  `npx postject "${outPath}" NODE_SEA_BLOB "${seaBlobPath}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 ${machoFlag} --overwrite`
);

// ── Step 5: Copy native node_modules ────────────────────────────────────────

log("Step 5 — Copy native node_modules (firebase-admin + gRPC)");

const NATIVE_PACKAGES = [
  "firebase-admin",
  "@firebase",
  "@google-cloud",
  "@grpc",
  "grpc",
  "google-gax",
  "protobufjs",
  "proto3-json-serializer",
  "long",
  "node-pre-gyp",
  "node-fetch",
  "abort-controller",
  "event-target-shim",
  "whatwg-url",
  "tr46",
  "webidl-conversions",
];

const srcNodeModules  = path.join(ROOT, "node_modules");
const destNodeModules = path.join(PRODUCTION, "node_modules");
ensureDir(destNodeModules);

let copied = 0;
for (const pkg of NATIVE_PACKAGES) {
  const srcPkg = path.join(srcNodeModules, pkg);
  if (fs.existsSync(srcPkg)) {
    const destPkg = path.join(destNodeModules, pkg);
    console.log(`   Copying: node_modules/${pkg}`);
    copyDir(srcPkg, destPkg);
    copied++;
  } else {
    console.log(`   Skipped (not found): node_modules/${pkg}`);
  }
}
console.log(`\n   ✅  Copied ${copied} native package(s) to production/node_modules`);

// ── Step 6: Scaffold production directory ───────────────────────────────────

log("Step 6 — Scaffold production directory");

ensureDir(path.join(PRODUCTION, "uploads"));
ensureDir(path.join(PRODUCTION, "logs"));

console.log("   Created: production/uploads/");
console.log("   Created: production/logs/");

const srcEnv  = path.join(ROOT, "config.env");
const destEnv = path.join(PRODUCTION, "config.env");
if (fs.existsSync(srcEnv)) {
  fs.copyFileSync(srcEnv, destEnv);
  console.log("   Copied:  config.env → production/config.env");
} else {
  console.warn("   ⚠️  config.env not found — you must manually create production/config.env");
}

// ── Final report ────────────────────────────────────────────────────────────

log("Build Complete — production/ layout");

function printTree(dir, prefix = "") {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => !e.name.startsWith(".git"))
    .slice(0, 30); 

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const isLast = i === entries.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = isLast ? "    " : "│   ";

    if (entry.name === "node_modules") {
      console.log(`${prefix}${connector}node_modules/ (native packages only)`);
      continue;
    }

    if (entry.isDirectory()) {
      console.log(`${prefix}${connector}${entry.name}/`);
      if (prefix === "") {
        printTree(path.join(dir, entry.name), prefix + childPrefix);
      }
    } else {
      const size = fs.statSync(path.join(dir, entry.name)).size;
      const sizeStr = size > 1024 * 1024
        ? `${(size / 1024 / 1024).toFixed(1)} MB`
        : `${(size / 1024).toFixed(1)} KB`;
      console.log(`${prefix}${connector}${entry.name}  (${sizeStr})`);
    }
  }
}

console.log("\nproduction/");
printTree(PRODUCTION);
console.log(`\n🚀  Done! Deploy the production/ directory to your server.`);
console.log(`    Start command: ./${exeName}  (Working dir must be production/)\n`);
