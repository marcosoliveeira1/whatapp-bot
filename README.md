# WhatsApp Integration Service

A Node.js service that integrates WhatsApp messaging with AMQP messaging queues, allowing bidirectional communication between WhatsApp and other systems through a message broker.

## Overview

This service serves as a bridge between WhatsApp and other applications by:
- Receiving messages from WhatsApp and publishing them to an AMQP queue
- Consuming messages from an AMQP queue and sending them to WhatsApp recipients

The service uses [Baileys](https://github.com/whiskeysockets/baileys) for WhatsApp connectivity and [amqplib](https://github.com/amqp-node/amqplib) for AMQP messaging.

## Features

- **WhatsApp Integration**: Connect to WhatsApp Web via QR code authentication
- **Message Processing**: Bidirectional message handling between WhatsApp and AMQP
- **Health Monitoring**: HTTP endpoint to check the health of service components
- **Graceful Shutdown**: Proper cleanup of resources upon service termination
- **Logging**: Structured logging with configurable levels
- **Error Handling**: Comprehensive error handling and recovery
- **Automatic Reconnection**: Retry mechanisms for both WhatsApp and AMQP connections

## Architecture

The service follows a modular architecture with clean separation of concerns:

- **Interfaces**: Define contracts for messaging components
- **Implementations**: Concrete implementations of the interfaces
- **Utils**: Helper utilities for logging, health monitoring, etc.
- **Config**: Configuration management with validation

## Prerequisites

- Node.js 16 or higher
- RabbitMQ or any other AMQP-compatible message broker
- A WhatsApp account for authentication

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd whatsapp-integration-service
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file based on the example:
   ```bash
   cp .env.example .env
   ```

4. Edit the `.env` file with your configuration

## Configuration

The service is configured using environment variables. You can set these in a `.env` file or directly in your environment.

### Required Environment Variables

- `AMQP_URL`: URL for the AMQP broker (e.g., `amqp://guest:guest@localhost:5672`)
- `AMQP_QUEUE_OUTGOING`: Queue name for messages to be sent to WhatsApp
- `AMQP_QUEUE_INCOMING`: Queue name for messages received from WhatsApp

### Optional Environment Variables

- `AMQP_RECONNECT_ATTEMPTS`: Maximum reconnection attempts for AMQP (default: 10)
- `AMQP_RECONNECT_DELAY`: Base delay between reconnection attempts in milliseconds (default: 5000)
- `LOG_LEVEL`: Logging level (default: "info")
- `LOG_PRETTY`: Enable pretty printing of logs (default: true in development, false in production)
- `WHATSAPP_SESSION_PATH`: Path to store WhatsApp session files (default: "auth")
- `WHATSAPP_RECONNECT_INTERVAL`: Base delay between reconnection attempts in milliseconds (default: 30000)
- `HEALTH_PORT`: Port for health check HTTP server (default: 3000)
- `SHUTDOWN_TIMEOUT_MS`: Maximum time to wait for graceful shutdown in milliseconds (default: 10000)

## Usage

### Starting the Service

```bash
npm start
```

On first run, the service will display a QR code in the terminal. Scan this with your WhatsApp mobile app to authenticate.

### Message Format

#### Outgoing Messages (To WhatsApp)

Messages consumed from the outgoing queue should have the following format:

```json
{
  "to": "1234567890", // Phone number with or without @s.whatsapp.net
  "message": "Hello from the integration service!"
}
```

#### Incoming Messages (From WhatsApp)

Messages published to the incoming queue have the following format:

```json
{
  "from": "1234567890@s.whatsapp.net", // Normalized JID
  "message": "Hello from WhatsApp!",
  "timestamp": 1617823456789, // Timestamp in milliseconds
  "originalMessageId": "ABCDEF123456" // WhatsApp message ID
}
```

### Health Checks

The service exposes health check endpoints:

- `GET /health`: Overall health status of all components
- `GET /health/{service}`: Health status of a specific service (e.g., "whatsapp" or "amqp")

## Development

### Project Structure

```
src/
├── config/
│   └── config.ts         # Configuration management
├── implementations/
│   ├── amqp-consumer.ts  # AMQP message consumer
│   ├── amqp-publisher.ts # AMQP message publisher
│   ├── baileys-client.ts # WhatsApp connection management
│   ├── baileys-receiver.ts # WhatsApp message receiver
│   └── baileys-sender.ts # WhatsApp message sender
├── interfaces/
│   ├── IMessageConsumer.ts # Message consumer interface
│   ├── IMessagePublisher.ts # Message publisher interface
│   └── IMessageSender.ts # Message sender interface
├── usecases/
│   ├── handleIncomingMessage.ts # Handle messages to be sent to WhatsApp
│   └── handleReceivedMessage.ts # Handle messages received from WhatsApp
├── utils/
│   ├── amqp-connection-manager.ts # AMQP connection management
│   ├── graceful-shutdown.ts # Graceful shutdown handling
│   ├── health-monitor.ts # Health monitoring
│   ├── logger.ts # Logging utility
│   └── qrcode-generator.ts # QR code generation
└── app.ts               # Application entry point
```

### Building

```bash
npm run build
```

### Running Tests

```bash
npm test
```

## Troubleshooting

### Common Issues

1. **QR Code Authentication Fails**:
   - Delete the `auth` directory (or the configured session path)
   - Restart the service and try again

2. **AMQP Connection Errors**:
   - Verify the AMQP_URL is correct
   - Check that the RabbitMQ server is running
   - Ensure the user has the correct permissions

3. **WhatsApp Connection Issues**:
   - Check internet connectivity
   - Verify the WhatsApp account is active
   - Make sure the phone has a stable connection

### Logs

The service uses structured logging. Adjust the log level for more detailed information:

```
LOG_LEVEL=debug npm start
```

## License

[License information]

## Contributing

[Contribution guidelines]