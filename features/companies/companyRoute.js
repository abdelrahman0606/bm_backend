const express = require("express");
const router = express.Router();
const companyService = require("./companyService");
const {
  validateCompanyCreate,
  validateCompanyUpdate,
} = require("./companyValidator");
const {
  validatorMiddleware,
} = require("../../middlewares/validatorMiddleware");
const { verifyAuthToken } = require("../../middlewares/authMiddleware");

// All routes require authentication
router.use(verifyAuthToken);

// Create a new company
router.post(
  "/",
  validateCompanyCreate,
  validatorMiddleware,
  async (req, res, next) => {
    try {
      const company = await companyService.createCompany(req.body, req.userId);
      res.status(201).json({
        success: true,
        data: company,
        message: "Company created successfully",
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get all companies
router.get("/", async (req, res, next) => {
  try {
    const result = await companyService.getCompanies(req.query, req.userId);
    res.status(200).json({
      success: true,
      data: result.companies,
      pagination: result.pagination,
      message: "Companies fetched successfully",
    });
  } catch (error) {
    next(error);
  }
});

// Get company by ID
router.get("/:id", async (req, res, next) => {
  try {
    const company = await companyService.getCompanyById(req.params.id, req.userId);
    res.status(200).json({
      success: true,
      data: company,
      message: "Company fetched successfully",
    });
  } catch (error) {
    next(error);
  }
});

// Update company
router.put(
  "/:id",
  validateCompanyUpdate,
  validatorMiddleware,
  async (req, res, next) => {
    try {
      const company = await companyService.updateCompany(
        req.params.id,
        req.body,
        req.userId
      );
      res.status(200).json({
        success: true,
        data: company,
        message: "Company updated successfully",
      });
    } catch (error) {
      next(error);
    }
  }
);

// Delete company
router.delete("/:id", async (req, res, next) => {
  try {
    await companyService.deleteCompany(req.params.id, req.userId);
    res.status(200).json({
      success: true,
      message: "Company deleted successfully",
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
