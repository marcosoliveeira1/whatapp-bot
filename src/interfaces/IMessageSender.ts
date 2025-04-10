export interface IMessageSender {
  send(to: string, message: string): Promise<void>;
}
