# Deployment Guide — server.exe / server (Linux)
# دليل النشر — server.exe / server (لينكس)

---

## English

---

### What is inside `production/` ?

After running `npm run build`, you get this folder:

```
production/
├── server.exe          ← Windows executable
├── server              ← Linux executable (after npm run build:linux)
├── config.env          ← All environment variables (secrets, DB URL, etc.)
├── uploads/            ← Where uploaded files are saved at runtime
├── logs/               ← Log files
└── node_modules/       ← Native packages only (firebase-admin, gRPC)
```

> ⚠️ **Never share `config.env`** — it contains passwords and private keys.

---

### Step 1 — Copy `production/` to your server

#### Windows → Windows
```cmd
robocopy production\ C:\myapp\ /E
```

#### Windows → Linux (via SCP)
```bash
scp -r production/ user@your-server-ip:/opt/myapp/
```

#### Or use any FTP/SFTP client (FileZilla, WinSCP, etc.)
Just copy the entire `production/` folder to the server.

---

### Step 2 — Edit `config.env` on the server

This is the most important step.  
The file must have real values — **not** placeholders.

Open `config.env` with any text editor:

```
PORT=8000
NODE_ENV=production
MONGODB_URI=mongodb+srv://yourUser:yourPassword@cluster.mongodb.net/dbName
JWT_SECRET=replace_this_with_a_long_random_string
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your@email.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

> ✅ Make sure every variable has a real value.  
> ✅ `MONGODB_URI` must point to a reachable database from the server.  
> ✅ `NODE_ENV` must be `production`.

---

### Step 3 — Run on Windows

**Option A — Double-click** *(not recommended — no logs visible)*

Just double-click `server.exe`. The server starts but if it crashes, you won't see why.

**Option B — Run from terminal** *(recommended)*

```cmd
cd C:\myapp
server.exe
```

You will see logs in the terminal. Keep the terminal open — closing it stops the server.

**Option C — Run as a Windows Service** *(best for production)*

Download [NSSM](https://nssm.cc/download) then:

```cmd
nssm install MyApp "C:\myapp\server.exe"
nssm set MyApp AppDirectory "C:\myapp"
nssm start MyApp
```

Now the server:
- Starts automatically on Windows boot
- Restarts if it crashes
- Runs in the background

To stop it:
```cmd
nssm stop MyApp
```

---

### Step 4 — Run on Linux

**First, make the file executable:**
```bash
chmod +x /opt/myapp/server
```

**Option A — Run manually** *(testing only)*
```bash
cd /opt/myapp
./server
```

**Option B — Run as a systemd service** *(best for production)*

Create a service file:
```bash
sudo nano /etc/systemd/system/myapp.service
```

Paste this:
```ini
[Unit]
Description=My Node.js App
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/myapp
ExecStart=/opt/myapp/server
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable myapp
sudo systemctl start myapp
```

Check logs:
```bash
sudo journalctl -u myapp -f
```

---

### Step 5 — Verify it is running

```bash
# Check the process is alive
curl http://localhost:8000/api/v1/users

# Or just check the port
netstat -an | grep 8000
```

---

### How to update (redeploy)

1. Make your code changes
2. On your dev machine: `npm run build:windows` or `npm run build:linux`
3. Copy the new `server.exe` or `server` to the production folder
4. Restart the service:
   - **Windows:** `nssm restart MyApp`
   - **Linux:** `sudo systemctl restart myapp`

> ⚠️ You do NOT need to copy `node_modules/` again unless you added/upgraded `firebase-admin` or other native packages.

---

### Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| Window closes immediately | `config.env` missing or `MONGODB_URI` empty | Check `config.env` is in the same folder as `server.exe` |
| `Cannot find module 'firebase-admin'` | `node_modules/` not copied | Copy the whole `production/` folder including `node_modules/` |
| Server starts but DB not connected | Wrong `MONGODB_URI` | Check the connection string — test it from MongoDB Compass |
| Port already in use | Another process using the port | Change `PORT` in `config.env` |
| Permission denied (Linux) | File not executable | Run `chmod +x server` |

---
---

## العربي

---

### ما الذي يوجد داخل مجلد `production/` ؟

بعد تشغيل `npm run build`، تحصل على هذا المجلد:

```
production/
├── server.exe          ← ملف تنفيذي لـ Windows
├── server              ← ملف تنفيذي لـ Linux (بعد npm run build:linux)
├── config.env          ← متغيرات البيئة (كلمات مرور، رابط قاعدة البيانات، الخ)
├── uploads/            ← مكان حفظ الملفات المرفوعة أثناء التشغيل
├── logs/               ← ملفات السجلات
└── node_modules/       ← حزم native فقط (firebase-admin، gRPC)
```

> ⚠️ **لا تشارك ملف `config.env` أبداً** — يحتوي كلمات مرور ومفاتيح خاصة.

---

### الخطوة 1 — انسخ مجلد `production/` إلى السيرفر

#### Windows إلى Windows
```cmd
robocopy production\ C:\myapp\ /E
```

#### Windows إلى Linux (عبر SCP)
```bash
scp -r production/ user@ip-السيرفر:/opt/myapp/
```

#### أو استخدم أي برنامج FTP/SFTP (FileZilla، WinSCP، الخ)
فقط انسخ المجلد كاملاً `production/` إلى السيرفر.

---

### الخطوة 2 — عدّل ملف `config.env` على السيرفر

هذه أهم خطوة.  
الملف يجب أن يحتوي قيماً حقيقية — **ليس** نصوصاً وهمية.

افتح `config.env` بأي محرر نصي:

```
PORT=8000
NODE_ENV=production
MONGODB_URI=mongodb+srv://yourUser:yourPassword@cluster.mongodb.net/dbName
JWT_SECRET=ضع_هنا_نصاً_عشوائياً_طويلاً
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your@email.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

