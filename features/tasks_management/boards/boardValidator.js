const { body, param, query } = require("express-validator");

const createBoardValidator = [
  body("projectId").isMongoId().withMessage("Invalid Project ID"),
  body("name")
    .notEmpty()
    .withMessage("Board name is required")
    .isString()
    .trim()
    .isLength({ min: 3, max: 100 }),
  body("type")
    .notEmpty()
    .withMessage("Board type is required")
    .isIn(["Scrum", "Kanban"])
    .withMessage("Type must be either Scrum or Kanban"),
];

const updateBoardValidator = [
  param("boardId").isMongoId().withMessage("Invalid Board ID"),
  body("name").optional().isString().trim().isLength({ min: 3, max: 100 }),
  body("type").optional().isIn(["Scrum", "Kanban"]),
];

const getBoardValidator = [
  param("boardId").isMongoId().withMessage("Invalid Board ID"),
];

const deleteBoardValidator = [
  param("boardId").isMongoId().withMessage("Invalid Board ID"),
];

const listBoardValidator = [
  query("projectId").isMongoId().withMessage("Project ID is required"),
  query("page").optional().isInt({ min: 0 }),
  query("limit").optional().isInt({ min: 1, max: 100 }),
  query("search").optional().isString().trim(),
];

module.exports = {
  createBoardValidator,
  updateBoardValidator,
  getBoardValidator,
  deleteBoardValidator,
  listBoardValidator,
};
