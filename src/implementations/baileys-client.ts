import {
  makeWASocket,
  WASocket,
  useMultiFileAuthState,
  DisconnectReason,
  ConnectionState,
} from "baileys";
import { Boom } from "@hapi/boom";
import { createLogger } from "../utils/logger";
import { config } from "../config/config";
import { IQRCodeGenerator } from "../utils/qrcode-generator";

const logger = createLogger("BaileysClient");

export class BaileysClient {
  private sock: WASocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private connectionState: Partial<ConnectionState> = {};
  private isConnected = false;

  constructor(private qrCodeGenerator: IQRCodeGenerator) {}

  async connect(): Promise<WASocket> {
    try {
      logger.info("Connecting to WhatsApp");

      const { state, saveCreds } = await useMultiFileAuthState(
        config.whatsapp.sessionPath
      );

      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger,
      });

      this.sock.ev.on("creds.update", saveCreds);

      this.sock.ev.on("connection.update", (update) => {
        this.handleConnectionUpdate(update);
      });

      return this.sock;
    } catch (error) {
      logger.error({ error, message: (error as Error).message }, "Failed to connect to WhatsApp");
      this.scheduleReconnect();
      throw error;
    }
  }

  private async handleConnectionUpdate(update: Partial<ConnectionState>) {
    const { connection, lastDisconnect, qr } = update;
    this.connectionState = { ...this.connectionState, ...update };
    
    if (qr) {
      logger.info("QR code generated, please scan with your phone");
      logger.info(await this.qrCodeGenerator.generateQRCode(qr));
    }

    if (connection === "close") {
      const shouldReconnect =
        (lastDisconnect?.error as Boom)?.output?.statusCode !==
        DisconnectReason.loggedOut;

      if (shouldReconnect) {
        logger.warn("Connection closed, attempting to reconnect");
        this.scheduleReconnect();
      } else {
        logger.error(
          "Connection closed due to logout, manual reconnection required"
        );
        this.isConnected = false;
      }
    } else if (connection === "open") {
      logger.info("Connected to WhatsApp");
      this.isConnected = true;
      this.reconnectAttempts = 0;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error(
        `Maximum reconnection attempts (${this.maxReconnectAttempts}) reached`
      );
      process.exit(1);
      return;
    }

    this.reconnectAttempts++;
    const delay =
      config.whatsapp.reconnectInterval *
      Math.pow(1.5, this.reconnectAttempts - 1);

    logger.info(
      `Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`
    );

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((err) => {
        logger.error({ err }, "Reconnection attempt failed");
      });
    }, delay);
  }

  public getConnectionState(): boolean {
    return this.isConnected;
  }

  public getSocket(): WASocket {
    if (!this.sock) {
      throw new Error("WhatsApp connection not initialized");
    }
    return this.sock;
  }
}