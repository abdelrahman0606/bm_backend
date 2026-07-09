const { validationResult } = require("express-validator");

const validatorMiddleware = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  return next();
};

// Support both:
// const validatorMiddleware = require("...")
// const { validatorMiddleware } = require("...")
module.exports = validatorMiddleware;
module.exports.validatorMiddleware = validatorMiddleware;
