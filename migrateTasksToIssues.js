const mongoose = require("mongoose");
const dotenv = require("dotenv");
const { v4: uuidv4 } = require("uuid");

dotenv.config({ path: "./config.env" });
const dbConnection = require("./config/database");

const TaskModel = require("./features/tasks_management/tasks/taskModel"); // We'll assume the schema is loosely defined or just use db.collection
const IssueModel = require("./features/tasks_management/issues/issueModel");
const CommentModel = require("./features/tasks_management/models/commentModel");
const ChecklistItemModel = require("./features/tasks_management/models/checklistItemModel");
const ActivityModel = require("./features/tasks_management/models/activityModel");
const WatcherModel = require("./features/tasks_management/models/watcherModel");
const AttachmentModel = require("./features/tasks_management/models/attachmentModel");

const migrate = async () => {
  await dbConnection();
  console.log("Connected to DB, starting migration...");

  try {
    const db = mongoose.connection.db;

    // Get all legacy tasks
    const tasks = await db.collection("tasks").find({}).toArray();
    console.log(`Found ${tasks.length} tasks to migrate.`);

    for (const task of tasks) {
      // Create an Issue document
      const issueData = {
        _id: task._id,
        projectId: task.projectId,
        sprintId: task.sprintId || null,
        // we leave statusId and priorityId empty for now if there is no mapping yet.
        assigneeId: task.assignedTo && task.assignedTo.length > 0 ? task.assignedTo[0] : null,
        reporterId: task.createdBy,
        title: task.title,
        description: task.description,
        storyPoints: task.storyPoints || null,
        dueDate: task.dueDate || null,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        deletedAt: task.isDeleted ? (task.deletedAt || new Date()) : null,
      };

      await db.collection("issues").updateOne(
        { _id: task._id },
        { $set: issueData },
        { upsert: true }
      );

      // Migrate comments
      if (task.comments && task.comments.length > 0) {
        for (const comment of task.comments) {
          await CommentModel.updateOne(
            { _id: comment.id || uuidv4() },
            {
              $set: {
                issueId: task._id,
                userId: comment.userId,
                message: comment.message,
                createdAt: comment.createdAt,
              }
            },
            { upsert: true }
          );
        }
      }

      // Migrate checklist items
      if (task.checklist && task.checklist.length > 0) {
        for (let i = 0; i < task.checklist.length; i++) {
          const item = task.checklist[i];
          await ChecklistItemModel.updateOne(
            { _id: item.id || uuidv4() },
            {
              $set: {
                issueId: task._id,
                title: item.title,
                completed: item.isCompleted,
                order: i,
              }
            },
            { upsert: true }
          );
        }
      }

      // Migrate activities
      if (task.activities && task.activities.length > 0) {
        for (const activity of task.activities) {
          await ActivityModel.updateOne(
            { _id: activity.id || uuidv4() },
            {
              $set: {
                issueId: task._id,
                userId: activity.userId,
                action: activity.action || "Issue Updated",
                message: activity.message,
                createdAt: activity.createdAt,
              }
            },
            { upsert: true }
          );
        }
      }

      // Migrate watchers
      if (task.watchers && task.watchers.length > 0) {
        for (const watcherId of task.watchers) {
          await WatcherModel.updateOne(
            { issueId: task._id, userId: watcherId },
            {
              $set: {
                issueId: task._id,
                userId: watcherId,
              }
            },
            { upsert: true }
          );
        }
      }
    }

    console.log("Migration completed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    process.exit(0);
  }
};

migrate();
