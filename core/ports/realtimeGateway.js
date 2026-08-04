class RealtimeGateway {
  publish() {
    throw new Error("publish() must be implemented by the transport adapter");
  }

  broadcast() {
    throw new Error("broadcast() must be implemented by the transport adapter");
  }

  sendToUser() {
    throw new Error(
      "sendToUser() must be implemented by the transport adapter"
    );
  }

  sendToRoom() {
    throw new Error(
      "sendToRoom() must be implemented by the transport adapter"
    );
  }
}

module.exports = RealtimeGateway;
