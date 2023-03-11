const express = require('express')
const axios = require('axios')
const { createClient } = require('redis')
const responseTime = require('response-time')
require('dotenv').config()

const app = express()

// Connecting to redis
const client = createClient({
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: process.env.REDIS_HOSTNAME,
    port: process.env.REDIS_PORT
  }
})

app.use(responseTime())
app.use(limitRate)

// Get all characters
app.get('/character', getRedis)

// Get a single character
app.get('/character/:id', getRedis)

async function getRedis (req, res, next) {
  try {
    const keyParam = isNaN(req.params.id)
      ? 'character'
      : 'character/' + req.params.id

    // Search Data in Redis
    const reply = await client.get(keyParam)
    // if exists returns from redis and finish with response
    if (reply) {
      console.log('using cached data')
      return res.send(JSON.parse(reply))
    }

    // Fetching Data from Rick and Morty API
    const response = await axios.get(process.env.API_URL + keyParam)
    // Saving the results in Redis. The "EX" and 10, sets an expiration of 10 Seconds
    const saveResult = await client.set(
      keyParam,
      JSON.stringify(response.data),
      { EX: 10 }
    )

    console.log('saved data:', saveResult)

    // respond to client
    res.send(response.data)
  } catch (error) {
    console.log(error)
    res.send(error.message)
  }
}

async function limitRate (req, res, next) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress
  const requests = await client.incr(ip)
  console.log(`Number of requests made so far ${requests}`)
  if (requests === 1) {
    await client.expire(ip, 43200)
  }
  if (requests > 50) {
    res.status(503).json({
      response: 'Error',
      callsMade: requests,
      msg: 'Too many calls made. Please try again later.'
    })
  } else next()
}

async function main () {
  await client.connect()
  const PORT = process.env.PORT || 4000

  // app.listen on express server
  app.listen({ port: PORT }, () => {
    console.log('App is listening on http://localhost:4000')
  })
}

main()
