import client, { Channel, ChannelModel } from "amqplib";
import { createLogger } from "./logger";
import { config } from "../config/config";

export class AmqpConnectionManager {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private logger = createLogger("AmqpConnectionManager");
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = config.amqp.reconnectAttempts;
  private reconnectDelay = config.amqp.reconnectDelay;

  async getChannel(): Promise<Channel> {
    if (!this.connection || !this.channel) {
      await this.connect();
    }
    return this.channel!;
  }

  async connect(): Promise<void> {
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

  private reconnect(): void {
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
    const delay =
      this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);

    this.logger.info(
      `Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`
    );

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((err) => {
        this.logger.error({ err }, "Reconnection attempt failed");
      });
    }, delay);
  }

  async close(): Promise<void> {
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
}
