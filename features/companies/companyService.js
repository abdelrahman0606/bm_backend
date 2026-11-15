const mongoose = require("mongoose");
const Company = require("./companyModel");
const ApiError = require("../../utils/apiError");
const engine = require("../../core/access/permissionEngine");
const { objectIdScopeFilter } = require("../../core/access/accessMiddleware");
const { scopeEnforced } = require("../../core/access/accessConfig");

/**
 * Whether `actor` may reach the company `id` for `action`.
 *
 * The creator always may — it is their company and the permission editor has
 * nothing to do with that. Anybody else needs a grant naming the company, or
 * the whole type. While scope enforcement is staged off this answers yes, so
 * accounts without grants keep working.
 */
const _mayReach = (actor, company, action) => {
  if (!company) return false;
  if (actor && actor.id && String(company.createdBy) === String(actor.id)) return true;
  if (!scopeEnforced()) return true;
  return engine.can(actor, "company", action, String(company._id));
};

/**
 * The `ids` query parameter as a list of ObjectIds, or null when absent.
 *
 * Values that are not ObjectIds are dropped rather than cast, so a malformed
 * parameter narrows the result instead of failing the request.
 */
const _parseIds = (raw) => {
  if (raw === undefined || raw === null || raw === "") return null;
  const values = Array.isArray(raw) ? raw : String(raw).split(",");
  return values
    .map((value) => String(value).trim())
    .filter((value) => mongoose.Types.ObjectId.isValid(value));
};

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

exports.getCompanies = async (query = {}, userId, actor = null) => {
  const { page = 0, limit = 10, search } = query;
  const filter = {};

  if (search) {
    filter.title = { $regex: search, $options: "i" };
  }

  // Before this, the list ignored the caller entirely: every authenticated
  // user was handed every company. Now the caller sees the companies they
  // created plus the ones they hold a grant on, and the count matches the
  // page — a client-side filter would have broken both.
  const conditions = [];

  if (actor && scopeEnforced()) {
    const scope = objectIdScopeFilter(actor, "company", "view");
    const own = { createdBy: String(actor.id) };
    // An unrestricted actor contributes no clause; otherwise the two reach
    // conditions are OR-ed, and kept in $and so a search cannot overwrite
    // them the way a bare $or assignment would.
    if (Object.keys(scope).length > 0) {
      conditions.push({ $or: [own, scope] });
    }
  }

  // The client may narrow the request to the ids it knows it may see. It is
  // an extra condition, never a replacement for the one above, so widening
  // the parameter by hand buys nothing.
  const requestedIds = _parseIds(query.ids);
  if (requestedIds !== null) {
    conditions.push({ _id: { $in: requestedIds } });
  }

  if (conditions.length > 0) {
    filter.$and = conditions;
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

exports.getCompanyById = async (id, userId, actor = null) => {
  // The previous query filtered on `id`, which is a virtual and not a stored
  // path, so it matched nothing and this endpoint always reported 404.
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError("Company not found", 404);
  }

  const company = await Company.findById(id);
  if (!company) {
    throw new ApiError("Company not found", 404);
  }

  if (!_mayReach(actor ?? { id: userId }, company, "view")) {
    throw new ApiError("You do not have access to this company", 403);
  }

  return buildCompanyResponse(company);
};

exports.updateCompany = async (id, updateData, userId, actor = null) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError("Company not found", 404);
  }

  const existing = await Company.findById(id);
  if (!existing) {
    throw new ApiError("Company not found", 404);
  }

  if (!_mayReach(actor ?? { id: userId }, existing, "update")) {
    throw new ApiError("You do not have update access to this company", 403);
  }

  // createdBy is ownership, not data: a client must not be able to hand a
  // company to somebody else, or to itself.
  const { createdBy, _id, id: _ignoredId, ...safeData } = updateData || {};

  const company = await Company.findByIdAndUpdate(
    id,
    { ...safeData },
    { new: true, runValidators: true }
  );

  return buildCompanyResponse(company);
};

exports.deleteCompany = async (id, userId, actor = null) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError("Company not found", 404);
  }

  const existing = await Company.findById(id);
  if (!existing) {
    throw new ApiError("Company not found", 404);
  }

  if (!_mayReach(actor ?? { id: userId }, existing, "delete")) {
    throw new ApiError("You do not have delete access to this company", 403);
  }

  await Company.findByIdAndDelete(id);
  return buildCompanyResponse(existing);
};
