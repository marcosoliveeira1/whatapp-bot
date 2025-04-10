import { AmqpConnectionManager } from "./amqp-connection-manager";
import { createLogger } from "./logger";

type ShutdownHandler = () => Promise<void>;

export class GracefulShutdown {
  private logger = createLogger("GracefulShutdown");
  private handlers: ShutdownHandler[] = [];
  private shuttingDown = false;
  private shutdownTimeout = parseInt(
    process.env.SHUTDOWN_TIMEOUT_MS || "10000"
  );
  private amqpConnectionManager: AmqpConnectionManager | null = null;

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

  public setAmqpConnectionManager(
    amqpConnectionManager: AmqpConnectionManager
  ): void {
    this.amqpConnectionManager = amqpConnectionManager;
  }

  public registerHandler(handler: ShutdownHandler, name?: string): void {
    this.handlers.push(handler);
    this.logger.debug(`Registered shutdown handler${name ? ": " + name : ""}`);
  }

  public registerDefaultHandlers(): void {
    this.registerHandler(async () => {
      await this?.amqpConnectionManager?.close();
    }, "AMQP Connection");

    this.logger.info("Registered default shutdown handlers");
  }

  private async shutdown(exitCode: number = 0): Promise<void> {
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
}
