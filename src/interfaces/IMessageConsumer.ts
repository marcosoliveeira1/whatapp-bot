export interface IMessageConsumer {
  consume(callback: (data: any) => Promise<void>): Promise<void>;
}
