# BM Backend — Production Build Guide

## Table of Contents

1. [How the Build Works](#1-how-the-build-works)
2. [Prerequisites](#2-prerequisites)
3. [Generating Executables](#3-generating-executables)
4. [Deployment](#4-deployment)
5. [Updating Production](#5-updating-production)
6. [Environment Variables](#6-environment-variables)
7. [Limitations](#7-limitations)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. How the Build Works

The build pipeline transforms the full Node.js source into self-contained executables using a modern three-stage process powered by **Node.js Single Executable Applications (SEA)**:

```
server.js  ──►  [esbuild]  ──►  dist/bundle.js
                                      │
                          [javascript-obfuscator]
                                      │
                             dist/bundle.obf.js
                                      │
                             [Node.js SEA Prep] ──► dist/sea-prep.blob
                                                           │
                                                      [postject]
                                                           │
                                                   production/server (or .exe)
```

### Stage 1 — Bundling (esbuild)

`build/esbuild.config.js` bundles all JavaScript source files into a single `dist/bundle.js`:

- **Tree shaking** removes unused code paths.
- **Minification** shrinks identifiers, syntax, and whitespace.
- **`NODE_ENV`** is set to `"production"` at compile time.
- **Externalized packages**: `firebase-admin` and its gRPC family are excluded from the bundle because they contain compiled native binaries (`.node` files) that cannot be embedded. These are copied separately into `production/node_modules/`.

### Stage 2 — Obfuscation (javascript-obfuscator)

`build/obfuscate.js` transforms `dist/bundle.js` → `dist/bundle.obf.js`:

- String literals are encoded as base64 arrays.
- Identifiers are renamed to hexadecimal names.
- Numeric literals are converted to expressions.
- Options that break Node.js async/await, CommonJS globals (`require`, `module`, `exports`), or server runtime behavior are **intentionally disabled**.

### Stage 3 — Executable Packaging (Node.js SEA)

Node.js SEA is a native feature in Node.js 22+ that replaces legacy bundlers like `pkg`.
The orchestration script (`build/build.js`) handles:
1. Generating a blob from the obfuscated bundle.
2. Copying the Node binary.
3. Injecting the blob securely into the binary using `postject`.

---

## 2. Prerequisites

### Build Machine

| Requirement | Version |
|---|---|
| Node.js | **v22.x** (Required for SEA features) |
| npm | v10+ |

### Install dependencies (once)

```bash
npm install
```

This installs all runtime and dev dependencies, including `esbuild`, `javascript-obfuscator`, and `postject`.

---

## 3. Generating Executables

### Local Build (Windows / Current OS)

Running the build script locally will build an executable for your **current operating system**. For example, if you run this on Windows, it will generate a `server.exe`.

```bash
npm run build
```

### Production Build (Linux x64) via GitHub Actions

Because Node.js SEA uses the host OS's Node binary, **cross-compiling requires running the build on the target OS**.
We have set up a GitHub Actions workflow to automate this.

1. The GitHub workflow (`Build Production SEA (Linux x64)`) automatically runs on:
   - **Manual Dispatch** via the Actions tab.
   - **Tagged Releases** (e.g., `v1.0.0`).
2. The CI workflow builds the Linux executable on `ubuntu-latest`.
3. It packages the `production/` folder into `production-linux-x64.zip` and uploads it as a workflow artifact.
4. If triggered by a git tag, the `.zip` is automatically attached to the GitHub Release.

### Output

After a successful build, the `production/` directory contains:

```
production/
├── server              ← Executable (or server.exe on Windows)
├── config.env          ← Ensure you configure this for production
├── uploads/            ← File upload storage (empty, created at runtime)
├── logs/               ← Application logs (empty)
└── node_modules/       ← Native packages only (firebase-admin, gRPC)
    ├── firebase-admin/
    ├── @firebase/
    ├── @google-cloud/
    ├── @grpc/
    └── ...
```

> **No source code is present in the `production/` directory.**

---

## 4. Deployment

### Step 1: Transfer `production-linux-x64.zip` to the server

Download the artifact from GitHub Actions or the Release page.

**Linux (scp)**
```bash
scp production-linux-x64.zip user@your-server:/opt/
```

On the server, unzip it:
```bash
unzip production-linux-x64.zip -d /opt/bm-backend
```

### Step 2: Edit `config.env` on the server

```bash
nano /opt/bm-backend/config.env
```

Update all environment variables for production (database URI, JWT secrets, Firebase credentials, etc.).

### Step 3: Run the server

**Linux**
```bash
cd /opt/bm-backend
chmod +x server
./server
```

### Step 4: Run as a service (Linux — systemd)

Create `/etc/systemd/system/bm-backend.service`:

```ini
[Unit]
Description=BM Backend API Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/bm-backend
ExecStart=/opt/bm-backend/server
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=bm-backend

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable bm-backend
sudo systemctl start bm-backend
sudo journalctl -u bm-backend -f
```

---

## 5. Updating Production

1. Make your source code changes.
2. Trigger the GitHub Actions workflow manually (or tag a release).
3. Download the new `production-linux-x64.zip`.
4. Stop the service: `sudo systemctl stop bm-backend`
5. Overwrite `/opt/bm-backend/server`. (If dependencies didn't change, you don't need to overwrite `node_modules`).
6. Start the service: `sudo systemctl start bm-backend`

---

## 6. Environment Variables

The server reads all configuration from `config.env`.

| Variable | Description |
|---|---|
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | JWT signing secret |
| `PORT` | HTTP port (default: 8000) |
| `NODE_ENV` | Set to `production` |
| `FIREBASE_PROJECT_ID` | Firebase project ID |
| `FIREBASE_CLIENT_EMAIL` | Firebase service account email |
| `FIREBASE_PRIVATE_KEY` | Firebase private key (use `\n` for newlines) |

> **Security**: Never commit `config.env` to version control.

---

## 7. Limitations

### firebase-admin — native binaries required

`firebase-admin` uses gRPC native binaries (`.node` files) that cannot be bundled by esbuild or injected directly into the SEA. This is why `production/node_modules/` exists.

**Impact**: The `node_modules/` directory must always be deployed alongside the executables. However, it contains **only native packages** — no application source code.

### `uploads/` path uses `process.cwd()`

The server resolves the uploads directory relative to `process.cwd()`. **Always start the server from within the `production/` directory**, not from another location.

```bash
# ✅ Correct
cd /opt/bm-backend && ./server

# ❌ Wrong
/opt/bm-backend/server
```

Or set the working directory in your systemd unit (`WorkingDirectory=/opt/bm-backend`).

---

## 8. Troubleshooting

### `Error: Cannot find module 'firebase-admin'`

The `production/node_modules/` directory was not transferred or is missing dependencies. Make sure you extracted the full `.zip` artifact from CI.

### `ENOENT: no such file or directory, open 'config.env'`

The server is not being started from the `production/` directory. Check `WorkingDirectory` in your service config.

### Executable exits immediately

Check that `config.env` is present and contains valid values. The server will exit with `process.exit(1)` if the database connection fails or a runtime crash occurs. Use `journalctl -u bm-backend -e` to read logs on Linux.
