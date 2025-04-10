export interface IMessagePublisher {
  publish(event: string, payload: any): Promise<void>;
}
