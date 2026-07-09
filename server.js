const express = require("express");
const dotenv = require("dotenv");
dotenv.config({ path: "./config.env" });

const morgan = require("morgan");
const dbConnection = require("./config/database");
// ensure related models are loaded
// Canvas Models
require("./features/canvas/models/WorkspaceModel");
require("./features/canvas/models/CanvasPageModel");
require("./features/canvas/models/CanvasBlockModel");
require("./features/canvas/models/CanvasBlockMetadataModel");
require("./features/canvas/models/CanvasConnectionModel");
require("./features/canvas/models/CanvasCommentModel");
require("./features/canvas/models/CanvasActivityModel");
require("./features/canvas/models/CanvasViewModel");
const userRoute = require("./features/users/userRoute");
const authRoute = require("./features/auth/authRoute");
const tasksManagementRoute = require("./features/tasks_management/tasksManagementRoute");
const filesTelegramRoute = require("./features/files_telegram/filesTelegramRoute");
const canvasRoute = require("./features/canvas");
const companyRoute = require("./features/companies/companyRoute");

const ApiError = require("./utils/apiError");
const globalError = require("./middlewares/errorMiddleware");



//connect to database
dbConnection();
//express app initialization
const app = express();
// Middleware for logging in development mode
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
  console.log(`Morgan enabled in ${process.env.NODE_ENV} mode`);
}


// Sample route
app.use(express.json());

//mount routers

app.use("/api/v1/users", userRoute);
app.use("/api/v1/auth", authRoute);
app.use("/api/v1/companies", companyRoute);
// Tasks Management Central Route
app.use("/api/v1/tasks-management", tasksManagementRoute);

app.use("/api/v1/files-v2", filesTelegramRoute);
app.use("/api/v1/canvas", canvasRoute);

app.use((req, res, next) =>
  next(new ApiError(`Can't find this route: ${req.originalUrl}`, 400)),
);

//gloal error handling middleware
app.use(globalError);

const PORT = process.env.PORT || 8000;
const server = app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
// Handle unhandled promise rejections outside of express routes
process.on("un", (err) => {
  console.log(`Unhandled Rejection: ${err.name} - ${err.message}`);
  server.close(() => {
    console.log(
      "Shutting down server...... due to unhandled promise rejection",
    );
    process.exit(1);
  });
});

//flyctl lanuch
//flyctl deploy

//eslint-config-airbnb,js
//0f61fb9d4410f86b5acd867984ad7adb
//npm i -D eslint eslint-config-airbnb eslint-config-prettier eslint-plugin-import eslint-plugin-jsx-a11y eslint-plugin-node eslint-plugin-prettier eslint-plugin-react prettier
//.eslintrc.json
/*
{
    "extends": [
        "airbnb",
        "prettier",
        "plugin:node/recommended"
    ],
    "plugins": [
        "prettier"
    ],
    "rules": {
        // "prettier/prettier":"error",
        "spaced-comment": "off",
        "no-console": "off",
        "consistent-return": "off",
        "func-names": "off",
        "object-shorthand": "off",
        "no-process-exit": "off",
        "no-param-reassign": "off",
        "no-underscore-dangle": "off",
        "class-methods-use-this": "off",
        "no-undef": "error",
        "prefer-destructuring": [
            "error",
            {
                "object": true,
                "array": false
            }
        ],
        "no-unused-vars": [
            "warn",
            {
                "argsIgnorePattern": "req|res|next|val"
            }
        ]
    }
}
    */
