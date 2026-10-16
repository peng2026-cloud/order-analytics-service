// Order Analytics Service: consumes orders from RabbitMQ and serves analytics over REST.
const express = require('express');
const cors = require('cors');
const amqp = require('amqplib');
require('dotenv').config(); // Load .env when present; existing environment variables take precedence.

// Config comes from the environment (12-Factor III); RabbitMQ is an attached resource (IV).
const RABBITMQ_CONNECTION_STRING = process.env.RABBITMQ_CONNECTION_STRING || 'amqp://localhost';
const PORT = process.env.PORT || 4000;
const QUEUE = 'order_queue';
const RETRY_DELAY_MS = 5000;

// In-memory storage: one instance, one consumer, data resets on restart.
const orders = [];
let rabbitConnected = false;

const round2 = (n) => Math.round(n * 100) / 100;

// Push-based consumer (channel.consume) with manual acknowledgements.
// prefetch(1) gives one unacknowledged message at a time; an order is
// acknowledged only after it is stored, so a crash before storing leaves it in the queue.
async function startConsumer() {
  try {
    const connection = await amqp.connect(RABBITMQ_CONNECTION_STRING);
    connection.on('error', (err) => console.error('RabbitMQ connection error:', err.message));
    connection.on('close', () => {
      rabbitConnected = false;
      console.error(`RabbitMQ connection closed, retrying in ${RETRY_DELAY_MS / 1000}s`);
      setTimeout(startConsumer, RETRY_DELAY_MS);
    });

    const channel = await connection.createChannel();
    await channel.assertQueue(QUEUE, { durable: true }); // Must match order-service.
    await channel.prefetch(1);
    rabbitConnected = true;
    console.log(`Waiting for orders in ${QUEUE}`);

    await channel.consume(QUEUE, (msg) => {
      if (msg === null) return; // The broker cancelled the consumer.
      try {
        const order = JSON.parse(msg.content.toString());
        if (!order.product || !order.product.name || typeof order.quantity !== 'number') {
          throw new Error('missing product name or quantity');
        }
        orders.push({ ...order, receivedAt: new Date().toISOString() });
        console.log('Consumed order:', order.product.name, 'x', order.quantity);
        channel.ack(msg);
      } catch (err) {
        // A malformed message will never parse, so drop it instead of requeueing it forever.
        console.error('Rejected message:', err.message);
        channel.nack(msg, false, false);
      }
    }, { noAck: false });
  } catch (err) {
    console.error(`Cannot connect to RabbitMQ (${err.message || err.code}), retrying in ${RETRY_DELAY_MS / 1000}s`);
    setTimeout(startConsumer, RETRY_DELAY_MS);
  }
}

// totalPrice is sent by store-front; fall back to price x quantity if it is missing.
const orderTotal = (o) => (typeof o.totalPrice === 'number' ? o.totalPrice : (o.product.price || 0) * o.quantity);

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

const app = express();
app.use(cors());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', rabbitmq: rabbitConnected ? 'connected' : 'disconnected', ordersConsumed: orders.length });
});

app.get('/orders', (req, res) => {
  res.json(orders);
});

app.get('/analytics/summary', (req, res) => {
  const totalOrders = orders.length;
  const totalRevenue = orders.reduce((sum, o) => sum + orderTotal(o), 0);
  res.json({
    totalOrders,
    totalRevenue: round2(totalRevenue),
    averageOrderValue: totalOrders ? round2(totalRevenue / totalOrders) : 0,
  });
});

app.get('/analytics/products', (req, res) => {
  res.json(groupByProduct().map(({ productName, orderCount, totalRevenue }) => ({
    productName, orderCount, totalRevenue: round2(totalRevenue),
  })));
});

app.get('/analytics/top-products', (req, res) => {
  res.json(groupByProduct()
    .sort((a, b) => b.totalQuantity - a.totalQuantity)
    .slice(0, 3)
    .map(({ productName, totalQuantity }) => ({ productName, totalQuantity })));
});

app.listen(PORT, () => {
  console.log(`Order analytics service is running on http://localhost:${PORT}`);
  startConsumer();
});
