const mongoose = require("mongoose");

const dbConnection = () => {
  mongoose
    .connect(process.env.MONGODB_URI)
    .then((conn) => {
      console.log(
        `Connected to the database successfully ${conn.connection.host}`,
      );
    })
    .catch((err) => {
      console.error("Database connection error:", err);
      process.exit(1);
    });
};
module.exports = dbConnection;
