const express = require("express");
const { body } = require("express-validator");

const router = express.Router();
const googleLoginService = require("./googleLoginService");
const {
  validatorMiddleware,
} = require("../../middlewares/validatorMiddleware");
const { PLATFORMS } = require("./googleAccountValidator");

/**
 * Google sign-in for the app, with the OAuth secret on the server.
 *
 * Deliberately **not** behind `verifyAuthToken`: this is how a user signs in,
 * so there is no session yet. It is mounted ahead of the authenticated
 * `/google` sub-router, which is why these paths reach this file.
 *
 * Neither endpoint issues a session. The second returns the Google id token,
 * which the client posts to `POST /auth/google` — the route that already owns
 * the register/login rules.
 */

const validateStartLogin = [
  body("platform")
    .optional()
    .isIn(PLATFORMS)
    .withMessage(`platform must be one of: ${PLATFORMS.join(", ")}`),
  body("redirectUri")
    .notEmpty()
    .withMessage("redirectUri is required")
    .isURL({ require_tld: false, protocols: ["http", "https"] })
    .withMessage("redirectUri must be a valid http(s) URL"),
  body("loginHint")
    .optional()
    .isEmail()
    .withMessage("loginHint must be an email address")
    .toLowerCase(),
];

const validateCompleteLogin = [
  body("state").notEmpty().withMessage("state is required").isString(),
  body("code").notEmpty().withMessage("code is required").isString(),
];

/**
 * POST /api/v1/auth/google/login/url
 * Body: { redirectUri, platform?, loginHint? }
 *
 * The client opens the returned `url` and keeps the `state`. On desktop,
 * `redirectUri` is the loopback address the app is listening on.
 */
router.post(
  "/url",
  validateStartLogin,
  validatorMiddleware,
  async (req, res, next) => {
    try {
      const result = await googleLoginService.startLogin({
        platform: req.body.platform || "web",
        redirectUri: req.body.redirectUri,
        loginHint: req.body.loginHint,
      });
      res.status(200).json({
        success: true,
        data: result,
        message: "Sign-in URL created",
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/v1/auth/google/login/exchange
 * Body: { state, code }
 *
 * Returns the verified Google identity, including the id token to post to
 * `POST /auth/google`. No session is created here.
 */
router.post(
  "/exchange",
  validateCompleteLogin,
  validatorMiddleware,
  async (req, res, next) => {
    try {
      const result = await googleLoginService.completeLogin({
        state: req.body.state,
        code: req.body.code,
      });
      res.status(200).json({
        success: true,
        data: result,
        message: "Google identity verified",
      });
    } catch (error) {
      next(error);
    }
  },
);

module.exports = router;
