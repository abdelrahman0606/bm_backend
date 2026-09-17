const { body } = require("express-validator");

const validateQrGeneration = [
  // Any specific validation for QR generation if needed
  // e.g. locationId
];

const validateCheckIn = [
  body("type")
    .notEmpty()
    .withMessage("type is required")
    .isIn(["online", "offline"])
    .withMessage("type must be either 'online' or 'offline'"),

  // Offline validation
  body("qrToken")
    .if(body("type").equals("offline"))
    .notEmpty()
    .withMessage("qrToken is required for offline attendance")
    .isString(),

  // Online validation
  body("faceEmbedding")
    .if(body("type").equals("online"))
    .notEmpty()
    .withMessage("faceEmbedding is required for online attendance")
    .isArray()
    .withMessage("faceEmbedding must be an array of numbers"),

  body("latitude")
    .if(body("type").equals("online"))
    .notEmpty()
    .withMessage("latitude is required for online attendance")
    .isNumeric(),

  body("longitude")
    .if(body("type").equals("online"))
    .notEmpty()
    .withMessage("longitude is required for online attendance")
    .isNumeric(),

  body("companyId")
    .optional({ nullable: true })
    .isString()
    .withMessage("companyId must be a string"),
];

const validateFaceProfileRegistration = [
  body("similarity")
    .optional()
    .isNumeric()
    .withMessage("similarity must be a number"),
  body("photo")
    .optional()
    .isObject()
    .withMessage("photo must be an object"),
  body("companyId")
    .optional({ nullable: true })
    .isString()
    .withMessage("companyId must be a string"),
];

const validateLocationRegistration = [
  body("latitude")
    .notEmpty()
    .withMessage("latitude is required")
    .isNumeric()
    .withMessage("latitude must be a number"),
  body("longitude")
    .notEmpty()
    .withMessage("longitude is required")
    .isNumeric()
    .withMessage("longitude must be a number"),
  body("address")
    .optional()
    .isString()
    .withMessage("address must be a string"),
  body("companyId")
    .optional({ nullable: true })
    .isString()
    .withMessage("companyId must be a string"),
];

module.exports = {
  validateQrGeneration,
  validateCheckIn,
  validateFaceProfileRegistration,
  validateLocationRegistration,
};
