const express = require("express");
const jwt = require("jsonwebtoken");

const projectRoute = require("./projects/projectRoute");
const issueRoute = require("./issues/issueRoute");
const workspaceRoute = require("./workspaces/workspaceRoute");
const boardRoute = require("./boards/boardRoute");
const sprintRoute = require("./sprints/sprintRoute");
const statusRoute = require("./statuses/statusRoute");
const priorityRoute = require("./priorities/priorityRoute");
const labelRoute = require("./labels/labelRoute");
const timeLogRoute = require("./timelogs/timeLogRoute");
const versionRoute = require("./versions/versionRoute");
const componentRoute = require("./components/componentRoute");

const router = express.Router();

const verifyToken = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res.status(401).json({ success: false, message: "No token provided" });
    }
    
    const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";
    const decoded = jwt.verify(token, JWT_SECRET);
    
    req.user = { id: decoded.id, ...decoded };
    req.userId = decoded.id;
    return next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
};

// Apply auth middleware to all tasks management routes
router.use(verifyToken);

router.use("/workspaces", workspaceRoute);
router.use("/projects", projectRoute);
router.use("/boards", boardRoute);
router.use("/sprints", sprintRoute);
router.use("/statuses", statusRoute);
router.use("/priorities", priorityRoute);
router.use("/labels", labelRoute);
router.use("/timelogs", timeLogRoute);
router.use("/versions", versionRoute);
router.use("/components", componentRoute);
router.use("/issues", issueRoute);
router.use("/tasks", issueRoute); // legacy support

module.exports = router;
