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

/**
 * A face registration request.
 *
 * `status` is deliberately absent: there is no field a client can send that
 * sets one. The server writes `pending` and nothing else, so approval cannot
 * be reached through this endpoint however the body is shaped.
 */
const validateFaceRegistrationRequest = [
  body("photo")
    .optional({ nullable: true })
    .isObject()
    .withMessage("photo must be an object"),
  body("modelVersion")
    .optional({ nullable: true })
    .isString()
    .withMessage("modelVersion must be a string"),
  body("companyId")
    .optional({ nullable: true })
    .isMongoId()
    .withMessage("companyId must be a valid id"),
  body("withNotify")
    .optional()
    .isBoolean()
    .withMessage("withNotify must be a boolean"),
  // Rejected rather than ignored, so a client that tries to set its own
  // status gets told plainly instead of silently succeeding.
  body("status")
    .not()
    .exists()
    .withMessage("status is decided by an approver and cannot be set here"),
];

/** An approver's decision. */
const validateFaceRegistrationDecision = [
  body("approve")
    .exists()
    .withMessage("approve is required")
    .isBoolean()
    .withMessage("approve must be a boolean"),
  body("reason")
    .optional({ nullable: true })
    .isString()
    .withMessage("reason must be a string")
    .isLength({ max: 500 })
    .withMessage("reason must be 500 characters or fewer"),
  body("withNotify")
    .optional()
    .isBoolean()
    .withMessage("withNotify must be a boolean"),
];

module.exports = {
  validateQrGeneration,
  validateCheckIn,
  validateFaceProfileRegistration,
  validateLocationRegistration,
  validateFaceRegistrationRequest,
  validateFaceRegistrationDecision,
};
