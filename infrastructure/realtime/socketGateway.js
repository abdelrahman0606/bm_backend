const RealtimeGateway = require("../../core/ports/realtimeGateway");

class SocketGateway extends RealtimeGateway {
  constructor(io, socketManager) {
    super();
    this.io = io;
    this.socketManager = socketManager;
  }

  logEvent(direction, payload, meta = {}) {
    console.log(`[ws:${direction}]`, {
      ...meta,
      payload,
    });
  }

  publish(event, options = {}) {
    const targetRoom = options.roomId;
    if (targetRoom) {
      this.logEvent("send", event, { target: "room", roomId: targetRoom });
      return this.io.to(targetRoom).emit("event", event, options.ack);
    }

    const targetUserId = options.userId;
    if (targetUserId) {
      this.logEvent("send", event, { target: "user", userId: targetUserId });
      return this.io
        .to(`user:${targetUserId}`)
        .emit("event", event, options.ack);
    }

    this.logEvent("send", event, { target: "all" });
    return this.io.emit("event", event, options.ack);
  }

  broadcast(event, options = {}) {
    if (options.roomId) {
      this.logEvent("send", event, { target: "room", roomId: options.roomId });
      return this.io.to(options.roomId).emit("event", event, options.ack);
    }

    this.logEvent("send", event, { target: "all" });
    return this.io.emit("event", event, options.ack);
  }

  sendToUser(userId, event, options = {}) {
    this.logEvent("send", event, { target: "user", userId });
    return this.io.to(`user:${userId}`).emit("event", event, options.ack);
  }

  sendToRoom(roomId, event, options = {}) {
    this.logEvent("send", event, { target: "room", roomId });
    return this.io.to(roomId).emit("event", event, options.ack);
  }
}

module.exports = SocketGateway;
