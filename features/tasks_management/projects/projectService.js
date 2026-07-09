const asyncHandler = require("express-async-handler");
const ProjectModel = require("./projectModel");

exports.getProjects = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.max(parseInt(req.query.limit, 10) || 20, 1);
  const skip = (page - 1) * limit;

  const excludeFields = ["page", "limit", "sort", "search"];
  const allowedFields = Object.keys(ProjectModel.schema.paths).filter(
    (field) => !["_id", "__v"].includes(field),
  );

  const filter = { isDeleted: false };
  Object.entries(req.query).forEach(([key, value]) => {
    if (excludeFields.includes(key)) return;
    if (!allowedFields.includes(key)) return;
    if (value === "") return;

    const schemaPath = ProjectModel.schema.path(key);
    if (schemaPath) {
      const type = schemaPath.instance;
      if (type === "Boolean") {
        filter[key] = String(value).toLowerCase() === "true";
        return;
      }
      if (type === "Number") {
        const numberValue = Number(value);
        if (!Number.isNaN(numberValue)) {
          filter[key] = numberValue;
        }
        return;
      }
      if (type === "Date") {
        const dateValue = new Date(value);
        if (!Number.isNaN(dateValue.getTime())) {
          filter[key] = dateValue;
        }
        return;
      }
      if (type === "Array") {
        filter[key] = {
          $in: String(value)
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        };
        return;
      }
    }

    if (String(value).includes("|")) {
      filter[key] = {
        $in: String(value)
          .split("|")
          .map((item) => item.trim())
          .filter(Boolean),
      };
      return;
    }

    filter[key] = value;
  });

  const search = req.query.search;
  if (search) {
    filter.$or = [
      { title: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
      { workspaceId: { $regex: search, $options: "i" } },
      { createdBy: { $regex: search, $options: "i" } },
      { tags: { $regex: search, $options: "i" } },
    ];
  }

  const sortQuery = (() => {
    if (!req.query.sort) return { createdAt: -1 };
    const [field, order] = String(req.query.sort).split(":");
    if (!field || !allowedFields.includes(field)) {
      return { createdAt: -1 };
    }
    return { [field]: order === "asc" ? 1 : -1 };
  })();

  const projects = await ProjectModel.find(filter)
    .skip(skip)
    .limit(limit)
    .sort(sortQuery);
  const total = await ProjectModel.countDocuments(filter);

  res
    .status(200)
    .json({ result: projects.length, page, total, data: projects });
});

exports.getProject = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const project = await ProjectModel.findOne({ _id: id, isDeleted: false });
  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }
  res.status(200).json({ data: project });
});

exports.createProject = asyncHandler(async (req, res) => {
  const project = await ProjectModel.create(req.body);
  res.status(201).json({ data: project });
});

exports.updateProject = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updateFields = {};
  const updatable = [
    "workspaceId",
    "createdBy",
    "title",
    "description",
    "coverImage",
    "emoji",
    "icon",
    "colorValue",
    "privacy",
    "status",
    "priority",
    "isFavorite",
    "isArchived",
    "isTemplate",
    "isDeleted",
    "tags",
    "attachments",
    "links",
    "members",
    "settings",
    "analytics",
    "archivedAt",
    "deletedAt",
    "startDate",
    "dueDate",
    "lastActivityAt",
  ];

  updatable.forEach((field) => {
    if (req.body[field] !== undefined) {
      updateFields[field] = req.body[field];
    }
  });

  const project = await ProjectModel.findByIdAndUpdate(id, updateFields, {
    new: true,
    runValidators: true,
  });

  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  res.status(200).json({ data: project });
});

exports.getProjectStats = asyncHandler(async (req, res) => {
  const now = new Date();
  const baseFilter = { isDeleted: false };

  const [
    totalProjects,
    plannedProjects,
    activeProjects,
    completedProjects,
    archivedProjects,
    overdueProjects,
    favoriteProjects,
  ] = await Promise.all([
    ProjectModel.countDocuments(baseFilter),
    ProjectModel.countDocuments({ ...baseFilter, status: "planned" }),
    ProjectModel.countDocuments({ ...baseFilter, status: "active" }),
    ProjectModel.countDocuments({ ...baseFilter, status: "completed" }),
    ProjectModel.countDocuments({ ...baseFilter, status: "archived" }),
    ProjectModel.countDocuments({
      ...baseFilter,
      dueDate: { $lt: now },
      status: { $ne: "completed" },
    }),
    ProjectModel.countDocuments({ ...baseFilter, isFavorite: true }),
  ]);

  res.status(200).json({
    data: {
      totalProjects,
      plannedProjects,
      activeProjects,
      completedProjects,
      archivedProjects,
      overdueProjects,
      favoriteProjects,
    },
  });
});

exports.deleteProject = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const project = await ProjectModel.findByIdAndUpdate(
    id,
    { isDeleted: true, deletedAt: new Date() },
    { new: true },
  );
  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }
  res.status(204).send();
});
