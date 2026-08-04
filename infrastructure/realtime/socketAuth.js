const jwt = require("jsonwebtoken");

const authenticateSocket = (socket, next) => {
  try {
    const authToken =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization ||
      null;

    const token =
      typeof authToken === "string" && authToken.startsWith("Bearer ")
        ? authToken.split(" ")[1]
        : authToken;

    if (!token) {
      return next(new Error("Authentication error: token is required"));
    }

    const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";
    const decoded = jwt.verify(token, JWT_SECRET);
    
    socket.userId = decoded.id;
    socket.join(`user:${decoded.id}`);
    return next();
  } catch (error) {
    return next(new Error("Authentication error: invalid token"));
  }
};

module.exports = { authenticateSocket };
