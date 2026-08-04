const { v4: uuidv4 } = require("uuid");
const { EVENT_TYPES } = require("./eventTypes");

const createEventEnvelope = (type, payload, options = {}) => ({
  id: options.id || uuidv4(),
  type,
  action: options.action || null,
  version: options.version || "1.0",
  createdAt: options.createdAt || new Date().toISOString(),
  payload,
});

const createNoopGateway = () => ({
  publish: () => null,
  broadcast: () => null,
  sendToUser: () => null,
  sendToRoom: () => null,
});

const createEventDispatcher = (gateway) => ({
  publish: (type, payload, options = {}) => {
    const event = createEventEnvelope(type, payload, options);
    return gateway.publish(event, options);
  },
  broadcast: (type, payload, options = {}) => {
    const event = createEventEnvelope(type, payload, options);
    return gateway.broadcast(event, options);
  },
  sendToUser: (userId, type, payload, options = {}) => {
    const event = createEventEnvelope(type, payload, options);
    return gateway.sendToUser(userId, event, options);
  },
  sendToRoom: (roomId, type, payload, options = {}) => {
    const event = createEventEnvelope(type, payload, options);
    return gateway.sendToRoom(roomId, event, options);
  },
  createEventEnvelope,
});

let dispatcherInstance = createEventDispatcher(createNoopGateway());

const setEventDispatcher = (dispatcher) => {
  dispatcherInstance = dispatcher;
  return dispatcherInstance;
};

const getEventDispatcher = () => dispatcherInstance;

module.exports = {
  EVENT_TYPES,
  createEventDispatcher,
  createEventEnvelope,
  setEventDispatcher,
  getEventDispatcher,
};
