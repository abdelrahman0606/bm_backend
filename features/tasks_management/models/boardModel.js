const mongoose = require("mongoose");
const tasksDb = require("../tasksDatabase");


const BoardType = {
  SCRUM: "Scrum",
  KANBAN: "Kanban",
};

const BoardSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: Object.values(BoardType),
      required: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

BoardSchema.virtual("id").get(function () {
  return this._id.toHexString();
});

BoardSchema.set("versionKey", false);

BoardSchema.index({ projectId: 1 });

const BoardModel = tasksDb.model("TaskBoard", BoardSchema);
module.exports = BoardModel;
