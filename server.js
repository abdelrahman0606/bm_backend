// Initiate Express Server
const express = require("express");
const app = express();
const path = require("path");

const server = require("http").createServer(app);



app.get("/", (req, res, next) => {
  res.send("Hello World! Server is running.");
});



const port =  3003;
const host = "0.0.0.0";

server.listen(port, host, function () {
  console.info(`Server is listening on http://${host}:${port}`);
});

module.exports = server;

