const mongoose = require("mongoose");

const FileSourceType = {
  LOCAL: "local",
  TELEGRAM: "telegram",
  CLOUD: "cloud",
};

const fileReplicaSchema = new mongoose.Schema(
  {
    sourceType: {
      type: String,
      enum: Object.values(FileSourceType),
      required: true,
    },
    path: {
      type: String,
      required: true,
    },
    connectionInfo: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    lastVerified: {
      type: Date,
      required: true,
    },
  },
  { _id: false }
);

const fileSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true,
    },
    sha256: {
      type: String,
      required: true,
    },
    fileName: {
      type: String,
      required: true,
    },
    mimeType: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      default: null,
    },
    entityId: {
      type: String,
      default: null,
    },
    size: {
      type: Number,
      required: true,
    },
    replicas: {
      type: [fileReplicaSchema],
      required: true,
    },
    customMetadata: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // only createdAt is in the model
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: (doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
    collection: "files",
  }
);

const FileModel = mongoose.model("File", fileSchema);

module.exports = {
  FileModel,
  FileSourceType,
};
