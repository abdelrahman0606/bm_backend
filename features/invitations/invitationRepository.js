const Invitation = require("./invitationModel");

exports.create = async (data) => {
  return await Invitation.create(data);
};

exports.find = async (filter, skip, limit, sort) => {
  return await Invitation.find(filter).skip(skip).limit(limit).sort(sort);
};

exports.count = async (filter) => {
  return await Invitation.countDocuments(filter);
};

exports.findById = async (id) => {
  return await Invitation.findById(id);
};

exports.findByRegiCode = async (regiCode) => {
  return await Invitation.findOne({ regiCode });
};

exports.updateById = async (id, data) => {
  return await Invitation.findByIdAndUpdate(id, data, {
    new: true,
    runValidators: true,
  });
};

exports.deleteById = async (id) => {
  return await Invitation.findByIdAndDelete(id);
};

exports.isRegiCodeUnique = async (regiCode) => {
  const existing = await Invitation.findOne({ regiCode });
  return !existing;
};
