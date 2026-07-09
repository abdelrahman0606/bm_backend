const { v4: uuidv4 } = require("uuid");
const CanvasPageModel = require("../models/CanvasPageModel");
const CanvasBlockModel = require("../models/CanvasBlockModel");
const CanvasActivityModel = require("../models/CanvasActivityModel");
const ApiError = require("../../../utils/apiError");

class CanvasPageService {
  // Create a new page
  static async createPage(data, userId) {
    try {
      const page = new CanvasPageModel({
        ...data,
        createdBy: userId,
        collaborators: [userId],
      });

      await page.save();

      // Log activity
      await CanvasActivityModel.create({
        workspaceId: data.workspaceId,
        projectId: data.projectId,
        pageId: page._id.toString(),
        userId: userId,
        action: "create",
        entityType: "page",
        title: `Created page "${data.title}"`,
      });

      return page;
    } catch (error) {
      throw new ApiError(500, `Failed to create page: ${error.message}`);
    }
  }

  // Get page by ID
  static async getPage(pageId) {
    try {
      const page = await CanvasPageModel.findById(pageId);
      if (!page) {
        throw new ApiError(404, "Page not found");
      }
      return page;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to fetch page: ${error.message}`);
    }
  }

  // Get pages for project
  static async getProjectPages(projectId, workspaceId) {
    try {
      const pages = await CanvasPageModel.find({
        projectId: projectId,
        workspaceId: workspaceId,
        isDeleted: false,
      }).sort({ sortOrder: 1, createdAt: -1 });

      return pages;
    } catch (error) {
      throw new ApiError(500, `Failed to fetch pages: ${error.message}`);
    }
  }

  // Update page
  static async updatePage(pageId, data, userId) {
    try {
      const page = await CanvasPageModel.findByIdAndUpdate(
        pageId,
        { ...data, updatedAt: new Date() },
        { new: true, runValidators: true }
      );

      if (!page) {
        throw new ApiError(404, "Page not found");
      }

      // Log activity
      await CanvasActivityModel.create({
        workspaceId: page.workspaceId,
        projectId: page.projectId,
        pageId: pageId,
        userId: userId,
        action: "update",
        entityType: "page",
        title: "Updated page",
        changes: {
          before: {},
          after: data,
        },
      });

      return page;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to update page: ${error.message}`);
    }
  }

  // Delete page
  static async deletePage(pageId, userId) {
    try {
      const page = await CanvasPageModel.findByIdAndUpdate(
        pageId,
        { isDeleted: true, updatedAt: new Date() },
        { new: true }
      );

      if (!page) {
        throw new ApiError(404, "Page not found");
      }

      // Also delete all blocks in this page
      await CanvasBlockModel.updateMany(
        { pageId: pageId },
        { isDeleted: true, updatedAt: new Date() }
      );

      // Log activity
      await CanvasActivityModel.create({
        workspaceId: page.workspaceId,
        projectId: page.projectId,
        pageId: pageId,
        userId: userId,
        action: "delete",
        entityType: "page",
        title: "Deleted page",
      });

      return page;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to delete page: ${error.message}`);
    }
  }

  // Archive page
  static async archivePage(pageId, userId) {
    try {
      const page = await CanvasPageModel.findByIdAndUpdate(
        pageId,
        { isArchived: true, updatedAt: new Date() },
        { new: true }
      );

      if (!page) {
        throw new ApiError(404, "Page not found");
      }

      // Log activity
      await CanvasActivityModel.create({
        workspaceId: page.workspaceId,
        projectId: page.projectId,
        pageId: pageId,
        userId: userId,
        action: "archive",
        entityType: "page",
        title: "Archived page",
      });

      return page;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to archive page: ${error.message}`);
    }
  }

  // Toggle favorite
  static async toggleFavorite(pageId, userId) {
    try {
      const page = await CanvasPageModel.findById(pageId);
      if (!page) {
        throw new ApiError(404, "Page not found");
      }

      page.isFavorite = !page.isFavorite;
      page.updatedAt = new Date();
      await page.save();

      return page;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to toggle favorite: ${error.message}`);
    }
  }

  // Reorder pages
  static async reorderPages(projectId, pageOrder) {
    try {
      const updates = pageOrder.map((item, index) =>
        CanvasPageModel.findByIdAndUpdate(
          item.pageId,
          { sortOrder: index, updatedAt: new Date() },
          { new: true }
        )
      );

      await Promise.all(updates);
      return true;
    } catch (error) {
      throw new ApiError(500, `Failed to reorder pages: ${error.message}`);
    }
  }

  // Add collaborator
  static async addCollaborator(pageId, userId) {
    try {
      const page = await CanvasPageModel.findByIdAndUpdate(
        pageId,
        { $addToSet: { collaborators: userId }, updatedAt: new Date() },
        { new: true }
      );

      if (!page) {
        throw new ApiError(404, "Page not found");
      }

      return page;
    } catch (error) {
      throw new ApiError(500, `Failed to add collaborator: ${error.message}`);
    }
  }

  // Remove collaborator
  static async removeCollaborator(pageId, userId) {
    try {
      const page = await CanvasPageModel.findByIdAndUpdate(
        pageId,
        { $pull: { collaborators: userId }, updatedAt: new Date() },
        { new: true }
      );

      if (!page) {
        throw new ApiError(404, "Page not found");
      }

      return page;
    } catch (error) {
      throw new ApiError(500, `Failed to remove collaborator: ${error.message}`);
    }
  }
}

module.exports = CanvasPageService;
