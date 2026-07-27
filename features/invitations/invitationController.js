const invitationService = require("./invitationService");

exports.createInvitation = async (req, res, next) => {
  try {
    const invitation = await invitationService.createInvitation(req.body);
    res.status(201).json({
      success: true,
      data: invitation,
      message: "Invitation created successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.getInvitations = async (req, res, next) => {
  try {
    const result = await invitationService.getInvitations(req.query);
    res.status(200).json({
      success: true,
      data: result.invitations,
      pagination: result.pagination,
      message: "Invitations fetched successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.getInvitationById = async (req, res, next) => {
  try {
    const invitation = await invitationService.getInvitationById(req.params.id);
    res.status(200).json({
      success: true,
      data: invitation,
      message: "Invitation fetched successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.updateInvitation = async (req, res, next) => {
  try {
    const invitation = await invitationService.updateInvitation(
      req.params.id,
      req.body
    );
    res.status(200).json({
      success: true,
      data: invitation,
      message: "Invitation updated successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.deleteInvitation = async (req, res, next) => {
  try {
    await invitationService.deleteInvitation(req.params.id);
    res.status(200).json({
      success: true,
      message: "Invitation deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.validateRegiCode = async (req, res, next) => {
  try {
    const invitation = await invitationService.validateRegiCode(
      req.body.registrationCode
    );
    res.status(200).json({
      success: true,
      data: invitation,
      message: "Invitation is valid",
    });
  } catch (error) {
    next(error);
  }
};
