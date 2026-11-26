// ── Environment loading ────────────────────────────────────────────────────
// Must be the very first thing that runs so every subsequently-required module
// can read process.env.* at module scope.
//
// Path strategy (in priority order):
//   1. __dirname — available when running as a plain Node.js script
//   2. path.dirname(process.execPath) — SEA binary: __dirname is undefined
//      inside the embedded script, but process.execPath is the binary itself
//      and config.env lives next to it in the production/ directory.
//
// This makes env loading cwd-independent: PM2, systemd, Docker, SEA, and
// direct invocation from any working directory all resolve the same file.
const path = require("path");
const dotenv = require("dotenv");

const _configDir =
  typeof __dirname !== "undefined"
    ? __dirname                          // plain node server.js
    : path.dirname(process.execPath);   // SEA binary

dotenv.config({ path: path.join(_configDir, "config.env") });


const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const socketManager = require("./infrastructure/realtime/socketManager");
const { authenticateSocket } = require("./infrastructure/realtime/socketAuth");
const SocketGateway = require("./infrastructure/realtime/socketGateway");
const {
  createEventDispatcher,
  setEventDispatcher,
} = require("./core/events/eventDispatcher");

const morgan = require("morgan");
const {
  initializeDatabases,
  closeDatabases,
} = require("./infrastructure/database/database.manager");
// ensure related models are loaded
// Canvas Models
require("./features/canvas/models/WorkspaceModel");
require("./features/canvas/models/CanvasPageModel");
require("./features/canvas/models/CanvasBlockModel");
require("./features/canvas/models/CanvasBlockMetadataModel");
require("./features/canvas/models/CanvasConnectionModel");
require("./features/canvas/models/CanvasCommentModel");
require("./features/canvas/models/CanvasActivityModel");
require("./features/canvas/models/CanvasViewModel");
// Time Management Sharing Models
require("./features/time_management_sharing/timeManagementShareModel");
require("./features/time_management_sharing/timeManagementUsageModel");
require("./features/time_management_sharing/timeManagementSyncBatchModel");
require("./features/time_management_sharing/timeManagementShareDeliveryModel");
require("./features/time_management_sharing/timeManagementShareLinkModel");
require("./features/time_management_sharing/timeManagementDeviceUsageModel");
require("./features/time_management_sharing/timeManagementDeviceSyncBatchModel");
// Gmail Models
require("./features/gmail/gmailAccountModel");
require("./features/gmail/gmailMessageModel");
require("./features/gmail/gmailThreadModel");
require("./features/gmail/gmailLabelModel");
require("./features/gmail/gmailDraftModel");
require("./features/gmail/gmailOperationLogModel");
require("./features/gmail/gmailPushNotificationModel");
const {
  prepareTimeManagementCollections,
} = require("./features/time_management_sharing/timeManagementCollections");
const userRoute = require("./features/users/userRoute");
const authRoute = require("./features/auth/authRoute");
const tasksManagementRoute = require("./features/tasks_management/tasksManagementRoute");
const filesTelegramRoute = require("./features/files/files_telegram/filesTelegramRoute");
const filesRoute = require("./features/files/fileRoute");
const canvasRoute = require("./features/canvas");
const companyRoute = require("./features/companies/companyRoute");
const invitationRoute = require("./features/invitations/invitationRoute");
const notificationRoute = require("./features/notifications/notificationRoutes");
const firebaseService = require("./features/notifications/firebaseService");
const whatsappRoute = require("./features/whatsapp/whatsapp.routes");
const attendanceRoute = require("./features/attendance/attendanceRoute");
const myDayRoute = require("./features/my_day/myDayRoute");
const timeManagementSharingRoute = require("./features/time_management_sharing/timeManagementSharingRoute");
const timeManagementShareScheduler = require("./features/time_management_sharing/timeManagementShareScheduler");
const timeManagementPublicRoute = require("./features/time_management_sharing/timeManagementPublicRoute");
const timeManagementUsageRoute = require("./features/time_management_sharing/timeManagementDeviceUsageRoute");
// Device Control: the console/employee API, and the agent API the Windows
// service talks to with its own device token.
const deviceControlRoute = require("./features/device_control/deviceControlRoute");
const deviceAgentRoute = require("./features/device_control/deviceAgentRoute");
// Gmail: the user API, the Pub/Sub push endpoint, and the worker that keeps
// mailboxes synced whether or not a client is connected.
const gmailRoute = require("./features/gmail/gmailRoute");
const gmailPushRoute = require("./features/gmail/gmailPushRoute");
const gmailScheduler = require("./features/gmail/gmailScheduler");

const ApiError = require("./utils/apiError");
const globalError = require("./middlewares/errorMiddleware");



// Initialize Firebase Admin SDK
firebaseService.initializeFirebase();

//express app initialization
const app = express();
// Middleware for logging in development mode
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
  console.log(`Morgan enabled in ${process.env.NODE_ENV} mode`);
}


// Sample route
app.use(express.json());

//mount routers

app.use("/api/v1/users", userRoute);
app.use("/api/v1/auth", authRoute);
app.use("/api/v1/companies", companyRoute);
app.use("/api/v1/invitations", invitationRoute);
// Tasks Management Central Route
app.use("/api/v1/tasks-management", tasksManagementRoute);

