// src/utils/logger.ts
import pino from "pino";
import dotenv from "dotenv";
dotenv.config();
var logLevel = process.env.LOG_LEVEL || "info";
console.log("Log level set to:", logLevel);
var logger = pino({
  level: logLevel,
  transport: process.env.LOG_PRETTY === "true" ? { target: "pino-pretty" } : void 0,
  timestamp: pino.stdTimeFunctions.isoTime
});
var createLogger = (component) => {
  console.log("Creating logger for component:", component);
  return logger.child({ component });
};

// src/implementations/amqp-consumer.ts
var AmqpConsumer = class {
  constructor(queue, amqpConnectionManager2) {
    this.queue = queue;
    this.amqpConnectionManager = amqpConnectionManager2;
    this.logger.debug(`Creating consumer for queue: ${this.queue}`);
  }
  logger = createLogger("AmqpConsumer");
  channel = null;
  async consume(callback) {
    try {
      this.logger.info(
        `Attempting to get AMQP channel for queue: ${this.queue}`
      );
      this.channel = await this.amqpConnectionManager.getChannel();
      await this.channel.assertQueue(this.queue, { durable: true });
      this.logger.info(`Consuming messages from queue: ${this.queue}`);
      this.channel.prefetch(1);
      this.channel.consume(
        this.queue,
        async (msg) => {
          if (!msg) {
            this.logger.warn(
              `Consumer for queue ${this.queue} received null message (channel closed?)`
            );
            return;
          }
          let data;
          try {
            data = JSON.parse(msg.content.toString());
            this.logger.debug(
              { data, msgId: msg.properties.messageId },
              `Received message from queue: ${this.queue}`
            );
            await callback(data);
            this.channel.ack(msg);
            this.logger.debug(
              { msgId: msg.properties.messageId },
              "Message processed and acknowledged successfully"
            );
          } catch (error) {
            this.logger.error(
              {
                error,
                msg: msg.content.toString(),
                msgId: msg.properties.messageId
              },
              "Error processing message"
            );
            this.channel.nack(msg, false, false);
          }
        },
        {}
      );
      this.channel.on("error", (err) => {
        this.logger.error(
          { err, queue: this.queue },
          "AMQP channel error during consumption"
        );
      });
      this.channel.on("close", () => {
        this.logger.warn(
          { queue: this.queue },
          "AMQP channel closed during consumption."
        );
      });
    } catch (error) {
      this.logger.error(
        { error, queue: this.queue },
        `Failed to setup consumer for queue: ${this.queue}`
      );
      throw error;
    }
  }
  async stop() {
    if (this.channel) {
      try {
        this.logger.info(`Stopping consumer for queue: ${this.queue}`);
        this.logger.warn(
          `Stopping consumer for ${this.queue} - graceful cancellation not fully implemented without consumer tags.`
        );
      } catch (error) {
        this.logger.error(
          { error, queue: this.queue },
          `Error stopping consumer`
        );
      } finally {
        this.channel = null;
      }
    }
  }
};

// src/implementations/amqp-publisher.ts
var logger2 = createLogger("AmqpPublisher");
var AmqpPublisher = class {
  constructor(amqpConnectionManager2) {
    this.amqpConnectionManager = amqpConnectionManager2;
  }
  async publish(queueName, payload) {
    let channel;
    try {
      logger2.debug(
        { queue: queueName },
        `Attempting to publish message to queue`
      );
      channel = await this.amqpConnectionManager.getChannel();
      await channel.assertQueue(queueName, { durable: true });
      const success = channel.sendToQueue(
        queueName,
        Buffer.from(JSON.stringify(payload)),
        { persistent: true }
      );
      if (success) {
        logger2.debug(
          { queue: queueName, payload },
          "Message sent to queue successfully"
        );
      } else {
        logger2.warn(
          { queue: queueName },
          "Failed to send message to queue (possibly backpressure)"
        );
      }
    } catch (error) {
      logger2.error(
        { error, queue: queueName, payload },
        "Error publishing message to AMQP queue"
      );
      throw error;
    }
  }
};

