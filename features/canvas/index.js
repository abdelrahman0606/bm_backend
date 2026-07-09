const express = require("express");

const workspaceRoute = require("./routes/workspaceRoute");
const pageRoute = require("./routes/pageRoute");
const blockRoute = require("./routes/blockRoute");
const connectionRoute = require("./routes/connectionRoute");
const commentRoute = require("./routes/commentRoute");
const activityRoute = require("./routes/activityRoute");

const router = express.Router();

// Mount all canvas routes
router.use("/workspace", workspaceRoute);
router.use("/page", pageRoute);
router.use("/block", blockRoute);
router.use("/connection", connectionRoute);
router.use("/comment", commentRoute);
router.use("/activity", activityRoute);

module.exports = router;
