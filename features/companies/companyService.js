const mongoose = require("mongoose");
const Company = require("./companyModel");
const User = require("../users/userModel");
const ApiError = require("../../utils/apiError");
const engine = require("../../core/access/permissionEngine");
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
  if (actor && actor.isMaster) return true;
  if (actor && actor.id && String(company.createdBy) === String(actor.id)) return true;

  // Check if user holds a company grant for this company (ignoring actions for view)
  const hasCompanyGrant = (actor?.permissions || []).some((p) => {
    if (!p || String(p.resourceType).trim().toLowerCase() !== "company") return false;
    const resId = String(p.resourceId || "").trim();
    return resId === "*" || resId.toLowerCase() === "all" || resId === String(company._id);
  });
  if (hasCompanyGrant && action === "view") return true;

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

  // Determine current user permissions & role
  let permissions = actor?.permissions;
  let userRole = actor?.role;

  if ((!permissions || permissions.length === 0) && userId) {
    const userDoc = await User.findById(userId).select("role permissions");
    if (userDoc) {
      userRole = userRole || userDoc.role;
      permissions = userDoc.permissions || [];
    }
  }

  const isMaster = Boolean(actor?.isMaster || userRole === "master");

  // Filter permissions where resourceType is "company" (without checking actions)
  const companyPermissions = (permissions || []).filter(
    (p) => p && String(p.resourceType).trim().toLowerCase() === "company"
  );

  const hasAllCompanies = companyPermissions.some((p) => {
    const resId = String(p.resourceId || "").trim();
    return resId === "*" || resId.toLowerCase() === "all" || resId === "";
  });

  const conditions = [];

  if (!hasAllCompanies) {
    if (companyPermissions.length > 0) {
      // User has specific company permissions -> get only these companies
      const allowedIds = [
        ...new Set(
          companyPermissions
            .map((p) => String(p.resourceId || "").trim())
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
        ),
      ];
      conditions.push({ _id: { $in: allowedIds } });
    } else if (!isMaster) {
      // Non-master user with no company permissions sees nothing
      conditions.push({ _id: { $in: [] } });
    }
  }

  // The client may narrow the request to the ids it knows it may see.
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
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError("Company not found", 404);
  }

  const company = await Company.findById(id);
  if (!company) {
    throw new ApiError("Company not found", 404);
  }

  let currentActor = actor;
  if ((!currentActor || !currentActor.permissions || currentActor.permissions.length === 0) && userId) {
    const userDoc = await User.findById(userId).select("role permissions");
    if (userDoc) {
      currentActor = new engine.Actor({
        id: String(userDoc._id),
        role: userDoc.role,
        permissions: (userDoc.permissions || []).map((p) => ({
          resourceType: p.resourceType,
          resourceId: p.resourceId,
          resourceName: p.resourceName,
          actions: [...(p.actions || [])],
        })),
      });
    }
  }

  if (!_mayReach(currentActor ?? { id: userId }, company, "view")) {
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
