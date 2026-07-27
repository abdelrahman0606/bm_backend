const mongoose = require("mongoose");

const invitationSchema = new mongoose.Schema(
  {
    companyId: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      required: true,
      default: "pending",
    },
    regiCode: {
      type: String,
      required: true,
      unique: true,
    },
    role: {
      type: String,
      required: true,
    },
    employeeType: {
      type: String,
      required: true,
      enum: [
        "internalEmployee",
        "remotelyPartTime",
        "remotelyFullTime",
        "freelancer",
        "visitor",
      ],
    },
    jobs: {
      type: [String],
      default: [],
    },
    permissions: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    expiredAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
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
  }
);

module.exports = mongoose.model("Invitation", invitationSchema);
