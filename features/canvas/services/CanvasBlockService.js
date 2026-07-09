const { v4: uuidv4 } = require("uuid");
const CanvasBlockModel = require("../models/CanvasBlockModel");
const CanvasBlockMetadataModel = require("../models/CanvasBlockMetadataModel");
const CanvasPageModel = require("../models/CanvasPageModel");
const CanvasActivityModel = require("../models/CanvasActivityModel");
const contentDetection = require("../utils/contentDetection");
const blockConversion = require("../utils/blockConversion");
const ApiError = require("../../../utils/apiError");

class CanvasBlockService {
  // Create a new block
  static async createBlock(data, userId) {
    try {
      // Auto-detect block type if not provided
      const blockTypeData = !data.type
        ? contentDetection.detectBlockType(data.content)
        : { type: data.type, metadata: null };

      const block = new CanvasBlockModel({
        ...data,
        type: blockTypeData.type,
        createdBy: userId,
        lastEditedBy: userId,
        collaborators: [userId],
      });

      await block.save();

      // Save metadata if detected
      if (blockTypeData.metadata) {
        await CanvasBlockMetadataModel.create({
          blockId: block._id.toString(),
          blockType: blockTypeData.type,
          ...blockTypeData.metadata,
        });
      }

      // Update page blocks count
      await CanvasPageModel.findByIdAndUpdate(
        data.pageId,
        { $inc: { blocksCount: 1 } }
      );

      // Log activity
      await CanvasActivityModel.create({
        workspaceId: data.workspaceId,
        projectId: data.projectId,
        pageId: data.pageId,
        blockId: block._id.toString(),
        userId: userId,
        action: "create",
        entityType: "block",
        title: `Created ${blockTypeData.type} block`,
      });

      return {
        block,
        metadata: blockTypeData.metadata,
      };
    } catch (error) {
      throw new ApiError(500, `Failed to create block: ${error.message}`);
    }
  }

