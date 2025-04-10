import { Channel, ConsumeMessage } from "amqplib";
import { IMessageConsumer } from "../interfaces/IMessageConsumer";
import { createLogger } from "../utils/logger";
import { AmqpConnectionManager } from "../utils/amqp-connection-manager";

export class AmqpConsumer implements IMessageConsumer {
  private logger = createLogger("AmqpConsumer");
  private channel: Channel | null = null;

  constructor(
    private queue: string,
    private amqpConnectionManager: AmqpConnectionManager
  ) {
    this.logger.debug(`Creating consumer for queue: ${this.queue}`);
  }

  async consume(callback: (data: any) => Promise<void>): Promise<void> {
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
        async (msg: ConsumeMessage | null) => {
          if (!msg) {
            this.logger.warn(
              `Consumer for queue ${this.queue} received null message (channel closed?)`
            );

            return;
          }

          let data: any;
          try {
            data = JSON.parse(msg.content.toString());
            this.logger.debug(
              { data, msgId: msg.properties.messageId },
              `Received message from queue: ${this.queue}`
            );
            await callback(data);
            this.channel!.ack(msg);
            this.logger.debug(
              { msgId: msg.properties.messageId },
              "Message processed and acknowledged successfully"
            );
          } catch (error) {
            this.logger.error(
              {
                error,
                msg: msg.content.toString(),
                msgId: msg.properties.messageId,
              },
              "Error processing message"
            );

            this.channel!.nack(msg, false, false);
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

  async stop(): Promise<void> {
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
}
