const mongoose = require("mongoose");

const tasksDb = mongoose.createConnection(process.env.TASKS_MONGODB_URI);

tasksDb.on("connected", () => {
  console.log(`Connected to the tasks management database successfully`);
});

tasksDb.on("error", (err) => {
  console.error("Tasks management database connection error:", err);
});

module.exports = tasksDb;
