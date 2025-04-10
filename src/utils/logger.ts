import pino from "pino";
import dotenv from "dotenv";

dotenv.config();

const logLevel = process.env.LOG_LEVEL || "info";

console.log("Log level set to:", logLevel);

export const logger = pino({
  level: logLevel,
  transport:
    process.env.LOG_PRETTY === "true" ? { target: "pino-pretty" } : undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});

export const createLogger = (component: string) => {
  console.log("Creating logger for component:", component);
  return logger.child({ component });
};