  // Get block by ID
  static async getBlock(blockId) {
    try {
      const block = await CanvasBlockModel.findById(blockId);
      if (!block) {
        throw new ApiError(404, "Block not found");
      }

      const metadata = await CanvasBlockMetadataModel.findOne({
        blockId: blockId,
      });

      return { block, metadata };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to fetch block: ${error.message}`);
    }
  }

  // Get blocks for page
  static async getPageBlocks(pageId, filters = {}) {
    try {
      const {
        type,
        search,
        page = 0,
        limit = 50,
      } = filters;

      const query = {
        pageId: pageId,
        isDeleted: false,
      };

      if (type) query.type = type;
      if (search) {
        query.$or = [
          { title: { $regex: search, $options: "i" } },
          { content: { $regex: search, $options: "i" } },
          { tags: { $in: [search] } },
        ];
      }

      const totalBlocks = await CanvasBlockModel.countDocuments(query);
      const blocks = await CanvasBlockModel.find(query)
        .sort({ zIndex: -1, createdAt: -1 })
        .skip(page * limit)
        .limit(limit);

      // Fetch metadata for all blocks
      const blockIds = blocks.map((b) => b._id.toString());
      const metadataMap = {};
      const metadataList = await CanvasBlockMetadataModel.find({
        blockId: { $in: blockIds },
      });

      metadataList.forEach((meta) => {
        metadataMap[meta.blockId] = meta;
      });

      return {
        blocks: blocks.map((b) => ({
          block: b,
          metadata: metadataMap[b._id.toString()] || null,
        })),
        pagination: {
          page,
          limit,
          total: totalBlocks,
          pages: Math.ceil(totalBlocks / limit),
        },
      };
    } catch (error) {
      throw new ApiError(500, `Failed to fetch blocks: ${error.message}`);
    }
  }

  // Update block
  static async updateBlock(blockId, data, userId) {
    try {
      const block = await CanvasBlockModel.findByIdAndUpdate(
        blockId,
        {
          ...data,
          lastEditedBy: userId,
          updatedAt: new Date(),
        },
        { new: true, runValidators: true }
      );

      if (!block) {
        throw new ApiError(404, "Block not found");
      }

      // Update metadata if content changed
      if (data.content && !data.type) {
        const typeData = contentDetection.detectBlockType(data.content);
        if (typeData.metadata) {
          await CanvasBlockMetadataModel.findOneAndUpdate(
            { blockId: blockId },
            {
              blockId: blockId,
              blockType: block.type,
              ...typeData.metadata,
            },
            { upsert: true }
          );
        }
      }

      // Log activity
      await CanvasActivityModel.create({
        workspaceId: block.workspaceId,
        projectId: block.projectId,
        pageId: block.pageId,
        blockId: blockId,
        userId: userId,
        action: "update",
        entityType: "block",
        title: "Updated block",
      });

      return block;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to update block: ${error.message}`);
    }
  }

  // Delete block
  static async deleteBlock(blockId, userId) {
    try {
      const block = await CanvasBlockModel.findByIdAndUpdate(
        blockId,
        { isDeleted: true, updatedAt: new Date() },
        { new: true }
      );

      if (!block) {
        throw new ApiError(404, "Block not found");
      }

      // Delete metadata
      await CanvasBlockMetadataModel.deleteOne({ blockId: blockId });

      // Update page blocks count
      await CanvasPageModel.findByIdAndUpdate(
        block.pageId,
        { $inc: { blocksCount: -1 } }
      );

      // Log activity
      await CanvasActivityModel.create({
        workspaceId: block.workspaceId,
        projectId: block.projectId,
        pageId: block.pageId,
        blockId: blockId,
        userId: userId,
        action: "delete",
        entityType: "block",
        title: "Deleted block",
      });

      return block;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to delete block: ${error.message}`);
    }
  }

  // Move block
  static async moveBlock(blockId, x, y, userId) {
    try {
      const block = await CanvasBlockModel.findByIdAndUpdate(
        blockId,
        { x, y, updatedAt: new Date() },
        { new: true }
      );

      if (!block) {
        throw new ApiError(404, "Block not found");
      }

      // Log activity
      await CanvasActivityModel.create({
        workspaceId: block.workspaceId,
        projectId: block.projectId,
        pageId: block.pageId,
        blockId: blockId,
        userId: userId,
        action: "move",
        entityType: "block",
        title: "Moved block",
        metadata: new Map([["newPosition", { x, y }]]),
      });

      return block;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to move block: ${error.message}`);
    }
  }

  // Resize block
  static async resizeBlock(blockId, width, height, userId) {
    try {
      const block = await CanvasBlockModel.findByIdAndUpdate(
        blockId,
        { width, height, updatedAt: new Date() },
        { new: true }
      );

      if (!block) {
        throw new ApiError(404, "Block not found");
      }

      // Log activity
      await CanvasActivityModel.create({
        workspaceId: block.workspaceId,
        projectId: block.projectId,
        pageId: block.pageId,
        blockId: blockId,
        userId: userId,
        action: "resize",
        entityType: "block",
        title: "Resized block",
        metadata: new Map([["newSize", { width, height }]]),
      });

      return block;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to resize block: ${error.message}`);
    }
  }

  // Convert block type
  static async convertBlock(blockId, targetType, userId) {
    try {
      const block = await CanvasBlockModel.findById(blockId);
      if (!block) {
        throw new ApiError(404, "Block not found");
      }

      if (!blockConversion.canConvert(block.type, targetType)) {
        throw new ApiError(
          400,
          `Cannot convert from ${block.type} to ${targetType}`
        );
      }

      const convertedBlock = blockConversion.convertBlock(block, targetType);
      const updatedBlock = await CanvasBlockModel.findByIdAndUpdate(
        blockId,
        {
          type: convertedBlock.type,
          updatedAt: new Date(),
        },
        { new: true }
      );

      // Update metadata
      if (convertedBlock.metadata) {
        await CanvasBlockMetadataModel.findOneAndUpdate(
          { blockId: blockId },
          {
            blockId: blockId,
            blockType: targetType,
            ...convertedBlock.metadata,
          },
          { upsert: true }
        );
      }

      // Log activity
      await CanvasActivityModel.create({
        workspaceId: block.workspaceId,
        projectId: block.projectId,
        pageId: block.pageId,
        blockId: blockId,
        userId: userId,
        action: "convert",
        entityType: "block",
        title: `Converted block from ${block.type} to ${targetType}`,
      });

      return updatedBlock;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to convert block: ${error.message}`);
    }
  }

  // Archive block
  static async archiveBlock(blockId, userId) {
    try {
      const block = await CanvasBlockModel.findByIdAndUpdate(
        blockId,
        { isArchived: true, updatedAt: new Date() },
        { new: true }
      );

      if (!block) {
        throw new ApiError(404, "Block not found");
      }

      // Log activity
      await CanvasActivityModel.create({
        workspaceId: block.workspaceId,
        projectId: block.projectId,
        pageId: block.pageId,
        blockId: blockId,
        userId: userId,
        action: "archive",
        entityType: "block",
        title: "Archived block",
      });

      return block;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to archive block: ${error.message}`);
    }
  }

  // Duplicate block
  static async duplicateBlock(blockId, userId) {
    try {
      const block = await CanvasBlockModel.findById(blockId);
      if (!block) {
        throw new ApiError(404, "Block not found");
      }

      const metadata = await CanvasBlockMetadataModel.findOne({
        blockId: blockId,
      });

      // Create new block with offset position
      const newBlock = new CanvasBlockModel({
        ...block.toObject(),
        _id: undefined,
        createdBy: userId,
        lastEditedBy: userId,
        x: block.x + 20,
        y: block.y + 20,
        zIndex: block.zIndex + 1,
        collaborators: [userId],
        comments: [],
        reactions: new Map(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await newBlock.save();

      // Copy metadata if exists
      if (metadata) {
        await CanvasBlockMetadataModel.create({
          blockId: newBlock._id.toString(),
          blockType: metadata.blockType,
          ...metadata.toObject(),
        });
      }

      // Update page blocks count
      await CanvasPageModel.findByIdAndUpdate(
        block.pageId,
        { $inc: { blocksCount: 1 } }
      );

      // Log activity
      await CanvasActivityModel.create({
        workspaceId: block.workspaceId,
        projectId: block.projectId,
        pageId: block.pageId,
        blockId: newBlock._id.toString(),
        userId: userId,
        action: "create",
        entityType: "block",
        title: "Duplicated block",
      });

      return newBlock;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to duplicate block: ${error.message}`);
    }
  }

  // Search blocks
  static async searchBlocks(workspaceId, searchTerm) {
    try {
      const query = {
        workspaceId: workspaceId,
        isDeleted: false,
        $or: [
          { title: { $regex: searchTerm, $options: "i" } },
          { content: { $regex: searchTerm, $options: "i" } },
          { tags: { $in: [searchTerm] } },
        ],
      };

      const blocks = await CanvasBlockModel.find(query).limit(50);

      return blocks;
    } catch (error) {
      throw new ApiError(500, `Failed to search blocks: ${error.message}`);
    }
  }
}

module.exports = CanvasBlockService;