> ✅ تأكد أن كل متغير له قيمة حقيقية.  
> ✅ `MONGODB_URI` يجب أن يكون قاعدة بيانات يمكن الوصول إليها من السيرفر.  
> ✅ `NODE_ENV` يجب أن تكون قيمتها `production`.

---

### الخطوة 3 — التشغيل على Windows

**الخيار أ — نقر مزدوج** *(غير مُوصى به — لا ترى السجلات)*

انقر مزدوجاً على `server.exe`. يبدأ السيرفر، لكن إذا تعطّل لن تعرف لماذا.

**الخيار ب — التشغيل من Terminal** *(مُوصى به)*

```cmd
cd C:\myapp
server.exe
```

ستظهر السجلات في الـ terminal. اتركه مفتوحاً — إغلاقه يوقف السيرفر.

**الخيار ج — تشغيله كـ Windows Service** *(الأفضل للإنتاج)*

حمّل [NSSM](https://nssm.cc/download) ثم نفّذ:

```cmd
nssm install MyApp "C:\myapp\server.exe"
nssm set MyApp AppDirectory "C:\myapp"
nssm start MyApp
```

الآن السيرفر:
- يبدأ تلقائياً عند تشغيل Windows
- يُعيد التشغيل تلقائياً إذا تعطّل
- يعمل في الخلفية

لإيقافه:
```cmd
nssm stop MyApp
```

---

### الخطوة 4 — التشغيل على Linux

**أولاً، اجعل الملف قابلاً للتنفيذ:**
```bash
chmod +x /opt/myapp/server
```

**الخيار أ — تشغيل يدوي** *(للاختبار فقط)*
```bash
cd /opt/myapp
./server
```

**الخيار ب — تشغيله كـ systemd service** *(الأفضل للإنتاج)*

أنشئ ملف الخدمة:
```bash
sudo nano /etc/systemd/system/myapp.service
```

الصق هذا:
```ini
[Unit]
Description=My Node.js App
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/myapp
ExecStart=/opt/myapp/server
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

فعّل وشغّل:
```bash
sudo systemctl daemon-reload
sudo systemctl enable myapp
sudo systemctl start myapp
```

تابع السجلات:
```bash
sudo journalctl -u myapp -f
```

---

### الخطوة 5 — تأكد أنه يعمل

```bash
# اختبر الـ API
curl http://localhost:8000/api/v1/users

# أو تحقق من البورت
netstat -an | grep 8000
```

---

### كيف تحدّث التطبيق (إعادة النشر)

1. عدّل الكود في جهازك
2. شغّل البناء: `npm run build:windows` أو `npm run build:linux`
3. انسخ `server.exe` أو `server` الجديد إلى مجلد الإنتاج
4. أعد تشغيل الخدمة:
   - **Windows:** `nssm restart MyApp`
   - **Linux:** `sudo systemctl restart myapp`

> ⚠️ لا تحتاج إلى نسخ `node_modules/` مجدداً إلا إذا أضفت أو حدّثت `firebase-admin` أو حزم native أخرى.

---

### حل المشكلات

| المشكلة | السبب | الحل |
|---|---|---|
| النافذة تُغلق فوراً | `config.env` مفقود أو `MONGODB_URI` فارغ | تأكد أن `config.env` في نفس مجلد `server.exe` |
| `Cannot find module 'firebase-admin'` | `node_modules/` لم يُنسخ | انسخ مجلد `production/` كاملاً بما فيه `node_modules/` |
| يبدأ السيرفر لكن DB لا تتصل | `MONGODB_URI` خاطئ | تحقق من الرابط — اختبره من MongoDB Compass |
| البورت مُستخدم بالفعل | عملية أخرى تستخدمه | غيّر `PORT` في `config.env` |
| Permission denied (Linux) | الملف غير قابل للتنفيذ | شغّل `chmod +x server` |
