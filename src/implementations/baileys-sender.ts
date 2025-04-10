import { IMessageSender } from "../interfaces/IMessageSender";
import type { WASocket } from "baileys";
import { createLogger } from "../utils/logger";
import { jidNormalizedUser } from "baileys";

export class BaileysSender implements IMessageSender {
  private logger = createLogger("BaileysSender");

  constructor(private sock: WASocket) {
    this.logger.info("BaileysSender initialized");
  }

  async send(to: string, message: string): Promise<void> {
    try {
      let recipientJid = to;
      if (!recipientJid.includes("@")) {
        recipientJid = `${to}@s.whatsapp.net`;
      }

      recipientJid = jidNormalizedUser(recipientJid);

      this.logger.info({ to: recipientJid }, "Sending WhatsApp message");
      this.logger.debug({ to: recipientJid, message }, "Message details");

      const result = await this.sock.sendMessage(recipientJid, {
        text: message,
      });

      this.logger.info(
        {
          to: recipientJid,
          messageId: result?.key?.id,
        },
        "WhatsApp message sent successfully"
      );
    } catch (error: any) {
      const errorMessage = error?.message || "Unknown error";
      const errorDetails = error?.data || error;
      this.logger.error(
        { error: errorMessage, details: errorDetails, to },
        "Failed to send WhatsApp message"
      );
      throw error;
    }
  }
}
