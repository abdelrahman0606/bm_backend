const BoardService = require("./boardService");

class BoardController {
  static async createBoard(req, res, next) {
    try {
      const board = await BoardService.createBoard(req.body);
      res.status(201).json({
        success: true,
        message: "Board created successfully",
        data: board,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getBoards(req, res, next) {
    try {
      const result = await BoardService.getBoards(req.query);
      res.status(200).json({
        success: true,
        message: "Boards fetched successfully",
        data: result.boards,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getBoard(req, res, next) {
    try {
      const board = await BoardService.getBoardById(req.params.boardId);
      res.status(200).json({
        success: true,
        message: "Board fetched successfully",
        data: board,
      });
    } catch (error) {
      next(error);
    }
  }

  static async updateBoard(req, res, next) {
    try {
      const board = await BoardService.updateBoard(req.params.boardId, req.body);
      res.status(200).json({
        success: true,
        message: "Board updated successfully",
        data: board,
      });
    } catch (error) {
      next(error);
    }
  }

  static async deleteBoard(req, res, next) {
    try {
      const result = await BoardService.deleteBoard(req.params.boardId);
      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = BoardController;
