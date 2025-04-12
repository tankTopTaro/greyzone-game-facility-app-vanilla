import dns from 'dns'
import cors from 'cors'
import path from 'path'
import axios from 'axios'
import dotenv from 'dotenv'
import express from 'express'
import { fileURLToPath } from 'url'
import { readDatabase, updateApiCallStatus, writeDatabase } from '../utils/dbHelpers.js'
import { jobQueue } from '../utils/queue.js'

import Socket from './Socket.js'
import ReportErrorToCentral from './ReportErrorToCentral.js'
import playersRouter from '../routes/players.js'
import teamsRouter from '../routes/teams.js'
import imagesRouter from '../routes/images.js'
import rfidRouter from '../routes/rfid.js'
import facilitySessionRouter from '../routes/facility-session.js'
import gameRoomRouter from '../routes/game-room.js'
import gameSessionsRouter from '../routes/game-session.js'
import reportErrorToCentralRouter from '../routes/report-error-to-central.js'

dotenv.config()
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const CSA_API_CALLS_PATH = path.join(__dirname, '../assets/csa/calls.json')
const CSA_STATUS_PATH = path.join(__dirname, '../assets/csa/csa-status.json')
const GRA_API_CALLS_PATH = path.join(__dirname, '../assets/gra/calls.json')
const GAME_ROOM_STATUS_PATH = path.join(__dirname, '../assets/gra/game-room-status.json')

const RETRY_INTERVAL_MS = 5000
const MAX_RETRY_LIMIT = 1

export default class Facility {
   constructor(facility_id) {
      this.facility_id = facility_id
      this.socket = new Socket(8081)
      this.reportErrorToCentral = new ReportErrorToCentral(this.socket)
      this.socket.setErrorReporter(this.reportErrorToCentral)
      this.init()
   }

   init() {
      this.startServer()
      this.startConnectionMonitors()
   }

   startServer() {
      // Prepare server
      this.server = express()
      const serverPort = process.env.PORT || 3001
      const serverHostname = process.env.HOST || '0.0.0.0'
  
      // Middleware to set no-cache headers for all routes
      this.server.use((req, res, next) => {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
          res.setHeader('Pragma', 'no-cache')
          res.setHeader('Expires', '0')
          res.setHeader('Surrogate-Control', 'no-store')
          next()
      })
      this.server.use(express.json())
      this.server.use(cors())
      this.server.use(express.static(path.join(__dirname, '../../frontend/')))

      // API routes
      this.server.use('/api/players', playersRouter)
      this.server.use('/api/teams', teamsRouter)
      this.server.use('/api/images', imagesRouter)
      this.server.use('/api/game-room', gameRoomRouter)
      this.server.use('/api/game-sessions', gameSessionsRouter)
      this.server.use('/api/rfid', rfidRouter)
      this.server.use('/api/facility-session', facilitySessionRouter)
      this.server.use('/api/report-error', reportErrorToCentralRouter)

      this.server.get('/', (req, res) => {
         res.send('<html><body><h1>Hello</h1></body></html>')
      })
      this.server.get('/monitor', (req, res) => {
         const filePath = path.join(__dirname, '../../frontend/pages/monitor.html')
         res.sendFile(filePath)
      })
      this.server.get('/booth/:booth_id', (req, res) => {
         const filePath = path.join(__dirname, '../../frontend/pages/booth.html')
         res.sendFile(filePath)
      })
      this.server.get('/game-room-door-screen/:gra_id', (req, res) => {
         const filePath = path.join(__dirname, '../../frontend/pages/game-room-door-screen.html')
         res.sendFile(filePath)
      })

      // Start server
      this.server.listen(serverPort, serverHostname, () => {
         console.log('\n-------------------------\n')
         console.log(`Server running at http://${serverHostname}:${serverPort}/`)
         console.log(`Monitor running at http://${serverHostname}:${serverPort}/monitor`)
         console.log(`Booth 1 running at http://${serverHostname}:${serverPort}/booth/1`)
         console.log(`Game-Room-Door-Screen 1 running at http://${serverHostname}:${serverPort}/game-room-door-screen/1`)
      })
   }

   async getIPv4Address(hostname) {
      return new Promise((resolve, reject) => {
         dns.lookup(hostname, {family: 4}, (err, address) => {
            if (err) return reject(err)

            resolve(address)
         })
      })
   }

   async checkConnectionHealth(health_url, JSON_PATH, callback, hostname) {
      const status = readDatabase(JSON_PATH, {})
      const action = async () => {
         const response = await axios.get(health_url, {timeout: 5000})
         
         if (response.status !== 200) {
            throw new Error(`Unexpected status ${response.status} from ${health_url}`)
         }

         callback?.()

         if (!hostname) {
            status.online = true
         } else {
            if (!status[hostname]) status[hostname] = {}
            status[hostname].online = true
         }   
         return status
      }

      try {
         const updatedStatus = await action()
         this.reportErrorToCentral.resolveError({
            error: hostname 
               ? `${hostname.split('.')[0].toUpperCase()} is offline`
               : `${new URL(health_url).hostname} is offline`
         })
         return updatedStatus
      } catch (error) {
         if (!hostname) {
            status.online = false
         } else {
            if (!status[hostname]) status[hostname] = {}
            status[hostname].online = false
         }

         this.reportErrorToCentral.report({
            error: hostname 
               ? `${hostname.split('.')[0].toUpperCase()} is offline`
               : `${new URL(health_url).hostname} is offline`,
            stack: error.stack || null,
         })

         const success = await this.retryWithBackoff(action, MAX_RETRY_LIMIT, RETRY_INTERVAL_MS)

         if (!success) {
            if (!hostname) {
               status.online = false
            } else {
               if (!status[hostname]) status[hostname] = {}
               status[hostname].online = false
            }            
         }
         return status
      }
   }

