import { IMessageSender } from "../interfaces/IMessageSender";

export async function handleIncomingMessage(
  sender: IMessageSender,
  data: { to: string; message: string }
) {
  await sender.send(data.to, data.message);
}
