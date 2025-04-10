import { IMessagePublisher } from "../interfaces/IMessagePublisher";

export async function handleReceivedMessage(
  publisher: IMessagePublisher,
  data: { from: string; message: string; timestamp: number }
) {
  await publisher.publish("message_received", data);
}
