// Block Conversion Utility - Allows converting between block types without losing data

const convertBlock = (block, targetType) => {
  if (block.type === targetType) {
    return block;
  }

  const conversions = {
    note: {
      task: convertNoteToTask,
      documentation: convertNoteToDocumentation,
      checklist: convertNoteToChecklist,
    },
    link: {
      bookmark: convertLinkToBookmark,
    },
    code: {
      documentation: convertCodeToDocumentation,
    },
    checklist: {
      task: convertChecklistToTask,
    },
  };

  const sourceType = block.type;
  const converter = conversions[sourceType]?.[targetType];

  if (!converter) {
    throw new Error(
      `Cannot convert from ${sourceType} to ${targetType}`
    );
  }

  return converter(block);
};

const convertNoteToTask = (noteBlock) => {
  return {
    ...noteBlock,
    type: "task",
    title: noteBlock.title || "Task from Note",
    metadata: {
      taskMetadata: {
        taskId: null,
        taskTitle: noteBlock.title || noteBlock.content.substring(0, 50),
        status: "pending",
        dueDate: null,
        assignedTo: null,
      },
    },
  };
};

const convertNoteToDocumentation = (noteBlock) => {
  return {
    ...noteBlock,
    type: "documentation",
    metadata: {
      documentationMetadata: {
        format: "markdown",
        outline: extractOutlineFromText(noteBlock.content),
        sections: 1,
      },
    },
  };
};

const convertNoteToChecklist = (noteBlock) => {
  const items = noteBlock.content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => ({
      id: generateId(),
      text: line.trim(),
      isCompleted: false,
      completedAt: null,
    }));

  return {
    ...noteBlock,
    type: "checklist",
    metadata: {
      checklistMetadata: {
        items: items,
        completionPercentage: 0,
      },
    },
  };
};

const convertLinkToBookmark = (linkBlock) => {
  return {
    ...noteBlock,
    type: "bookmark",
    metadata: linkBlock.metadata,
  };
};

const convertCodeToDocumentation = (codeBlock) => {
  return {
    ...codeBlock,
    type: "documentation",
    metadata: {
      documentationMetadata: {
        format: "markdown",
        outline: [],
        sections: 0,
      },
    },
  };
};

const convertChecklistToTask = (checklistBlock) => {
  const itemTexts = checklistBlock.metadata?.checklistMetadata?.items || [];
  const description = itemTexts
    .map((item) => `${item.isCompleted ? "✓" : "○"} ${item.text}`)
    .join("\n");

  return {
    ...checklistBlock,
    type: "task",
    metadata: {
      taskMetadata: {
        taskId: null,
        taskTitle: checklistBlock.title || "Task from Checklist",
        status: "pending",
        dueDate: null,
        assignedTo: null,
      },
    },
  };
};

const extractOutlineFromText = (text) => {
  const lines = text.split("\n");
  return lines
    .filter((line) => line.trim().startsWith("#"))
    .map((line) => {
      const level = (line.match(/^#+/) || [""])[0].length;
      return {
        level: level,
        text: line.replace(/^#+\s*/, ""),
      };
    });
};

const generateId = () => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

const canConvert = (fromType, toType) => {
  const validConversions = {
    note: ["task", "documentation", "checklist"],
    link: ["bookmark"],
    code: ["documentation"],
    checklist: ["task"],
  };

  return (validConversions[fromType] || []).includes(toType);
};

const getConvertibleTypes = (blockType) => {
  const conversions = {
    note: ["task", "documentation", "checklist"],
    link: ["bookmark"],
    code: ["documentation"],
    checklist: ["task"],
  };

  return conversions[blockType] || [];
};

module.exports = {
  convertBlock,
  canConvert,
  getConvertibleTypes,
  convertNoteToTask,
  convertNoteToDocumentation,
  convertNoteToChecklist,
  convertLinkToBookmark,
  convertCodeToDocumentation,
  convertChecklistToTask,
};
