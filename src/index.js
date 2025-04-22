const express = require('express');
const axios = require('axios');
const { createClient } = require('redis');
require('dotenv').config();

// App configuration
const PORT = process.env.PORT || 4000;
const RATE_LIMIT = 20;
const RATE_LIMIT_WINDOW = 3600; // 1 hour in seconds
const CACHE_EXPIRATION = 20; // Cache for 20 seconds

const app = express();

// Initialize Redis client using environment variables
const client = createClient({
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: process.env.REDIS_HOSTNAME,
    port: process.env.REDIS_PORT
  }
});

// Log Redis errors
client.on('error', (err) => {
  console.error('Redis connection error:', err);
});

// Apply rate limiter to all routes
app.use(limitRate);

// API route to fetch character data (cached using Redis)
app.get('/api/character', getCachedData);

/**
 * Redis caching logic
 * If data is found in Redis, return it.
 * Otherwise, fetch it from the external API and cache it.
 */
async function getCachedData(req, res) {
  try {
    const keyParam = 'character';

    // Check if data exists in Redis cache
    const cachedData = await client.get(keyParam);

    if (cachedData) {
      console.log(`Cache hit for ${keyParam}`);
      return res.json(JSON.parse(cachedData));
    }

    // If not cached, fetch data from external API
    console.log(`Cache miss for ${keyParam}, fetching from API`);
    const apiUrl = `${process.env.API_URL}${keyParam}`;
    const response = await axios.get(apiUrl);

    // Store the result in Redis with an expiration time
    await client.set(keyParam, JSON.stringify(response.data), {
      EX: CACHE_EXPIRATION
    });

    return res.json(response.data);
  } catch (error) {
    console.error('Error fetching data:', error);
    const statusCode = error.response?.status || 500;
    return res.status(statusCode).json({
      error: error.message,
      statusCode
    });
  }
}

/**
 * Middleware to limit the number of requests from each IP
 * Uses Redis to track request count within a time window
 */
async function limitRate(req, res, next) {
  try {
    // Get IP address
    const ip =
      req.headers['cf-connecting-ip'] ||
      (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
        .split(',')[0]
        .trim();

    const rateKey = `rate:${ip}`;

    // Increment the request count for this IP
    const requests = await client.incr(rateKey);

    // Set expiration if this is the first request
    if (requests === 1) {
      await client.expire(rateKey, RATE_LIMIT_WINDOW);
    }

    console.log(`IP ${ip} - Request count: ${requests}`);

    // Block the request if the limit is exceeded
    if (requests > RATE_LIMIT) {
      return res.status(429).json({
        status: 'error',
        requestCount: requests,
        message: 'Rate limit exceeded. Please try again later.'
      });
    }

    // Allow request
    next();
  } catch (error) {
    console.error('Rate limiting error:', error);
    next(); // Fail-open: allow request if Redis fails
  }
}

/**
 * Connect to Redis and start the Express server
 */
async function startServer() {
  try {
    await client.connect();
    console.log('Connected to Redis successfully');

    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

/**
 * Shutdown Redis connection
 */
process.on('SIGINT', async () => {
  try {
    await client.quit();
    console.log('Redis connection closed');
    process.exit(0);
  } catch (err) {
    console.error('Error shutting down:', err);
    process.exit(1);
  }
});

// Start server
startServer();