app.use("/api/v1/files-v2", filesTelegramRoute);
app.use("/api/v1/files", filesRoute);
app.use("/api/v1/canvas", canvasRoute);
app.use("/api/v1/notifications", notificationRoute);
app.use("/api/v1/whatsapp", whatsappRoute);
app.use("/api/v1/attendance", attendanceRoute);
app.use("/api/v1/my-day", myDayRoute);
app.use("/api/v1/time-management-shares", timeManagementSharingRoute);
// Device usage synchronization and cross-device aggregated reporting.
app.use("/api/v1/time-management-usage", timeManagementUsageRoute);
// Public, token-authorized read-only reports (no bearer token: the link IS
// the credential, resolved server-side).
app.use("/api/v1/public/time-reports", timeManagementPublicRoute);

// Device Control. The agent routes are mounted separately because they
// authenticate a device, not a user, and must never sit behind the user
// token middleware.
app.use("/api/v1/device-control", deviceControlRoute);
app.use("/api/v1/device-agent", deviceAgentRoute);

// Gmail. The push endpoint is mounted separately because it authenticates a
// Google service account rather than a user, and must never sit behind the
// user token middleware.
app.use("/api/v1/gmail", gmailRoute);
app.use("/api/v1/gmail-push", gmailPushRoute);

app.use((req, res, next) =>
  next(new ApiError(`Can't find this route: ${req.originalUrl}`, 400)),
);

//gloal error handling middleware
app.use(globalError);

const PORT = process.env.PORT || 8000;
const httpServer = http.createServer(app);

// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

io.use(authenticateSocket);

io.on("connection", (socket) => {
  socketManager.addSocket(socket);

  socket.on("disconnect", () => {
    socketManager.removeSocket(socket.id);
  });
});

const socketGateway = new SocketGateway(io, socketManager);
global.socketGateway = socketGateway;

// The event dispatcher wraps the same gateway and is what features publish
// through: it stamps each event with an id, a type, an action, a version and
// a timestamp, which is the envelope the Flutter clients parse. Until this
// call it is the no-op dispatcher created in core/events/eventDispatcher, so
// anything published before now is silently dropped.
setEventDispatcher(createEventDispatcher(socketGateway));

let server = null;

// Databases first, in a fixed order, then serve: no request is handled and no
// scheduled delivery runs before the connections they depend on are opened.
// Atlas is fatal; an unavailable local MongoDB leaves the rest of the API
// serving normally while Time Management answers 503 (see database.manager).
const start = async () => {
  await initializeDatabases();

  // Create the Time Management collections and indexes before the first
  // request, so a transactional sync never has to create one (MongoDB cannot,
  // inside a transaction). Also re-runs if local MongoDB connects later.
  prepareTimeManagementCollections();

  server = httpServer.listen(PORT, () => {
    console.log(`Server is running on
     http://localhost:${PORT}`);
  });

  // Deliver automatic Share Time configurations on their saved schedule.
  timeManagementShareScheduler.start();

  // Keep connected Gmail mailboxes in step with Gmail: applies what push
  // notifications queued, renews the watches Google expires every seven
  // days, and sweeps anything a crashed worker left claimed. This is what
  // makes mail arrive while no client is open.
  gmailScheduler.start();
};

start().catch((err) => {
  console.error(`Startup aborted: ${err.message}`);
  process.exit(1);
});

// ── Graceful shutdown ──────────────────────────────────────────────────────
// Stop the scheduler, stop accepting requests, then close both database
// connections, so neither is left with work in flight.
let shuttingDown = false;

const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down......`);

  timeManagementShareScheduler.stop();
  gmailScheduler.stop();

  if (server) {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }

  await closeDatabases();
  process.exit(0);
};

["SIGINT", "SIGTERM"].forEach((signal) => {
  process.on(signal, () => {
    shutdown(signal);
  });
});

// Handle unhandled promise rejections outside of express routes
process.on("un", (err) => {
  console.log(`Unhandled Rejection: ${err.name} - ${err.message}`);
  if (!server) process.exit(1);
  server.close(() => {
    console.log(
      "Shutting down server...... due to unhandled promise rejection",
    );
    process.exit(1);
  });
});

//flyctl lanuch
//flyctl deploy

//eslint-config-airbnb,js
//0f61fb9d4410f86b5acd867984ad7adb
//npm i -D eslint eslint-config-airbnb eslint-config-prettier eslint-plugin-import eslint-plugin-jsx-a11y eslint-plugin-node eslint-plugin-prettier eslint-plugin-react prettier
//.eslintrc.json
/*
{
    "extends": [
        "airbnb",
        "prettier",
        "plugin:node/recommended"
    ],
    "plugins": [
        "prettier"
    ],
    "rules": {
        // "prettier/prettier":"error",
        "spaced-comment": "off",
        "no-console": "off",
        "consistent-return": "off",
        "func-names": "off",
        "object-shorthand": "off",
        "no-process-exit": "off",
        "no-param-reassign": "off",
        "no-underscore-dangle": "off",
        "class-methods-use-this": "off",
        "no-undef": "error",
        "prefer-destructuring": [
            "error",
            {
                "object": true,
                "array": false
            }
        ],
        "no-unused-vars": [
            "warn",
            {
                "argsIgnorePattern": "req|res|next|val"
            }
        ]
    }
}
    */
