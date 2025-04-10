import { createLogger } from "./utils/logger";
import { AmqpConsumer } from "./implementations/amqp-consumer";
import { AmqpPublisher } from "./implementations/amqp-publisher";
import { BaileysSender } from "./implementations/baileys-sender";
import { BaileysReceiver } from "./implementations/baileys-receiver";
import { healthMonitor } from "./utils/health-monitor";
import { GracefulShutdown } from "./utils/graceful-shutdown";
import { AmqpConnectionManager } from "./utils/amqp-connection-manager";
import { config } from "./config/config";
import { BaileysClient } from "./implementations/baileys-client";
import { QRCodeGenerator } from "./utils/qrcode-generator";

const logger = createLogger("app");

const qrCodeGenerator = new QRCodeGenerator();
const baileysConnection = new BaileysClient(qrCodeGenerator);
const gracefulShutdown = new GracefulShutdown();
class AppError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = "AppError";
  }
}

let amqpConnectionManager: AmqpConnectionManager | null = null;

async function startWhatsAppIntegration() {
  logger.info("Starting WhatsApp integration service");

  try {
    const gracefulShutdown = new GracefulShutdown();

    amqpConnectionManager = new AmqpConnectionManager();

    logger.info("Initializing WhatsApp connection");
    const whatsAppClient = await baileysConnection.connect();
    const baileysClientWrapper = baileysConnection;

    const sender = new BaileysSender(whatsAppClient);
    const publisher = new AmqpPublisher(amqpConnectionManager);
    const receiver = new BaileysReceiver(
      whatsAppClient,
      publisher,
      config.amqp.queues.incoming
    );

    logger.info("Initializing message consumer");
    const consumer = new AmqpConsumer(
      config.amqp.queues.outgoing,
      amqpConnectionManager
    );
    await consumer.consume(async (data) => {
      if (
        !data ||
        typeof data.to !== "string" ||
        typeof data.message !== "string"
      ) {
        logger.error(
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
        logger.warn({ error }, "AMQP health check failed");
        return false;
      }
    });

    healthMonitor.start();

    gracefulShutdown.setAmqpConnectionManager(amqpConnectionManager);
    gracefulShutdown.registerDefaultHandlers();

    gracefulShutdown.registerHandler(async () => {
      logger.info("Closing WhatsApp connection...");

      const sock = baileysConnection.getSocket();
      if (sock) {
      }
      logger.info("WhatsApp connection cleanup initiated.");
    }, "WhatsApp Connection");

    logger.info("WhatsApp integration service started successfully");

    return {
      sender,
      receiver,
      consumer,
    };
  } catch (error) {
    const appError = new AppError(
      "Failed to start WhatsApp integration service",
      error as Error
    );
    logger.error({ error: appError, cause: error }, appError.message);

    await amqpConnectionManager
      ?.close()
      .catch((e) =>
        logger.error(
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
    logger.fatal("Service failed to start. Exiting.");
    process.exit(1);
  }
})();

export { startWhatsAppIntegration };