// src/implementations/baileys-sender.ts
import { jidNormalizedUser } from "baileys";
var BaileysSender = class {
  constructor(sock) {
    this.sock = sock;
    this.logger.info("BaileysSender initialized");
  }
  logger = createLogger("BaileysSender");
  async send(to, message) {
    try {
      let recipientJid = to;
      if (!recipientJid.includes("@")) {
        recipientJid = `${to}@s.whatsapp.net`;
      }
      recipientJid = jidNormalizedUser(recipientJid);
      this.logger.info({ to: recipientJid }, "Sending WhatsApp message");
      this.logger.debug({ to: recipientJid, message }, "Message details");
      const result = await this.sock.sendMessage(recipientJid, {
        text: message
      });
      this.logger.info(
        {
          to: recipientJid,
          messageId: result?.key?.id
        },
        "WhatsApp message sent successfully"
      );
    } catch (error) {
      const errorMessage = error?.message || "Unknown error";
      const errorDetails = error?.data || error;
      this.logger.error(
        { error: errorMessage, details: errorDetails, to },
        "Failed to send WhatsApp message"
      );
      throw error;
    }
  }
};

// src/implementations/baileys-receiver.ts
import { jidNormalizedUser as jidNormalizedUser2 } from "baileys";
var BaileysReceiver = class {
  constructor(sock, publisher, incomingQueueName) {
    this.sock = sock;
    this.publisher = publisher;
    this.incomingQueueName = incomingQueueName;
    this.logger.info("Initializing BaileysReceiver");
    this.init();
  }
  logger = createLogger("BaileysReceiver");
  init() {
    this.sock.ev.on("messages.upsert", async (m) => {
      if (m.type !== "notify") return;
      for (const msg of m.messages) {
        this.handleMessage(msg).catch((err) => {
          this.logger.error(
            { err, messageId: msg.key.id },
            "Error handling incoming message"
          );
        });
      }
    });
    this.logger.info("BaileysReceiver initialized and listening for messages");
  }
  async handleMessage(message) {
    if (!message.message || message.key.fromMe) {
      this.logger.trace(
        { msgId: message.key.id, fromMe: message.key.fromMe },
        "Ignoring message (no content or from self)"
      );
      return;
    }
    const senderJid = message.key.remoteJid;
    if (!senderJid) {
      this.logger.warn(
        { msgId: message.key.id },
        "Ignoring message without sender JID"
      );
      return;
    }
    const from = jidNormalizedUser2(senderJid);
    const text = message.message.conversation || message.message.extendedTextMessage?.text || "";
    if (!text) {
      this.logger.debug(
        { msgId: message.key.id, from },
        "Ignoring message without text content"
      );
      return;
    }
    const timestamp = typeof message.messageTimestamp === "number" ? message.messageTimestamp * 1e3 : typeof message.messageTimestamp === "object" && message.messageTimestamp !== null && typeof message.messageTimestamp.toNumber === "function" ? message.messageTimestamp.toNumber() * 1e3 : Date.now();
    this.logger.info(
      { from, messageId: message.key.id },
      "Received WhatsApp message"
    );
    this.logger.debug({ from, text, timestamp }, "Processing incoming message");
    try {
      await this.publisher.publish(this.incomingQueueName, {
        from,
        message: text,
        timestamp,
        originalMessageId: message.key.id
      });
      this.logger.debug(
        { from, queue: this.incomingQueueName },
        "Message published to queue"
      );
    } catch (error) {
      this.logger.error(
        { error, from, messageId: message.key.id },
        "Error publishing received message to queue"
      );
    }
  }
};

// src/utils/health-monitor.ts
import express from "express";

