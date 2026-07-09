const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      required: true,
      enum: ["guest", "personal", "business"],
    },
    status: {
      type: String,
      default: "active",
      enum: ["active", "inactive", "blocked", "pending"],
    },
    regiCode: {
      type: String,
      default: null,
    },
    deviceToken: {
      type: String,
      default: null,
    },
    isMale: {
      type: Boolean,
      default: true,
    },
    birthday: {
      type: Date,
      required: true,
    },
    address: {
      type: String,
      default: null,
    },
    token: {
      type: String,
      default: null,
    },
    refreshToken: {
      type: String,
      default: null,
    },
    role: {
      type: String,
      required: true,
      enum: [
        "master",
        "admin",
        "manager",
        "supervisor",
        "departmentHead",
        "senior",
        "midLevel",
        "junior",
        "trainer",
      ],
    },
    employeeType: {
      type: String,
      enum: [
        "internalEmployee",
        "remotelyPartTime",
        "remotelyFullTime",
        "freelancer",
        "visitor",
      ],
      default: null,
    },
    notionalId: {
      type: String,
      default: null,
    },
    relation: {
      type: String,
      required: true,
    },
    jobs: {
      type: [String],
      enum: [
        "owner",
        "projectManager",
        "programmer",
        "designer",
        "backend",
        "callCenter",
        "accountant",
        "appraiser",
        "officeBoy",
        "seller",
        "marketing",
      ],
      default: [],
    },
    rate: {
      type: Number,
      default: 0,
    },
    bio: {
      type: String,
      default: null,
    },
    photo: {
      type: String,
      default: null,
    },
    files: {
      type: [String],
      default: [],
    },
    access: {
      type: [String],
      default: [],
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
    },
    resetToken: {
      type: String,
      default: null,
    },
    resetTokenExpires: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
