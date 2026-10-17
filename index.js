// Import required modules
const express = require('express');  // Express is a minimal Node.js framework for building web applications.
const cors = require('cors');  // CORS (Cross-Origin Resource Sharing) middleware for handling cross-origin requests.
const amqp = require('amqplib');  // AMQP client library for communicating with RabbitMQ (promise API).
require('dotenv').config();  // Load .env when present; existing environment variables take precedence.

// Configure the external broker and listening port from the environment (12-Factor III).
// RabbitMQ is an attached resource (12-Factor IV): only the connection string changes between local and Azure.
const RABBITMQ_CONNECTION_STRING = process.env.RABBITMQ_CONNECTION_STRING || 'amqp://localhost';
const PORT = process.env.PORT || 4000;
const QUEUE = 'order_queue';  // The queue that order-service publishes to.
const RETRY_DELAY_MS = 5000;  // Wait 5 seconds before reconnecting to RabbitMQ.

// Store consumed orders in memory.
// Run one instance with one consumer; the data resets when the service restarts.
const orders = [];
let rabbitConnected = false;

const round2 = (n) => Math.round(n * 100) / 100;  // Round money values to 2 decimal places.

// Connect to RabbitMQ and consume orders from the queue
// This is a work queue with one push-based consumer: RabbitMQ delivers each order as soon as it arrives.
async function startConsumer() {
  try {
    const connection = await amqp.connect(RABBITMQ_CONNECTION_STRING);
    connection.on('error', (err) => console.error('RabbitMQ connection error:', err.message));

    // If the connection closes (for example, RabbitMQ restarts), try again after a delay.
    connection.on('close', () => {
      rabbitConnected = false;
      console.error(`RabbitMQ connection closed, retrying in ${RETRY_DELAY_MS / 1000}s`);
      setTimeout(startConsumer, RETRY_DELAY_MS);
    });

    const channel = await connection.createChannel();

    // Durable queues survive restarts. The settings must match order-service, or the declaration fails.
    await channel.assertQueue(QUEUE, { durable: true });

    // Prefetch 1: RabbitMQ sends at most one unacknowledged order at a time.
    await channel.prefetch(1);
    rabbitConnected = true;
    console.log(`Waiting for orders in ${QUEUE}`);

    // Push consumer: RabbitMQ calls this function for each order, so the service never polls the queue.
    await channel.consume(QUEUE, (msg) => {
      if (msg === null) return;  // The broker cancelled the consumer.
      try {
        const order = JSON.parse(msg.content.toString());
        if (!order.product || !order.product.name || typeof order.quantity !== 'number') {
          throw new Error('missing product name or quantity');
        }
        orders.push({ ...order, receivedAt: new Date().toISOString() });
        console.log('Consumed order:', order.product.name, 'x', order.quantity);

        // Manual acknowledgement: confirm the order only after it is stored.
        // If the service stops before this line, RabbitMQ puts the order back in the queue.
        channel.ack(msg);
      } catch (err) {
        // A malformed message will never parse, so reject it without requeueing to avoid an endless loop.
        console.error('Rejected message:', err.message);
        channel.nack(msg, false, false);
      }
    }, { noAck: false });  // noAck: false turns on manual acknowledgements.
  } catch (err) {
    // RabbitMQ is not reachable yet (for example, the VM is still starting), so try again later.
    console.error(`Cannot connect to RabbitMQ (${err.message || err.code}), retrying in ${RETRY_DELAY_MS / 1000}s`);
    setTimeout(startConsumer, RETRY_DELAY_MS);
  }
}

// totalPrice is sent by store-front; fall back to price x quantity if it is missing.
const orderTotal = (o) => (typeof o.totalPrice === 'number' ? o.totalPrice : (o.product.price || 0) * o.quantity);

// Group orders by product name with the order count, quantity and revenue of each product.
function groupByProduct() {
  const groups = new Map();
  for (const o of orders) {
    const name = o.product.name;
    const g = groups.get(name) || { productName: name, orderCount: 0, totalQuantity: 0, totalRevenue: 0 };
    g.orderCount += 1;
    g.totalQuantity += o.quantity;
    g.totalRevenue += orderTotal(o);
    groups.set(name, g);
  }
  return [...groups.values()];
}

const app = express();  // Create an Express application instance.

// Enable CORS (Cross-Origin Resource Sharing) for all routes
// This allows the API to accept requests from other origins (e.g., a browser).
app.use(cors());

// Define a GET route for the health check
// It reports whether the service is up and connected to RabbitMQ.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', rabbitmq: rabbitConnected ? 'connected' : 'disconnected', ordersConsumed: orders.length });
});

// Define a GET route that lists all consumed orders
app.get('/orders', (req, res) => {
  res.json(orders);
});

// Define a GET route for the summary: total orders, total revenue and average order value
app.get('/analytics/summary', (req, res) => {
  const totalOrders = orders.length;
  const totalRevenue = orders.reduce((sum, o) => sum + orderTotal(o), 0);
  res.json({
    totalOrders,
    totalRevenue: round2(totalRevenue),
    averageOrderValue: totalOrders ? round2(totalRevenue / totalOrders) : 0,
  });
});

// Define a GET route for orders grouped by product name, with count and revenue
app.get('/analytics/products', (req, res) => {
  res.json(groupByProduct().map(({ productName, orderCount, totalRevenue }) => ({
    productName, orderCount, totalRevenue: round2(totalRevenue),
  })));
});

// Define a GET route for the top 3 products ranked by total quantity sold
app.get('/analytics/top-products', (req, res) => {
  res.json(groupByProduct()
    .sort((a, b) => b.totalQuantity - a.totalQuantity)
    .slice(0, 3)
    .map(({ productName, totalQuantity }) => ({ productName, totalQuantity })));
});

// Start the server, then connect to RabbitMQ
app.listen(PORT, () => {
  console.log(`Order analytics service is running on http://localhost:${PORT}`);
  startConsumer();
});