// src/config/config.ts
import dotenv2 from "dotenv";
import { z } from "zod";
dotenv2.config();
var logger3 = createLogger("Config");
var configSchema = z.object({
  amqp: z.object({
    url: z.string().min(1, "AMQP_URL is required"),
    reconnectAttempts: z.coerce.number().default(10),
    reconnectDelay: z.coerce.number().default(5e3),
    queues: z.object({
      outgoing: z.string().min(1, "AMQP_QUEUE_OUTGOING is required"),
      incoming: z.string().min(1, "AMQP_QUEUE_INCOMING is required")
    })
  }),
  logging: z.object({
    level: z.string().default("info"),
    prettyPrint: z.boolean().default(process.env.NODE_ENV !== "production")
  }),
  whatsapp: z.object({
    sessionPath: z.string().default("auth"),
    reconnectInterval: z.coerce.number().default(3e4)
  }),
  health: z.object({
    port: z.coerce.number().default(3e3)
  })
});
var parsedConfig = configSchema.safeParse({
  amqp: {
    url: process.env.AMQP_URL,
    reconnectAttempts: process.env.AMQP_RECONNECT_ATTEMPTS ?? 10,
    reconnectDelay: process.env.AMQP_RECONNECT_DELAY ?? 5e3,
    queues: {
      outgoing: process.env.AMQP_QUEUE_OUTGOING ?? "messages-received",
      incoming: process.env.AMQP_QUEUE_INCOMING ?? "messages-sent"
    }
  },
  logging: {
    level: process.env.LOG_LEVEL,
    prettyPrint: process.env.NODE_ENV !== "production"
  },
  whatsapp: {
    sessionPath: process.env.WHATSAPP_SESSION_PATH ?? "auth",
    reconnectInterval: process.env.WHATSAPP_RECONNECT_INTERVAL ?? 3e4
  },
  health: {
    port: process.env.HEALTH_PORT ?? 3e3
  }
});
if (!parsedConfig.success) {
  const flatErrors = parsedConfig.error.flatten().fieldErrors;
  const errorMessages = Object.entries(flatErrors).map(([field, errors]) => `${field}: ${errors?.join(", ")}`).join("\n");
  logger3.fatal(
    { errors: errorMessages },
    "Failed to load configuration"
  );
  process.exit(1);
}
logger3.info("Configuration loaded successfully");
var config = parsedConfig.data;

// src/utils/health-monitor.ts
var HealthMonitor = class {
  app = express();
  port = config.health.port;
  logger = createLogger("HealthMonitor");
  serviceStatuses = /* @__PURE__ */ new Map();
  constructor() {
    this.setupRoutes();
  }
  setupRoutes() {
    this.app.get("/health", (_, res) => {
      const statuses = Array.from(this.serviceStatuses.values());
      const allServicesUp = statuses.every((s) => s.status === "up");
      res.status(allServicesUp ? 200 : 503).json({
        status: allServicesUp ? "healthy" : "unhealthy",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        services: statuses
      });
    });
    this.app.get("/health/:service", (req, res) => {
      const service = this.serviceStatuses.get(req.params.service);
      if (!service) {
        return res.status(404).json({
          error: `Service ${req.params.service} not found`
        });
      }
      res.status(service.status === "up" ? 200 : 503).json(service);
    });
  }
  start() {
    this.app.listen(this.port, () => {
      this.logger.info(
        `Health check endpoint listening at http://localhost:${this.port}/health`
      );
    });
  }
  registerService(service, checkFn, interval = 6e4) {
    this.serviceStatuses.set(service, {
      service,
      status: "down",
      lastChecked: /* @__PURE__ */ new Date()
    });
    const check = async () => {
      try {
        const isUp = await checkFn();
        this.updateStatus(service, isUp);
      } catch (error) {
        this.logger.error({ error, service }, "Health check failed");
        this.updateStatus(service, false, error);
      }
    };
    check();
    setInterval(check, interval);
    this.logger.info(
      `Registered health check for ${service}, checking every ${interval}ms`
    );
  }
  updateStatus(service, isUp, details) {
    const currentStatus = this.serviceStatuses.get(service);
    const newStatus = {
      service,
      status: isUp ? "up" : "down",
      lastChecked: /* @__PURE__ */ new Date(),
      details
    };
    this.serviceStatuses.set(service, newStatus);
    if (!currentStatus || currentStatus.status !== newStatus.status) {
      if (isUp) {
        this.logger.info({ service }, `Service ${service} is up`);
      } else {
        this.logger.warn({ service, details }, `Service ${service} is down`);
      }
    }
  }
};
var healthMonitor = new HealthMonitor();

