import dotenv from "dotenv";
import { z } from "zod";
import { createLogger } from "../utils/logger";

dotenv.config();

const logger = createLogger("Config");

const configSchema = z.object({
  amqp: z.object({
    url: z.string().min(1, "AMQP_URL is required"),
    reconnectAttempts: z.coerce.number().default(10),
    reconnectDelay: z.coerce.number().default(5000),
    queues: z.object({
      outgoing: z.string().min(1, "AMQP_QUEUE_OUTGOING is required"),
      incoming: z.string().min(1, "AMQP_QUEUE_INCOMING is required"),
    }),
  }),
  logging: z.object({
    level: z.string().default("info"),
    prettyPrint: z.boolean().default(process.env.NODE_ENV !== "production"),
  }),
  whatsapp: z.object({
    sessionPath: z.string().default("auth"),
    reconnectInterval: z.coerce.number().default(30000),
  }),
  health: z.object({
    port: z.coerce.number().default(3000),
  }),
});

const parsedConfig = configSchema.safeParse({
  amqp: {
    url: process.env.AMQP_URL,
    reconnectAttempts: process.env.AMQP_RECONNECT_ATTEMPTS ?? 10,
    reconnectDelay: process.env.AMQP_RECONNECT_DELAY ?? 5000,
    queues: {
      outgoing: process.env.AMQP_QUEUE_OUTGOING ?? "messages-received",
      incoming: process.env.AMQP_QUEUE_INCOMING ?? "messages-sent",
    },
  },
  logging: {
    level: process.env.LOG_LEVEL,
    prettyPrint: process.env.NODE_ENV !== "production",
  },
  whatsapp: {
    sessionPath: process.env.WHATSAPP_SESSION_PATH ?? "auth",
    reconnectInterval: process.env.WHATSAPP_RECONNECT_INTERVAL ?? 30000,
  },
  health: {
    port: process.env.HEALTH_PORT ?? 3000,
  },
});

if (!parsedConfig.success) {
  const flatErrors = parsedConfig.error.flatten().fieldErrors;

  const errorMessages = Object.entries(flatErrors)
    .map(([field, errors]) => `${field}: ${errors?.join(", ")}`)
    .join("\n");

  logger.fatal(
    { errors: errorMessages },
    "Failed to load configuration"
  );
  process.exit(1);
}

logger.info("Configuration loaded successfully");

export const config = parsedConfig.data;
