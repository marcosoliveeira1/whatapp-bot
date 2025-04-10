import { IMessagePublisher } from "../interfaces/IMessagePublisher";
import type { WASocket, WAMessage, proto } from "baileys";
import { createLogger } from "../utils/logger";
import { jidNormalizedUser } from "baileys";

export class BaileysReceiver {
  private logger = createLogger("BaileysReceiver");

  constructor(
    private sock: WASocket,
    private publisher: IMessagePublisher,
    private incomingQueueName: string
  ) {
    this.logger.info("Initializing BaileysReceiver");
    this.init();
  }

  private init() {
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

  private async handleMessage(message: WAMessage): Promise<void> {
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
    const from = jidNormalizedUser(senderJid);

    const text =
      message.message.conversation ||
      message.message.extendedTextMessage?.text ||
      "";
    if (!text) {
      this.logger.debug(
        { msgId: message.key.id, from },
        "Ignoring message without text content"
      );
      return;
    }

    const timestamp =
      typeof message.messageTimestamp === "number"
        ? message.messageTimestamp * 1000
        : typeof message.messageTimestamp === "object" &&
          message.messageTimestamp !== null &&
          typeof message.messageTimestamp.toNumber === "function"
        ? message.messageTimestamp.toNumber() * 1000
        : Date.now();

    this.logger.info(
      { from, messageId: message.key.id },
      "Received WhatsApp message"
    );
    this.logger.debug({ from, text, timestamp }, "Processing incoming message");

    try {
      await this.publisher.publish(this.incomingQueueName, {
        from: from,
        message: text,
        timestamp: timestamp,
        originalMessageId: message.key.id,
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
}
