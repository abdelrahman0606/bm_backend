class SocketManager {
  constructor() {
    this.socketsById = new Map();
    this.connectionsByUserId = new Map();
    this.roomsBySocketId = new Map();
  }

  addSocket(socket) {
    this.socketsById.set(socket.id, socket);

    if (socket.userId) {
      if (!this.connectionsByUserId.has(socket.userId)) {
        this.connectionsByUserId.set(socket.userId, new Set());
      }
      this.connectionsByUserId.get(socket.userId).add(socket);
    }

    this.roomsBySocketId.set(socket.id, new Set());
    return socket;
  }

  removeSocket(socketId) {
    const socket = this.socketsById.get(socketId);
    if (!socket) {
      return null;
    }

    this.socketsById.delete(socketId);
    this.roomsBySocketId.delete(socketId);

    if (socket.userId) {
      const userSockets = this.connectionsByUserId.get(socket.userId);
      if (userSockets) {
        userSockets.delete(socket);
        if (userSockets.size === 0) {
          this.connectionsByUserId.delete(socket.userId);
        }
      }
    }

    return socket;
  }

  getSocket(socketId) {
    return this.socketsById.get(socketId) || null;
  }

  getSocketsForUser(userId) {
    const sockets = this.connectionsByUserId.get(userId);
    if (!sockets) {
      return [];
    }
    return Array.from(sockets);
  }

  getSocketCountForUser(userId) {
    return this.getSocketsForUser(userId).length;
  }

  getConnectedUsers() {
    return Array.from(this.connectionsByUserId.entries()).map(
      ([userId, sockets]) => ({
        userId,
        socketCount: sockets.size,
        socketIds: Array.from(sockets).map((socket) => socket.id),
      })
    );
  }

  joinRoom(socketId, roomId) {
    const socket = this.getSocket(socketId);
    if (!socket) {
      return false;
    }

    socket.join(roomId);
    const rooms = this.roomsBySocketId.get(socketId) || new Set();
    rooms.add(roomId);
    this.roomsBySocketId.set(socketId, rooms);
    return true;
  }

  leaveRoom(socketId, roomId) {
    const socket = this.getSocket(socketId);
    if (!socket) {
      return false;
    }

    socket.leave(roomId);
    const rooms = this.roomsBySocketId.get(socketId);
    if (rooms) {
      rooms.delete(roomId);
    }
    return true;
  }

  getSocketRooms(socketId) {
    return Array.from(this.roomsBySocketId.get(socketId) || []);
  }
}

const socketManagerInstance = new SocketManager();

module.exports = socketManagerInstance;
module.exports.SocketManager = SocketManager;