// src/utils/graceful-shutdown.ts
var GracefulShutdown = class {
  logger = createLogger("GracefulShutdown");
  handlers = [];
  shuttingDown = false;
  shutdownTimeout = parseInt(
    process.env.SHUTDOWN_TIMEOUT_MS || "10000"
  );
  amqpConnectionManager = null;
  constructor() {
    process.on("SIGTERM", this.shutdown.bind(this));
    process.on("SIGINT", this.shutdown.bind(this));
    process.on("uncaughtException", (error) => {
      this.logger.fatal({ error }, "Uncaught exception");
      this.shutdown(1);
    });
    process.on("unhandledRejection", (reason) => {
      this.logger.fatal({ reason }, "Unhandled promise rejection");
      this.shutdown(1);
    });
  }
  setAmqpConnectionManager(amqpConnectionManager2) {
    this.amqpConnectionManager = amqpConnectionManager2;
  }
  registerHandler(handler, name) {
    this.handlers.push(handler);
    this.logger.debug(`Registered shutdown handler${name ? ": " + name : ""}`);
  }
  registerDefaultHandlers() {
    this.registerHandler(async () => {
      await this?.amqpConnectionManager?.close();
    }, "AMQP Connection");
    this.logger.info("Registered default shutdown handlers");
  }
  async shutdown(exitCode = 0) {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.logger.info("Graceful shutdown initiated");
    const forceExitTimeout = setTimeout(() => {
      this.logger.error(
        `Shutdown timed out after ${this.shutdownTimeout}ms, forcing exit`
      );
      process.exit(exitCode || 1);
    }, this.shutdownTimeout);
    try {
      const shutdownPromises = this.handlers.map(async (handler, index) => {
        try {
          await handler();
          this.logger.debug(`Handler ${index + 1} completed`);
        } catch (error) {
          this.logger.error(
            { error, handlerIndex: index },
            "Error in shutdown handler"
          );
        }
      });
      await Promise.all(shutdownPromises);
      this.logger.info("All shutdown handlers completed successfully");
    } catch (error) {
      this.logger.error({ error }, "Error during shutdown sequence");
    } finally {
      clearTimeout(forceExitTimeout);
      this.logger.info(`Exiting with code ${exitCode}`);
      process.exit(exitCode);
    }
  }
};

// src/utils/amqp-connection-manager.ts
import client from "amqplib";
var AmqpConnectionManager = class {
  connection = null;
  channel = null;
  logger = createLogger("AmqpConnectionManager");
  reconnectTimer = null;
  reconnectAttempts = 0;
  maxReconnectAttempts = config.amqp.reconnectAttempts;
  reconnectDelay = config.amqp.reconnectDelay;
  async getChannel() {
    if (!this.connection || !this.channel) {
      await this.connect();
    }
    return this.channel;
  }
  async connect() {
    try {
      this.logger.info("Connecting to AMQP broker");
      this.connection = await client.connect(config.amqp.url);
      if (!this.connection) {
        throw new Error("Failed to connect to AMQP broker");
      }
      this.connection.on("error", (err) => {
        this.logger.error({ err }, "AMQP connection error");
        this.reconnect();
      });
      this.connection.on("close", () => {
        this.logger.warn("AMQP connection closed");
        this.reconnect();
      });
      this.channel = await this.connection.createChannel();
      this.logger.info("Successfully connected to AMQP broker");
      this.reconnectAttempts = 0;
    } catch (error) {
      this.logger.error({ error }, "Failed to connect to AMQP broker");
      this.reconnect();
    }
  }
  reconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.channel = null;
    this.connection = null;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error(
        `Maximum reconnection attempts (${this.maxReconnectAttempts}) reached`
      );
      process.exit(1);
      return;
    }
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);
    this.logger.info(
      `Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`
    );
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((err) => {
        this.logger.error({ err }, "Reconnection attempt failed");
      });
    }, delay);
  }
  async close() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
      this.logger.info("AMQP connection closed gracefully");
    } catch (error) {
      this.logger.error({ error }, "Error closing AMQP connection");
    } finally {
      this.channel = null;
      this.connection = null;
    }
  }
};

// src/implementations/baileys-client.ts
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} from "baileys";
var logger4 = createLogger("BaileysClient");
var BaileysClient = class {
  constructor(qrCodeGenerator2) {
    this.qrCodeGenerator = qrCodeGenerator2;
  }
  sock = null;
  reconnectTimer = null;
  reconnectAttempts = 0;
  maxReconnectAttempts = 10;
  connectionState = {};
  isConnected = false;
  async connect() {
    try {
      logger4.info("Connecting to WhatsApp");
      const { state, saveCreds } = await useMultiFileAuthState(
        config.whatsapp.sessionPath
      );
      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: logger4
      });
      this.sock.ev.on("creds.update", saveCreds);
      this.sock.ev.on("connection.update", (update) => {
        this.handleConnectionUpdate(update);
      });
      return this.sock;
    } catch (error) {
      logger4.error({ error, message: error.message }, "Failed to connect to WhatsApp");
      this.scheduleReconnect();
      throw error;
    }
  }
  async handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;
    this.connectionState = { ...this.connectionState, ...update };
    if (qr) {
      logger4.info("QR code generated, please scan with your phone");
      logger4.info(await this.qrCodeGenerator.generateQRCode(qr));
    }
    if (connection === "close") {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        logger4.warn("Connection closed, attempting to reconnect");
        this.scheduleReconnect();
      } else {
        logger4.error(
          "Connection closed due to logout, manual reconnection required"
        );
        this.isConnected = false;
      }
    } else if (connection === "open") {
      logger4.info("Connected to WhatsApp");
      this.isConnected = true;
      this.reconnectAttempts = 0;
    }
  }
  scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger4.error(
        `Maximum reconnection attempts (${this.maxReconnectAttempts}) reached`
      );
      process.exit(1);
      return;
    }
    this.reconnectAttempts++;
    const delay = config.whatsapp.reconnectInterval * Math.pow(1.5, this.reconnectAttempts - 1);
    logger4.info(
      `Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`
    );
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((err) => {
        logger4.error({ err }, "Reconnection attempt failed");
      });
    }, delay);
  }
  getConnectionState() {
    return this.isConnected;
  }
  getSocket() {
    if (!this.sock) {
      throw new Error("WhatsApp connection not initialized");
    }
    return this.sock;
  }
};

