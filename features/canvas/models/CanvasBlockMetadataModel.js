const mongoose = require("mongoose");

const LinkMetadataSchema = new mongoose.Schema(
  {
    url: { type: String, trim: true },
    favicon: { type: String, trim: true, default: null },
    previewImage: { type: String, trim: true, default: null },
    description: { type: String, trim: true, default: "" },
    domain: { type: String, trim: true, default: null },
  },
  { _id: false },
);

const CodeMetadataSchema = new mongoose.Schema(
  {
    language: { type: String, trim: true, default: "javascript" },
    theme: { type: String, trim: true, default: "dark" },
    lineNumbers: { type: Boolean, default: true },
    highlightLines: { type: [Number], default: [] },
  },
  { _id: false },
);

const FileMetadataSchema = new mongoose.Schema(
  {
    fileId: { type: String, trim: true },
    fileName: { type: String, trim: true },
    fileSize: { type: Number, default: 0 },
    fileType: { type: String, trim: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const ImageMetadataSchema = new mongoose.Schema(
  {
    imageUrl: { type: String, trim: true },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    alt: { type: String, trim: true, default: "" },
    caption: { type: String, trim: true, default: "" },
  },
  { _id: false },
);

const VideoMetadataSchema = new mongoose.Schema(
  {
    videoUrl: { type: String, trim: true },
    duration: { type: Number, default: 0 },
    thumbnail: { type: String, trim: true, default: null },
    provider: { type: String, trim: true, default: "youtube" },
  },
  { _id: false },
);

const ApiMetadataSchema = new mongoose.Schema(
  {
    method: {
      type: String,
      enum: ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"],
      default: "GET",
    },
    endpoint: { type: String, trim: true, default: "" },
    baseUrl: { type: String, trim: true, default: "" },
    requestBody: { type: String, trim: true, default: null },
    responseBody: { type: String, trim: true, default: null },
    headers: { type: Map, of: String, default: new Map() },
    parameters: { type: [String], default: [] },
  },
  { _id: false },
);

const DocumentationMetadataSchema = new mongoose.Schema(
  {
    format: { type: String, enum: ["markdown", "html", "plain"], default: "markdown" },
    outline: { type: [String], default: [] },
    sections: { type: Number, default: 0 },
  },
  { _id: false },
);

const ChecklistMetadataSchema = new mongoose.Schema(
  {
    items: [
      {
        id: { type: String, required: true },
        text: { type: String, required: true },
        isCompleted: { type: Boolean, default: false },
        completedAt: { type: Date, default: null },
      },
    ],
    completionPercentage: { type: Number, default: 0 },
  },
  { _id: false },
);

const TaskMetadataSchema = new mongoose.Schema(
  {
    taskId: { type: String, trim: true },
    taskTitle: { type: String, trim: true },
    status: { type: String, trim: true, default: "pending" },
    dueDate: { type: Date, default: null },
    assignedTo: { type: String, trim: true, default: null },
  },
  { _id: false },
);

const MeetingMetadataSchema = new mongoose.Schema(
  {
    meetingDate: { type: Date, default: null },
    attendees: { type: [String], default: [] },
    agenda: { type: String, trim: true, default: "" },
    actionItems: { type: [String], default: [] },
    recordingUrl: { type: String, trim: true, default: null },
  },
  { _id: false },
);

const JsonMetadataSchema = new mongoose.Schema(
  {
    schema: { type: String, trim: true, default: "" },
    isValid: { type: Boolean, default: true },
    errorMessage: { type: String, trim: true, default: "" },
  },
  { _id: false },
);

const CanvasBlockMetadataSchema = new mongoose.Schema(
  {
    blockId: { type: String, required: true, trim: true, unique: true },
    blockType: { type: String, required: true, trim: true },
    linkMetadata: { type: LinkMetadataSchema, default: null },
    codeMetadata: { type: CodeMetadataSchema, default: null },
    fileMetadata: { type: FileMetadataSchema, default: null },
    imageMetadata: { type: ImageMetadataSchema, default: null },
    videoMetadata: { type: VideoMetadataSchema, default: null },
    apiMetadata: { type: ApiMetadataSchema, default: null },
    documentationMetadata: { type: DocumentationMetadataSchema, default: null },
    checklistMetadata: { type: ChecklistMetadataSchema, default: null },
    taskMetadata: { type: TaskMetadataSchema, default: null },
    meetingMetadata: { type: MeetingMetadataSchema, default: null },
    jsonMetadata: { type: JsonMetadataSchema, default: null },
    customMetadata: { type: Map, of: mongoose.Schema.Types.Mixed, default: new Map() },
    createdAt: { type: Date, required: true, default: Date.now },
    updatedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

module.exports = mongoose.model("CanvasBlockMetadata", CanvasBlockMetadataSchema);
