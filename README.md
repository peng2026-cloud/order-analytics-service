# Order Analytics Service

CST8915 Midterm Project: a new service for the Algonquin Pet Store that consumes orders from the RabbitMQ queue `order_queue` and serves analytics over REST.

## Demo video

YouTube (unlisted): _link to be added after recording_

## 1. A brief overview of your order-analytics-service (language choice, architecture decisions)

**Language:** Node.js with Express, the same stack as `order-service`, and Azure App Service has a built-in Node runtime.

| Endpoint | Returns |
| --- | --- |
| `GET /health` | Service status and RabbitMQ connection state |
| `GET /orders` | All consumed orders |
| `GET /analytics/summary` | Total orders, total revenue, average order value |
| `GET /analytics/products` | Order count and revenue per product |
| `GET /analytics/top-products` | Top 3 products by quantity sold |

**Architecture decisions:**

- In-memory storage. As the project requirements say: "Use one application instance and one consumer process when using in-memory storage so all orders and analytics are held in the same process." The data resets after a restart.

**12-Factor App Compliance:**

| Factor | Requirement | How this service does it |
| --- | --- | --- |
| **I. Codebase** | Own GitHub repository for the order-analytics-service | https://github.com/peng2026-cloud/order-analytics-service |
| **II. Dependencies** | All dependencies declared in a manifest file (`package.json`, `requirements.txt`, etc.) | `package.json` |
| **III. Config** | RabbitMQ connection string and port configured via environment variables / `.env` file | `RABBITMQ_CONNECTION_STRING` and `PORT` |
| **IV. Backing Services** | RabbitMQ treated as an attached resource via connection string | Docker locally, the Azure VM on Azure, same code |

## 2. The RabbitMQ consumer pattern you chose and why

**Choice:** a push consumer. RabbitMQ sends each order to the service as soon as it arrives.

| Option | How it works | Chosen? |
| --- | --- | --- |
| Pull (`channel.get`) | The service keeps asking the queue for new orders. | No: wasted requests when the queue is empty, and orders wait for the next check. |
| Publish/subscribe | Each order is copied to every subscribed service. | No: only this service needs the orders. |
| **Push (`channel.consume`)** | RabbitMQ sends each order to the service as soon as it arrives. | **Yes:** no polling, no delay. |

The order is acknowledged only after it is stored ([index.js](index.js#L46-L64)), so if the service stops first, RabbitMQ puts the order back in the queue and nothing is lost.

## 3. A live demo of the application running locally: place orders, then show analytics endpoints

RabbitMQ runs in Docker (`rabbitmq:4-management`), and each service runs in its own terminal tab.

product-service on port 3030:

![product-service running locally](docs/screenshots/local-product-service.jpg)

order-service on port 3000:

![order-service running locally](docs/screenshots/local-order-service.jpg)

order-analytics-service on port 4000, connected to RabbitMQ:

![order-analytics-service waiting for orders](docs/screenshots/local-analytics-service.jpg)

store-front on port 8080:

![store-front running locally](docs/screenshots/local-store-front.jpg)

Place orders at http://localhost:8080, then check the analytics:

- http://localhost:4000/analytics/summary
- http://localhost:4000/analytics/products
- http://localhost:4000/analytics/top-products

An order placed locally:

![order placed locally](docs/screenshots/local-order-placed.jpg)

## 4. A live demo of the application running on Azure: show all deployed services, place orders, and verify analytics

| Component | Azure service | Region |
| --- | --- | --- |
| RabbitMQ | VM `rabbitmq-vm` | West US 2 |
| order-service | Azure App Service `order-service-midterm` | Canada Central |
| product-service | Azure App Service `product-service-midterm` | Canada Central |
| order-analytics-service | Azure App Service `order-analytics-service-midterm` | Canada Central |
| store-front | Azure Static Web Apps `store-front-midterm` | West US 2 |

Each service deploys from its GitHub repository with GitHub Actions. `RABBITMQ_CONNECTION_STRING` is an App setting, and the VM allows port 5672 only from the App Services.

![Azure resource group](docs/screenshots/azure-resource-group.jpg)

Place orders at https://orange-meadow-0c22c891e.1.azurestaticapps.net, then check the analytics:

- https://order-analytics-service-midterm-heaeadakgxb8f3eh.canadacentral-01.azurewebsites.net/analytics/summary
- https://order-analytics-service-midterm-heaeadakgxb8f3eh.canadacentral-01.azurewebsites.net/analytics/products
- https://order-analytics-service-midterm-heaeadakgxb8f3eh.canadacentral-01.azurewebsites.net/analytics/top-products

The analytics on Azure after two orders:

![summary on Azure](docs/screenshots/azure-summary.jpg)

![products on Azure](docs/screenshots/azure-products.jpg)

![top products on Azure](docs/screenshots/azure-top-products.jpg)

## 5. A walkthrough of your architecture diagram

![Architecture diagram](docs/architecture.png)

1. The customer opens `store-front` on Azure Static Web Apps.
2. The browser gets products from `product-service` and sends each order to `order-service`.
3. `order-service` publishes the order to the durable queue `order_queue` on the RabbitMQ VM.
4. `order-analytics-service` consumes the queue and serves the analytics endpoints.

## Service repositories

| Service | Repository |
| --- | --- |
| order-analytics-service | https://github.com/peng2026-cloud/order-analytics-service |
| order-service | https://github.com/peng2026-cloud/order-service |
| product-service | https://github.com/peng2026-cloud/product-service |
| store-front | https://github.com/peng2026-cloud/store-front |

## Contributions

| Member | Contribution |
| --- | --- |
| Peng Wang | Analytics service, local test, Azure deployment, architecture diagram, README |

## Use of AI

Claude (Anthropic) was used to help write and review the code, plan the Azure deployment and draft this README. All code was run and tested locally and on Azure, and the results were checked by hand.
