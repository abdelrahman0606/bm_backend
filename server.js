// Initiate Express Server
const express = require("express");
const app = express();
const path = require("path");

const server = require("http").createServer(app);



app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (req.method === "OPTIONS") {
    // if (allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
    // }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Max-Age", "86400");
    return res.sendStatus(200);
  }
  next();
});


app.use("/ReportServer", (req, res) => {
  res.status(403).json({ error: "Access denied" });
});


app.get("/test", (req, res, next) => {
  res.send("App express on vrecel is done");
});


app.use("/attachments", express.static(path.join(__dirname, "./attachments")));
app.use(express.static("public"));

const port = process.env.PORT || 3003;
const host = "0.0.0.0";

server.listen(port, host, function () {
  console.info(`Server is listening on http://${host}:${port}`);
});

module.exports = server;

