const express = require("express");
const { validationResult } = require("express-validator");
const BoardController = require("./boardController");
const {
  createBoardValidator,
  updateBoardValidator,
  getBoardValidator,
  deleteBoardValidator,
  listBoardValidator,
} = require("./boardValidator");

const router = express.Router();

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

router.post("/", createBoardValidator, handleValidationErrors, BoardController.createBoard);
router.get("/", listBoardValidator, handleValidationErrors, BoardController.getBoards);
router.get("/:boardId", getBoardValidator, handleValidationErrors, BoardController.getBoard);
router.put("/:boardId", updateBoardValidator, handleValidationErrors, BoardController.updateBoard);
router.delete("/:boardId", deleteBoardValidator, handleValidationErrors, BoardController.deleteBoard);

module.exports = router;