// src/utils/qrcode-generator.ts
import * as qrcode from "qrcode";
var QRCodeGenerator = class {
  qrCode;
  constructor() {
    this.qrCode = qrcode;
  }
  async generateQRCode(data) {
    return await this.qrCode.toString(data, { type: "terminal" });
  }
};

// src/app.ts
var logger5 = createLogger("app");
var qrCodeGenerator = new QRCodeGenerator();
var baileysConnection = new BaileysClient(qrCodeGenerator);
var gracefulShutdown = new GracefulShutdown();
var AppError = class extends Error {
  constructor(message, cause) {
    super(message);
    this.cause = cause;
    this.name = "AppError";
  }
};
var amqpConnectionManager = null;
async function startWhatsAppIntegration() {
  logger5.info("Starting WhatsApp integration service");
  try {
    const gracefulShutdown2 = new GracefulShutdown();
    amqpConnectionManager = new AmqpConnectionManager();
    logger5.info("Initializing WhatsApp connection");
    const whatsAppClient = await baileysConnection.connect();
    const baileysClientWrapper = baileysConnection;
    const sender = new BaileysSender(whatsAppClient);
    const publisher = new AmqpPublisher(amqpConnectionManager);
    const receiver = new BaileysReceiver(
      whatsAppClient,
      publisher,
      config.amqp.queues.incoming
    );
    logger5.info("Initializing message consumer");
    const consumer = new AmqpConsumer(
      config.amqp.queues.outgoing,
      amqpConnectionManager
    );
    await consumer.consume(async (data) => {
      if (!data || typeof data.to !== "string" || typeof data.message !== "string") {
        logger5.error(
          { receivedData: data },
          "Invalid message format received from outgoing queue"
        );
        return;
      }
      await sender.send(data.to, data.message);
    });
    healthMonitor.registerService("whatsapp", async () => {
      return baileysClientWrapper.getConnectionState();
    });
    healthMonitor.registerService("amqp", async () => {
      try {
        const channel = await amqpConnectionManager?.getChannel();
        return !!channel;
      } catch (error) {
        logger5.warn({ error }, "AMQP health check failed");
        return false;
      }
    });
    healthMonitor.start();
    gracefulShutdown2.setAmqpConnectionManager(amqpConnectionManager);
    gracefulShutdown2.registerDefaultHandlers();
    gracefulShutdown2.registerHandler(async () => {
      logger5.info("Closing WhatsApp connection...");
      const sock = baileysConnection.getSocket();
      if (sock) {
      }
      logger5.info("WhatsApp connection cleanup initiated.");
    }, "WhatsApp Connection");
    logger5.info("WhatsApp integration service started successfully");
    return {
      sender,
      receiver,
      consumer
    };
  } catch (error) {
    const appError = new AppError(
      "Failed to start WhatsApp integration service",
      error
    );
    logger5.error({ error: appError, cause: error }, appError.message);
    await amqpConnectionManager?.close().catch(
      (e) => logger5.error(
        { error: e },
        "Error closing AMQP connection during startup failure"
      )
    );
    throw appError;
  }
}
(async () => {
  try {
    await startWhatsAppIntegration();
  } catch (error) {
    logger5.fatal("Service failed to start. Exiting.");
    process.exit(1);
  }
})();
export {
  startWhatsAppIntegration
};
