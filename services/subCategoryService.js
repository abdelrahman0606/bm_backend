const slugify = require("slugify");
const asyncHandler = require("express-async-handler");
const SubCategory = require("../models/subCategoryModel");

//GET /api/v1/categories/:categoryId/subcategories

exports.getSubCategories = asyncHandler(async (req, res) => {
  const page = req.query.page * 1 || 1;
  const limit = req.query.limit * 1 || 3;
  const skip = (page - 1) * limit; //(2-1)*10=10 will skip first 10 results

  const subcategories = await SubCategory.find({
    category: req.body.categoryId,
  })
    .skip(skip)
    .limit(limit);
  res
    .status(200)
    .json({ result: subcategories.length, page, data: subcategories });
});

exports.getOneSubCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const subcategory = await SubCategory.findById(id);
  if (!subcategory) {
    res.status(404).json({ message: "SubCategory not found" });
    return;
  }
  res.status(200).json({ data: subcategory });
});

exports.createSubCategories = asyncHandler(async (req, res) => {
  const { name } = req.body;
  const subcategory = await SubCategory.create({
    name,
    slug: slugify(name),
  });

  res.status(201).json({ data: subcategory });
});

exports.updateSubCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  const subcategory = await SubCategory.findOneAndUpdate(
    { _id: id },
    {
      name,
      slug: slugify(name),
    },
    { new: true },
  );
  if (!subcategory) {
    res.status(404).json({ message: "SubCategory not found" });
    return;
  }
  res.status(200).json({ data: subcategory });
});

exports.deleteSubCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const subcategory = await SubCategory.findByIdAndDelete(id);
  if (!subcategory) {
    res.status(404).json({ message: "SubCategory not found" });
    return;
  }
  res.status(204).send();
});
