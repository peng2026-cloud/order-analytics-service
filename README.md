# Order Analytics Service

CST8915 Midterm Project: extends the Algonquin Pet Store with a service that consumes orders from the RabbitMQ queue `order_queue` (published by `order-service`) and serves analytics over REST. Node.js + Express, port 4000.

## Demo video

YouTube (unlisted): _link to be added after recording_

## Architecture

![Architecture diagram](docs/architecture.png)

Source: [docs/architecture.drawio](docs/architecture.drawio)

1. The customer opens `store-front` (Vue.js on Azure Static Web Apps). The browser calls the APIs directly; their URLs come from the `VUE_APP_` variables set in the build workflow.
2. `GET /products` goes to `product-service`; `POST /orders` goes to `order-service`.
3. `order-service` publishes each order as JSON to the durable queue `order_queue` on RabbitMQ (default exchange, `sendToQueue`).
4. `order-analytics-service` consumes the queue, stores the orders in memory and serves the analytics endpoints.

## Service repositories

| Service | Repository |
| --- | --- |
| order-analytics-service | https://github.com/peng2026-cloud/order-analytics-service (this repo) |
| order-service | https://github.com/peng2026-cloud/order-service |
| product-service | https://github.com/peng2026-cloud/product-service |
| store-front | https://github.com/peng2026-cloud/store-front |

## Endpoints

| Method | Endpoint | Returns |
| --- | --- | --- |
| GET | `/health` | Service status and RabbitMQ connection state |
| GET | `/orders` | All consumed orders |
| GET | `/analytics/summary` | Total orders, total revenue, average order value |
| GET | `/analytics/products` | Order count and revenue per product |
| GET | `/analytics/top-products` | Top 3 products by quantity sold |

## RabbitMQ consumer pattern

Push-based consumer (`channel.consume`) with manual acknowledgements and `prefetch(1)`:

- **Push, not polling:** RabbitMQ delivers each order as soon as it arrives, so analytics stay current without repeated `basic.get` calls.
- **Manual ack after storing:** an order is acknowledged only after it is saved in memory, so a crash before that point leaves it in the queue.
- **prefetch(1):** at most one unacknowledged message at a time, which is enough for this load and keeps processing in order.
- **Malformed messages** are rejected without requeue so one bad message cannot loop forever.
- The queue is declared `durable: true` to match `order-service`. If RabbitMQ is down or restarts, the service retries every 5 seconds.

Storage is in memory (allowed by the handout): one instance and one consumer; data resets on restart.

## 12-Factor App (I to IV)

| Factor | How |
| --- | --- |
| I. Codebase | This service has its own repository; each of the other services has its own too |
| II. Dependencies | Declared in `package.json`, locked in `package-lock.json` |
| III. Config | `RABBITMQ_CONNECTION_STRING` and `PORT` come from environment variables (`.env` locally, App settings on Azure); `.env.example` documents them |
| IV. Backing services | RabbitMQ is attached through the connection string only: Docker on localhost or the Azure VM, with no code change |

| Variable | Default | Meaning |
| --- | --- | --- |
| `RABBITMQ_CONNECTION_STRING` | `amqp://localhost` | RabbitMQ connection string |
| `PORT` | `4000` | HTTP port; App Service sets it automatically |

## Run locally

Start RabbitMQ:

```bash
docker run -d --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:4-management
```

Install dependencies:

```bash
npm install
```

Start the service (defaults to `amqp://localhost` and port 4000):

```bash
npm start
```

Then start `product-service` (3030), `order-service` (3000) and `store-front` (8080), place orders at http://localhost:8080 and check http://localhost:4000/analytics/summary.

## Azure deployment

| Component | Azure service | Region |
| --- | --- | --- |
| RabbitMQ | VM `rabbitmq-vm` (Ubuntu 24.04, Standard_B2ls_v2) | West US 2 |
| order-service | App Service `order-service-midterm` (Node 24 LTS) | Canada Central |
| product-service | App Service `product-service-midterm` (Python 3.12) | Canada Central |
| order-analytics-service | App Service `order-analytics-service-midterm` (Node 24 LTS) | Canada Central |
| store-front | Static Web App `store-front-midterm` (Free) | West US 2 |

- The three App Services share one Free F1 Linux plan and deploy from GitHub Actions (Deployment Center, basic authentication).
- `RABBITMQ_CONNECTION_STRING` is an App setting on `order-service-midterm` and `order-analytics-service-midterm`.
- The VM's NSG allows port 5672 only from the App Services' possible outbound IP addresses.
- `store-front` builds with GitHub Actions; the workflow sets `VUE_APP_ORDER_SERVICE_URL` and `VUE_APP_PRODUCT_SERVICE_URL` to the App Service URLs.

## Challenges and lessons learned

- **Regions:** the Azure for Students policy allows only a few regions, and Static Web Apps defaults to East US 2, which failed validation; West US 2 works. The VM is in West US 2 because B-series v2 sizes are available there, and the App Services are in Canada Central because the F1 quota in West US 2 is 0.
- **App Service outbound IPs:** RabbitMQ must allow every address in `possibleOutboundIpAddresses`, not only the current `outboundIpAddresses`.
- **Free tier sleep:** F1 apps idle out, which clears the in-memory analytics, so the service is warmed up before a demo.

## Contributions

| Member | Contribution |
| --- | --- |
| Peng Wang | Analytics service, local integration test, Azure deployment (VM, App Services, Static Web App), architecture diagram, README |

## Use of AI

Claude (Anthropic) was used to help write and review the service code, draw the architecture diagram and draft this README. All code was run and tested locally and on Azure, and the results were checked by hand.
