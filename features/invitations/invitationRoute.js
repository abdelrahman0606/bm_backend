const express = require("express");
const router = express.Router();
const invitationController = require("./invitationController");
const {
  validateCreateInvitation,
  validateUpdateInvitation,
  validateRegiCode,
} = require("./invitationValidator");
const {
  validatorMiddleware,
} = require("../../middlewares/validatorMiddleware");
const { verifyAuthToken } = require("../../middlewares/authMiddleware");

// Validate registration code route (does not require auth usually since user is registering)
router.post(
  "/validate",
  validateRegiCode,
  validatorMiddleware,
  invitationController.validateRegiCode
);

// All CRUD routes require authentication
router.use(verifyAuthToken);

// Create a new invitation
router.post(
  "/",
  validateCreateInvitation,
  validatorMiddleware,
  invitationController.createInvitation
);

// Get all invitations
router.get("/", invitationController.getInvitations);

// Get invitation by ID
router.get("/:id", invitationController.getInvitationById);

// Update invitation
router.put(
  "/:id",
  validateUpdateInvitation,
  validatorMiddleware,
  invitationController.updateInvitation
);

// Delete invitation
router.delete("/:id", invitationController.deleteInvitation);

module.exports = router;
