import * as qrcode from "qrcode";

export class QRCodeGenerator implements IQRCodeGenerator {
  private readonly qrCode: typeof qrcode;
  constructor() {
    this.qrCode = qrcode;
  }
  async generateQRCode(data: string) {
    return await this.qrCode.toString(data, { type: "terminal" });
  }
}
export interface IQRCodeGenerator {
  generateQRCode: (data: string) => Promise<string>;
}
