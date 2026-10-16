# Order Analytics Service

Consumes orders from the RabbitMQ queue `order_queue` (published by `order-service`) and serves analytics over REST. Node.js + Express, port 4000.

## Endpoints

| Method | Endpoint | Returns |
| --- | --- | --- |
| GET | `/health` | Service status and RabbitMQ connection state |
| GET | `/orders` | All consumed orders |
| GET | `/analytics/summary` | Total orders, total revenue, average order value |
| GET | `/analytics/products` | Order count and revenue per product |
| GET | `/analytics/top-products` | Top 3 products by quantity sold |

## Run locally

```bash
cp .env.example .env
```

```bash
npm install
```

```bash
npm start
```

## Configuration (12-Factor III and IV)

| Variable | Default | Meaning |
| --- | --- | --- |
| `RABBITMQ_CONNECTION_STRING` | `amqp://localhost` | RabbitMQ connection string (attached resource) |
| `PORT` | `4000` | HTTP port; App Service sets it automatically |

## RabbitMQ consumer pattern

Push-based consumer (`channel.consume`) with manual acknowledgements and `prefetch(1)`:

- **Push, not polling:** RabbitMQ delivers each order as soon as it arrives, so analytics stay current without repeated `basic.get` calls.
- **Manual ack after storing:** an order is acknowledged only after it is saved in memory, so a crash before that point leaves it in the queue.
- **prefetch(1):** at most one unacknowledged message at a time, which is enough for this load and keeps processing in order.
- **Malformed messages** are rejected without requeue so one bad message cannot loop forever.
- The queue is declared `durable: true` to match `order-service`. If RabbitMQ is down or restarts, the service retries every 5 seconds.

Storage is in memory (allowed by the handout): run one instance; data resets on restart.
