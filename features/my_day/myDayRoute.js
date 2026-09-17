const express = require("express");
const router = express.Router();
const myDayService = require("./myDayService");
const { validateGetMyDay } = require("./myDayValidator");
const { validatorMiddleware } = require("../../middlewares/validatorMiddleware");
const { verifyAuthToken } = require("../../middlewares/authMiddleware");

// All routes require authentication
router.use(verifyAuthToken);

// GET /api/v1/my-day
router.get(
  "/",
  validateGetMyDay,
  validatorMiddleware,
  async (req, res, next) => {
    try {
      const data = await myDayService.getMyDayData(req.userId, req.query);
      res.status(200).json({
        success: true,
        data,
        message: "My day data fetched successfully",
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
