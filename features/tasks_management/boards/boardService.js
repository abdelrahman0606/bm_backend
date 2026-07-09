const BoardModel = require("../models/boardModel");
const ApiError = require("../../../utils/apiError");

class BoardService {
  static async createBoard(data) {
    try {
      const board = await BoardModel.create(data);
      return board;
    } catch (error) {
      throw new ApiError(500, `Failed to create board: ${error.message}`);
    }
  }

  static async getBoards(filters) {
    try {
      const { projectId, page = 0, limit = 20, search } = filters;
      const query = { projectId };

      if (search) {
        query.name = { $regex: search, $options: "i" };
      }

      const skip = page * limit;
      const boards = await BoardModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const total = await BoardModel.countDocuments(query);

      return {
        boards,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      throw new ApiError(500, `Failed to fetch boards: ${error.message}`);
    }
  }

  static async getBoardById(boardId) {
    try {
      const board = await BoardModel.findById(boardId);
      if (!board) {
        throw new ApiError(404, "Board not found");
      }
      return board;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to fetch board: ${error.message}`);
    }
  }

  static async updateBoard(boardId, updateData) {
    try {
      const board = await BoardModel.findByIdAndUpdate(boardId, updateData, { new: true, runValidators: true });
      if (!board) {
        throw new ApiError(404, "Board not found");
      }
      return board;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to update board: ${error.message}`);
    }
  }

  static async deleteBoard(boardId) {
    try {
      const board = await BoardModel.findByIdAndDelete(boardId);
      if (!board) {
        throw new ApiError(404, "Board not found");
      }
      return { message: "Board deleted successfully" };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to delete board: ${error.message}`);
    }
  }
}

module.exports = BoardService;
