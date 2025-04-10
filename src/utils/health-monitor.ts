import express, { Request, Response, Application } from "express";
import { createLogger } from "./logger";
import { config } from "../config/config";

interface ServiceStatus {
  service: string;
  status: "up" | "down";
  lastChecked: Date;
  details?: any;
}

class HealthMonitor {
  private app: Application = express();
  private port = config.health.port;
  private logger = createLogger("HealthMonitor");
  private serviceStatuses: Map<string, ServiceStatus> = new Map();

  constructor() {
    this.setupRoutes();
  }

  private setupRoutes() {
    this.app.get("/health", (_: Request, res: Response) => {
      const statuses = Array.from(this.serviceStatuses.values());
      const allServicesUp = statuses.every((s) => s.status === "up");

      res.status(allServicesUp ? 200 : 503).json({
        status: allServicesUp ? "healthy" : "unhealthy",
        timestamp: new Date().toISOString(),
        services: statuses,
      });
    });

    // @ts-ignore
    this.app.get("/health/:service", (req, res) => {
      const service = this.serviceStatuses.get(req.params.service);

      if (!service) {
        return res.status(404).json({
          error: `Service ${req.params.service} not found`,
        });
      }

      res.status(service.status === "up" ? 200 : 503).json(service);
    });
  }

  public start() {
    this.app.listen(this.port, () => {
      this.logger.info(
        `Health check endpoint listening at http://localhost:${this.port}/health`
      );
    });
  }

  public registerService(
    service: string,
    checkFn: () => Promise<boolean>,
    interval = 60000
  ) {
    this.serviceStatuses.set(service, {
      service,
      status: "down",
      lastChecked: new Date(),
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

  private updateStatus(service: string, isUp: boolean, details?: any) {
    const currentStatus = this.serviceStatuses.get(service);
    const newStatus = {
      service,
      status: isUp ? ("up" as const) : ("down" as const),
      lastChecked: new Date(),
      details,
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
}

export const healthMonitor = new HealthMonitor();
