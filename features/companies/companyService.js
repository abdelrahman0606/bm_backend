const Company = require("./companyModel");
const ApiError = require("../../utils/apiError");

const buildCompanyResponse = (company) => {
  return {
    _id: company._id,
    id: company.id,
    title: company.title,
    description: company.description,
    logo: company.logo,
    createdBy: company.createdBy,
    isPrimary: company.isPrimary,
    index: company.index,
    createdAt: company.createdAt,
    updatedAt: company.updatedAt,
  };
};

exports.createCompany = async (companyData, userId) => {
  const company = await Company.create({
    ...companyData,
    createdBy: userId,
  });
  return buildCompanyResponse(company);
};

exports.getCompanies = async (query = {}, userId) => {
  const { page = 0, limit = 10, search } = query;
  const filter = { createdBy: userId };

  if (search) {
    filter.title = { $regex: search, $options: "i" };
  }

  const skip = page * limit;
  const companies = await Company.find(filter)
    .skip(skip)
    .limit(parseInt(limit, 10))
    .sort({ index: 1, createdAt: -1 });

  const total = await Company.countDocuments(filter);

  return {
    companies: companies.map((c) => buildCompanyResponse(c)),
    pagination: {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

exports.getCompanyById = async (id, userId) => {
  const company = await Company.findOne({ id, createdBy: userId });
  if (!company) {
    throw new ApiError("Company not found", 404);
  }
  return buildCompanyResponse(company);
};

exports.updateCompany = async (id, updateData, userId) => {
  const company = await Company.findOneAndUpdate(
    { id, createdBy: userId },
    { ...updateData },
    { new: true, runValidators: true }
  );

  if (!company) {
    throw new ApiError("Company not found", 404);
  }
  return buildCompanyResponse(company);
};

exports.deleteCompany = async (id, userId) => {
  const company = await Company.findOneAndDelete({ id, createdBy: userId });

  if (!company) {
    throw new ApiError("Company not found", 404);
  }
  return buildCompanyResponse(company);
};