   async monitorCSAConnection() {
      const health_url = `${process.env.CSA_API_URL}/health`
      let interval = 15000
      let allOnlineSince = Date.now()

      const check = async () => {
         const updatedStatus = await this.checkConnectionHealth(
            health_url, 
            CSA_STATUS_PATH, 
            () => {
               this.retryPendingAPICalls(CSA_API_CALLS_PATH)
            }
         )

         writeDatabase(CSA_STATUS_PATH, updatedStatus)

         const success = updatedStatus?.online === true

         if (success) {
            if (Date.now() - allOnlineSince > 5 * 60 * 1000) {
               interval = 60000  // 60 seconds
            }
         } else {
            allOnlineSince = Date.now()
            interval = 15000  // 15 seconds
         }

         setTimeout(check, interval)
      }
      check()
   }

   async monitorGRAConnection() {
      let interval = 15000
      let allOnlineSince = Date.now()
   
      const check = async () => {
         const currentStatus = readDatabase(GAME_ROOM_STATUS_PATH, {})
         const statusUpdates = {}
   
         const checks = await Promise.all(
            Object.entries(currentStatus).map(async ([hostname, oldStatus]) => {
               if (!hostname) return false
   
               const ipv4Address = await this.getIPv4Address(hostname)
               const health_url = `http://${hostname}:3002/api/health`
   
               const updatedStatus = await this.checkConnectionHealth(
                  health_url,
                  GAME_ROOM_STATUS_PATH,
                  () => this.retryPendingAPICalls(GRA_API_CALLS_PATH),
                  hostname
               )
   
               statusUpdates[hostname] = {
                  ...oldStatus,
                  ...updatedStatus[hostname]
               }
   
               return updatedStatus[hostname]?.online
            })
         )
   
         const allOnline = checks.every(Boolean)
   
         // Write updated statuses back
         const sortedStatusUpdates = Object.keys(statusUpdates)
            .sort()
            .reduce((acc, key) => {
               acc[key] = statusUpdates[key]
               return acc
            }, {})
   
         writeDatabase(GAME_ROOM_STATUS_PATH, sortedStatusUpdates)
   
         // Adjust interval
         if (allOnline) {
            if (Date.now() - allOnlineSince > 5 * 60 * 1000) {
               interval = 60000
            }
         } else {
            allOnlineSince = Date.now()
            interval = 15000
         }
   
         setTimeout(check, interval)
      }
   
      check()
   }

   async retryWithBackoff(action, maxRetries, initialDelay) {
      let delay = initialDelay
      let lastFailedAttempt = Date.now()

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
         try {
            await action()  // Run the action (e.g., API call or TCP ping)
            return true  // Success
         } catch (err) {
            // console.warn(`Attempt ${attempt} failed:`, err.message)
            const currentTime = Date.now()

            if (currentTime - lastFailedAttempt > 10000) {
               delay = Math.min(delay * 2, RETRY_INTERVAL_MS * 2)
            }

            await new Promise(resolve => setTimeout(resolve, delay))
            lastFailedAttempt = currentTime
         }
      }
   
      return false  // If all attempts failed
   }

   startConnectionMonitors() {
      this.monitorCSAConnection()
      this.monitorGRAConnection()
   }

   async retryPendingAPICalls(JSON_PATH) {
      const cache = readDatabase(JSON_PATH, {})

      if (!cache['pending_api_calls']) return

      cache['pending_api_calls'].forEach((apiCall) => {
         if (
            apiCall.status === 'failed' &&
            apiCall.failure_reason === 'host_offline' || apiCall.failure_reason === 'other' || apiCall.failure_reason === null
         ) {
            jobQueue.addJob({
               id: Date.now(),
               run: async () => {
                  try {
                     await axios.post(apiCall.endpoint, apiCall.payload)
                     console.log('Job completed.')
                     await updateApiCallStatus(JSON_PATH, apiCall.call_id, 'completed')
         
                     this.reportErrorToCentral.resolveError({error: `Failed API call to ${apiCall.endpoint}`})
                  } catch (error) {
                     console.log('Job failed.')
                     await updateApiCallStatus(JSON_PATH, apiCall.call_id, 'failed', 'host_offline')

                     this.reportErrorToCentral.report({
                        error: `Failed API call to ${apiCall.endpoint}`,
                        stack: error.stack || null
                     })
                  }
               }
            })
         }
      })
   }
}