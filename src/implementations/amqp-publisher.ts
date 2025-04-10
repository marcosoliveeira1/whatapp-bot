import { IMessagePublisher } from "../interfaces/IMessagePublisher";
import { AmqpConnectionManager } from "../utils/amqp-connection-manager";
import { createLogger } from "../utils/logger";
const logger = createLogger("AmqpPublisher");

export class AmqpPublisher implements IMessagePublisher {
  constructor(private amqpConnectionManager: AmqpConnectionManager) {}

  async publish(queueName: string, payload: any): Promise<void> {
    let channel;
    try {
      logger.debug(
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
        logger.debug(
          { queue: queueName, payload },
          "Message sent to queue successfully"
        );
      } else {
        logger.warn(
          { queue: queueName },
          "Failed to send message to queue (possibly backpressure)"
        );
      }
    } catch (error) {
      logger.error(
        { error, queue: queueName, payload },
        "Error publishing message to AMQP queue"
      );
      throw error;
    }
  }
}
