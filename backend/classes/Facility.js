import fs from 'fs'
import dns from 'dns'
import cors from 'cors'
import path from 'path'
import axios from 'axios'
import dotenv from 'dotenv'
import express from 'express'
import { fileURLToPath } from 'url'
import { getPlayerNextIncrement, getPlayersWithActiveSession, getPlayersWithRecentSession, migrateStalePlayerId, readDatabase, savePlayer, saveTeam, storeApiCall, updateApiCallStatus, updatePlayerId, writeDatabase } from '../utils/dbHelpers.js'
import { jobQueue } from '../utils/queue.js'

import Socket from './Socket.js'
import ReportErrorToCentral from './ReportErrorToCentral.js'

dotenv.config()
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const CSA_API_CALLS_PATH = path.join(__dirname, '../assets/db/csa/calls.json')
const CSA_STATUS_PATH = path.join(__dirname, '../assets/db/csa/csa-status.json')

const DB_PATH = path.join(__dirname, '../assets/db/gfa/db.json')
const IMAGE_CACHE_DIR = path.join(__dirname, '../assets/db/gfa/images')
const SCANS_PATH = path.join(__dirname, '../assets/db/gfa/scans.json')
const GFA_CLIENTS_PATH = path.join(__dirname, '../assets/db/gfa/clients.json')

const GRA_API_CALLS_PATH = path.join(__dirname, '../assets/db/gra/calls.json')
const GAME_ROOM_STATUS_PATH = path.join(__dirname, '../assets/db/gra/game-room-status.json')
const ROOM_TO_GAME_PATH = path.join(__dirname, '../assets/db/gra/room-to-game.json')
const WAITING_GAME_SESSION_PATH = path.join(__dirname, '../assets/db/gra/waiting-game-session.json')
const GAME_SESSION_HISTORY_PATH = path.join(__dirname, '../assets/db/gra/session_history.json')


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
      this.server.use(express.static(path.join(__dirname, '../assets')))   // Booth and Door Screens are in here
      this.server.use(express.static(path.join(__dirname, '../../frontend/dist')))  // Monitor in here

      // API routes
      this.server.get('/api/players/search', this.searchPlayer.bind(this))
      this.server.post('/api/players/', this.createPlayer.bind(this))
      this.server.post('/api/teams/', this.createTeam.bind(this))
      this.server.get('/api/images/players/:player_id.jpg', this.getPlayerImage.bind(this))

      this.server.get('/api/game-room/:gra_id/is-upcoming-game-session', this.isUpcomingGameSession.bind(this))
      this.server.post('/api/game-room/:gra_id/available', this.isAvailable.bind(this))
      this.server.post('/api/game-room/:gra_id/toggle-room', this.toggleRoom.bind(this))

      this.server.post('/api/game-sessions/', this.uploadGameSession.bind(this))

      this.server.post('/api/rfid/game-room/:gra_id', this.gameRoom.bind(this))
      this.server.post('/api/rfid/booth/:booth_id', this.booth.bind(this))

      this.server.post('/api/facility-session/create', this.createFacilitySession.bind(this))
      this.server.post('/api/facility-session/add-time-credits', this.addTimeCredits.bind(this))

      this.server.post('/api/report-error/', this.reportError.bind(this))

      this.server.get('/api/players/:player_id', this.getPlayerById.bind(this))
      this.server.get('/api/teams/:team_id', this.getTeamById.bind(this))


      // Frontend Routes
      this.server.get('/', (req, res) => {
         res.send('<html><body><h1>Hello</h1></body></html>')
      })
      this.server.get('/monitor', (req, res) => {
         const filePath = path.join(__dirname, '../../frontend/dist/index.html');
         res.sendFile(filePath);
      })
      this.server.get('/booth/:booth_id', (req, res) => {
         const filePath = path.join(__dirname, '../assets/pages/booth.html')
         res.sendFile(filePath)
      })
      this.server.get('/game-room-door-screen/:gra_id', (req, res) => {
         const filePath = path.join(__dirname, '../assets/pages/game-room-door-screen.html')
         res.sendFile(filePath)
      })

      // Start server
      this.server.listen(serverPort, serverHostname, () => {
         console.log('\n-------------------------\n')
         console.log(`Server running at http://${serverHostname}:${serverPort}/`)
         console.log(`Monitor running at http://${serverHostname}:${serverPort}/monitor`)
         console.log(`Booth 1 running at http://${serverHostname}:${serverPort}/booth/1`)
         console.log(`Game-Room-Door-Screen 1 running at http://${serverHostname}:${serverPort}/game-room-door-screen/1`)
         console.log(`Game-Room-Door-Screen 2 running at http://${serverHostname}:${serverPort}/game-room-door-screen/2`)
      })
   }

   // Connection Monitors
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

   // Report Errors
   reportError (req, res) {
      try {
         const { error, stack, source } = req.body

         if (!error || !stack) return res.status(400).json({ message: 'Missing required error details (message, stack)'})

         const errorSource = source || 'facility'

         this.reportErrorToCentral.report({
            error: error,
            stack: stack || null
         }, errorSource)

         res.status(200).json({ message: 'Error reported successfully.' })

      } catch (error) {
         console.error('Having problem reporting the error', error)
         res.status(500).json({ message: 'Having problem reporting the error', error: error})
      }
   }

   // Facility Controllers
   async createFacilitySession (req, res) {
      try {
         const { player_id, duration_m } = req.body

         const facility_id = this.facility_id
         
         if (!player_id || !duration_m) return res.status(400).json({ error: 'Missing required field.' })

         let cache = readDatabase(DB_PATH, {})

         if (!cache) return res.status(500).json({ error: 'Failed to read database.' })

         if (!cache.players) cache.players = {}

         let player = cache.players[player_id]

         if (!player) {
            try {
               const csaResponse = await axios.get(`${process.env.CSA_API_URL}/players/${player_id}`)

               if (csaResponse.status === 200) {
                  const playerData = csaResponse.data

                  // Check and migrate any stale data first
                  migrateStalePlayerId(cache, playerData);

                  await savePlayer(playerData)

                  cache = readDatabase(DB_PATH, {})
                  player = cache.players[player_id]

                  if (!player) return res.status(500).json({ error: 'No active session for this player.'})
               }
               
            } catch (error) {
               return res.status(500).json({ error: 'Failed to fetch player from CSA'})
            }
         }

         const date_start = new Date().toISOString()  // Get the current date in ISO format
         const date_end = new Date(Date.now() + duration_m * 60000).toISOString()  // Add duration to start time

         if (!cache.players[player_id]) return res.status(500).json({ error: "Player object is missing in database after save." })

         cache.players[player_id].facility_session = {
            date_start: date_start,
            duration_m: duration_m,
            date_end: date_end
         }

         writeDatabase(DB_PATH, cache)

         const newPlayerSessions = await getPlayersWithActiveSession()
         const recentPlayerSessions = await getPlayersWithRecentSession()

         this.socket.broadcastMessage('monitor', {
            type: 'facility_session',
            active_players: newPlayerSessions,
            recent_players: recentPlayerSessions
         })

         const facilitySessionData = {
            date_exec: date_start,
            duration_m: duration_m,
            facility_id: facility_id,
            player_id: player_id
         }

         const apiCallRecord = {
            call_id: `call_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
            endpoint: `${process.env.CSA_API_URL}/facility-session/create`,
            payload: facilitySessionData,
            status: "pending",
            attempts: 0,
         }

         await storeApiCall(CSA_API_CALLS_PATH, apiCallRecord)

         const jobId = Date.now()

         jobQueue.addJob({
            id: jobId,
            run: async() => {
               try {
                  await axios.post(apiCallRecord.endpoint, apiCallRecord.payload)
                  // console.log(`Job ${jobId} success.`)
                  await updateApiCallStatus(CSA_API_CALLS_PATH, apiCallRecord.call_id, 'completed')
                  this.reportErrorToCentral.resolveError({error: `Failed API call to ${apiCallRecord.endpoint}`})
               } catch (error) {
                  // console.log(`Job ${jobId} failed.`)
                  await updateApiCallStatus(CSA_API_CALLS_PATH, apiCallRecord.call_id, 'failed')

                  this.reportErrorToCentral.report({
                     error: `Failed API call to ${apiCallRecord.endpoint}`,
                     stack: error.stack || null
                  })
               }
            }
         })

         return res.status(200).json({ message: 'Facility session created.'})
      } catch (error) {
         return res.status(500).json({ message: 'Server error', error: error.message, stack: error.stack })

      }
   }

   async addTimeCredits(req, res) {
      try {
         const { player_id, additional_m } = req.body;

         if (!player_id || !additional_m) return res.status(400).json({ error: "Missing required field." })

         let cache = readDatabase(DB_PATH, {});

         if (!cache) return res.status(500).json({ error: 'Failed to read database.' })

         let player = cache.players[player_id];

         if (!player || !player.facility_session) return res.status(404).json({ error: "Player does not have an active facility session." })

         // Extract session details
         const { date_start, duration_m, date_end } = player.facility_session;
         const now = new Date();
         const parsedDateEnd = new Date(date_end)

         let new_duration_m
         let new_date_start = date_start
         let new_date_end

         let apiEndpoint = `${process.env.CSA_API_URL}/facility-session/update`

         if (parsedDateEnd < now) {
            // Session has ended, overwrite duration and start new session
            new_duration_m = additional_m
            new_date_start = now.toISOString()  // Use ISO format for consistency
            new_date_end = new Date(now.getTime() + additional_m * 60000).toISOString()

            // Treat this as a new session
            apiEndpoint = `${process.env.CSA_API_URL}/facility-session/create`
         } else {
            // Session is still active, extend it
            new_duration_m = duration_m + additional_m
            new_date_end = new Date(parsedDateEnd.getTime() + additional_m * 60000).toISOString()
         }

         // Update the player's session
         player.facility_session = {
            date_start: new_date_start,
            duration_m: new_duration_m,
            date_end: new_date_end
         };

         cache.players[player_id] = player

         writeDatabase(DB_PATH, cache)

         // Fetch updated player sessions
         const updatedSessions = await getPlayersWithActiveSession()
         const recentSessions = await getPlayersWithRecentSession()

         this.socket.broadcastMessage('monitor', {
            type: 'facility_session',
            active_players: updatedSessions,
            recent_players: recentSessions
         });

         // Prepare the session data for the API call
         const facilitySessionData = {
            date_exec: new_date_start,
            duration_m: new_duration_m,
            facility_id: this.facility_id,
            player_id: player_id
         };

         // Store API call details locally
         const apiCallRecord = {
            call_id: `call_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
            endpoint: apiEndpoint,
            payload: facilitySessionData,
            status: "pending",
            attempts: 0,
         }

         await storeApiCall(CSA_API_CALLS_PATH, apiCallRecord)

         const jobId = Date.now()
         jobQueue.addJob({
            id: jobId,
            run: async () => {
               try {
                  await axios.post(apiCallRecord.endpoint, apiCallRecord.payload)
                  // console.log(`Job ${jobId} success.`)
                  await updateApiCallStatus(CSA_API_CALLS_PATH, apiCallRecord.call_id, 'completed')
                  this.reportErrorToCentral.report({error: `Failed API call to ${apiCallRecord.endpoint}`})
               } catch (error) {
                  // console.log(`Job ${jobId} failed.`)
                  await updateApiCallStatus(CSA_API_CALLS_PATH, apiCallRecord.call_id, 'failed')
               
                  this.reportErrorToCentral.report({
                     error: `Failed API call to ${apiCallRecord.endpoint}`,
                     stack: error.stack || null
                  })
               }
            },
         })

         return res.json({ message: "Time credits updated successfully.", facility_session: player.facility_session })
      } catch (error) {
         return res.status(500).json({ message: 'Server error', error: error.message, stack: error.stack })
      }
   }

   // Player Controllers
   async getPlayerById(req, res) {
      const playerId = req.params.player_id
      try {
         let cache = readDatabase(DB_PATH, {})

         if (!cache.players) cache.players = {}

         if (cache.players[playerId]) return res.json(cache.players[playerId])

         const csaResponse = await axios.get(`${process.env.CSA_API_URL}/players/${playerId}`)

         if (csaResponse.status === 200) {
            const playerData = csaResponse.data
            await savePlayer(playerData)
         } else {
            return res.status(404).json({ error: 'Player not found in CSA.'})
         }
         this.reportErrorToCentral.resolveError({error: `Error fetching player ${playerId} from CSA`})
      } catch (error) {
         this.reportErrorToCentral.report({
            error: `Error fetching player ${playerId} from CSA`,
            stack: error.stack || null
         })
         res.status(500).json({ error: 'Could not fetch player data.'})
      }
   }
   
   async searchPlayer(req, res) {
      const { email, phone, first_name, last_name } = req.query;
   
      if (!email && !phone && !first_name && !last_name) {
         return res.status(400).json({ error: 'At least one search parameter is required.' });
      }
   
      try {
         const csaResponse = await axios.get(`${process.env.CSA_API_URL}/players/search`, {
            params: { email, phone, first_name, last_name },
            validateStatus: () => true // allow non-2xx responses without throwing
         });
   
         if (csaResponse.status === 404) {
            return res.status(404).json({message: 'No players found'}); // empty array = no matches found
         }
   
         if (csaResponse.status !== 200) {
            throw new Error(`Unexpected CSA response: ${csaResponse.status}`);
         }
   
         const filteredData = csaResponse.data.filter(player =>
            player.id.startsWith(`F${this.facility_id}-`)
         );
   
         const sortedData = filteredData.sort((a, b) => {
            const numA = parseInt(a.id.split('-')[1], 10);
            const numB = parseInt(b.id.split('-')[1], 10);
            return numA - numB;
         });
   
         return res.json(sortedData);
      } catch (error) {
         console.error('CSA Search Error:', error.message || error);
   
         return res.status(503).json({ error: 'CSA service unavailable. Please try again later.' });
      }
   }   

   async createPlayer(req, res) {
      try {
         const { nick_name, email, phone, last_name, first_name, gender, birth_date, notes, league_country, league_city, league_district, league_other } = req.body

         if (!first_name || !last_name || !email) return res.status(400).json({ error: 'Missing required fields.' })

         if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Invalid email format." })

         if (!/^\+?\d{10,15}$/.test(phone)) return res.status(400).json({ error: "Invalid phone number format." })

         if (birth_date && isNaN(Date.parse(birth_date))) return res.status(400).json({ error: "Invalid birth date format." })

         const next_increment = getPlayerNextIncrement(facility_id)
         let playerId = `F${this.facility_id}-${next_increment}`

         const rfid_tag_uid = '' // Add the rfid tag here
         const log = '' // add any issues that occurs when creating the player data here

         const playerData = {
            id: playerId,
            nick_name,
            email,
            phone,
            last_name,
            first_name,
            gender,
            birth_date,
            notes,
            log: log,   
            league_country,
            league_city,
            league_district,
            league_other,
            rfid_tag_uid: rfid_tag_uid 
         }

         await savePlayer(playerData)

         const apiCallRecord = {
            call_id: `call_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
            endpoint: `${process.env.CSA_API_URL}/players`,
            payload: playerData,
            status: "pending",
            attempts: 0,
         }

         await storeApiCall(CSA_API_CALLS_PATH, apiCallRecord)

         const jobId = Date.now()

         res.status(200).json({ message: 'Player data submitted.'})

         jobQueue.addJob({
            id: jobId,
            run: async () => {
               try {
                  const response = await axios.post(apiCallRecord.endpoint, apiCallRecord.payload)
                  const newId = response.data?.id || playerData.id
                  console.log('newId:', newId, ' response:', response.data)

                  if (newId !== playerData.id) {
                     const updatedPlayer = {...playerData, id: newId }

                     await updatePlayerId(playerData.id, updatedPlayer)
                  }

                  console.log(`Job ${jobId} success.`)

                  await updateApiCallStatus(CSA_API_CALLS_PATH, apiCallRecord.call_id, 'completed')
                  this.reportErrorToCentral.resolveError({error: `Failed API call to ${apiCallRecord.endpoint}`})
               } catch (error) {
                  const failureReason = error.code === 'ECONNREFUSED' || error.message.includes('Network') 
                     ? 'host_offline'
                     : 'other'

                  await updateApiCallStatus(CSA_API_CALLS_PATH, apiCallRecord.call_id, 'failed', failureReason)

                  this.reportErrorToCentral.report({
                     error: `Failed API call to ${apiCallRecord.endpoint}`,
                     stack: error.stack || null
                  })
               }
            }
         })

      } catch (error) {
         res.status(500).json({ error: "Server error" })
      }
   }

   // Team Controllers
   async getTeamById(req, res) {
      try {
         const teamId = req.params.team_id
         let cache = readDatabase(DB_PATH, {})

         // Ensure 'teams' exist in db.json
         if (!cache.teams) cache.teams = {}

         // Check if team data exist
         if (cache.teams[teamId]) return res.json(cache.teams[teamId])

         // Fetch team data from CSA if not in cache
         const csaResponse = await axios.get(`${process.env.CSA_API_URL}/teams/${teamId}`)

         if (csaResponse.status === 200) {
            const teamData = csaResponse.data
 
            const players = teamData.unique_identifiers ? teamData.unique_identifiers.split(',').filter(Boolean) : []

            // Transform CSA response to match 'db.json' format
            const transformedData = {
               id: teamData.id,
               name: teamData.name || '',
               nbr_of_players: teamData.nbr_of_players || 0,
               players: players,
               unique_identifiers: teamData.unique_identifiers || ''
            }

            // Cache the transformed data
            cache.teams[teamId] = transformedData
            writeDatabase(DB_PATH, cache)
            return res.json(transformedData)
         } else {
            return res.status(404).json({ error: 'Team not found in CSA.' })
         }
      } catch (error) {
         res.status(500).json({ error: 'Could not fetch team data.' })
      } finally {
         release()
      }
   }

   async createTeam (req, res) {
      try {
          // Extract team data from request
          const { unique_identifiers, leagues } = req.body;
  
          // Validate required fields
          if (!unique_identifiers || unique_identifiers.length < 2) {
              return res.status(400).json({ error: "Missing required field." });
          }
  
          // Format the unique_identifiers
          const formattedIdentifiers = unique_identifiers.sort((a, b) => {
              if (!a || !b) {
                  console.error('Invalid identifier:', a, b); // Log invalid entries
                  return;
              }
  
              // Ensure the format is correct before using split
              const aParts = a.split('-');
              const bParts = b.split('-');
  
              if (aParts.length !== 2 || bParts.length !== 2) {
                  return 0; // Skip invalid formats
              }
  
              const aNumber = parseInt(aParts[1], 10);
              const bNumber = parseInt(bParts[1], 10);
              return aNumber - bNumber;
          }).join(',');
  
          let db = readDatabase(DB_PATH, {});
  
          if (!db) {
              return res.status(500).json({ error: 'Failed to read database.' });
          }
  
          if (!db.teams) {
              db.teams = {};
          }
  
          let team = db.teams[formattedIdentifiers];
  
          // If team exists in the local database, skip processing and return success response
          if (team) {
              console.log(`Team ${formattedIdentifiers} already exists in local database.`);
              return res.json({ message: "Team already exists in the local database.", team: team });
          }
  
          // If player does not exist, fetch from CSA
          try {
              console.log(`Fetching team ${formattedIdentifiers} from CSA...`);
              const csaResponse = await axios.get(`${process.env.CSA_API_URL}/teams/${formattedIdentifiers}`);
  
              if (csaResponse.status === 200) {
                  const teamData = csaResponse.data;
  
                  console.log(teamData);
  
                  // Save the team data to the local database
                  await saveTeam(teamData, unique_identifiers, leagues);
  
                  // Reload the database after saving the team
                  db = readDatabase(DB_PATH, {});
                  team = db.teams[formattedIdentifiers];
  
                  // If the team still doesn't exist in the local DB after saving, return an error
                  if (!team) {
                      return res.status(500).json({ error: "Failed to store team in the local database." });
                  }
  
                  console.log(`Team ${formattedIdentifiers} successfully saved to the local database.`);
              }
          } catch (error) {
            if (error.response && error.response.status === 404) {
               console.warn(`Team ${formattedIdentifiers} not found in CSA. Proceeding with local team creation.`)
            } else {
               return res.status(500).json({ error: 'Failed to fetch team from CSA.' });
            }
          }
  
          // Generate a random team name
          const teamNames = [
              "Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliett",
              "Kilo", "Lima", "Mike", "November", "Oscar", "Papa", "Quebec", "Romeo", "Sierra", "Tango",
              "Uniform", "Victor", "Whiskey", "X-ray", "Yankee", "Zulu"
          ];
  
          const randomName = teamNames[Math.floor(Math.random() * teamNames.length)];
  
          const digitLength = Math.floor(Math.random() * 4) + 1;
          const randomNumber = Math.floor(Math.random() * Math.pow(10, digitLength));
  
          const teamName = `Team ${randomName} ${randomNumber}`;
  
          // count the number of players
          const nbr_of_players = unique_identifiers.length;
  
          const teamData = {
              id: formattedIdentifiers,
              name: teamName,
              nbr_of_players: nbr_of_players,
              unique_identifier: formattedIdentifiers,
          };

          console.log('Saving team to local...')
          await saveTeam(teamData, unique_identifiers, leagues)
  
          // Store API call details locally
          const apiCallRecord = {
              call_id: `call_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
              endpoint: `${process.env.CSA_API_URL}/teams`,
              payload: teamData,
              status: "pending",
              attempts: 0,
          };
  
          await storeApiCall(CSA_API_CALLS_PATH, apiCallRecord);
  
          // Respond to client immediately
          res.json({ message: "Player added to queue for processing." });
  
          // Enqueue API request for processing only if the team was successfully saved to the local DB
          const jobId = Date.now();
  
          // Enqueue the job request only if team data has been saved
          jobQueue.addJob({
              id: jobId,
              run: async () => {
                  try {
                      await axios.post(apiCallRecord.endpoint, teamData);
                      console.log(`Job ${jobId} completed successfully.`);
  
                      // Update API call status in local DB
                      await updateApiCallStatus(CSA_API_CALLS_PATH, apiCallRecord.call_id, "completed");
                      this.reportErrorToCentral.resolveError({error: `Failed API call to ${apiCallRecord.endpoint}`})
                  } catch (error) {
                      console.error(`Job ${jobId} failed:`, error.message);
  
                      // Mark API call as failed in local DB
                      await updateApiCallStatus(CSA_API_CALLS_PATH, apiCallRecord.call_id, "failed");

                      this.reportErrorToCentral.report({
                        error: `Failed API call to ${apiCallRecord.endpoint}`,
                        stack: error.stack || null
                     })
                  }
              },
          });
  
      } catch (error) {
          console.error("Error processing team creation:", error.message);
          res.status(500).json({ error: "Server error" });
      }
   }

   // Images Controller
   async getPlayerImage (req, res) {
      const { player_id } = req.params
      const localImagePath = path.join(IMAGE_CACHE_DIR, `${player_id}.jpg`)

      // check if image is cached
      if (fs.existsSync(localImagePath)) return res.sendFile(localImagePath)

      try {
         // Fetch image from CSA if not in cache
         const csaResponse = await axios.get(`${process.env.CSA_API_URL}/images/players/${player_id}.jpg`, {
            responseType: 'arraybuffer',
            validateStatus: (status) => status === 200 || status === 404
         })

         if (csaResponse.status === 200) {
            // Ensure cache directory exist
            if (!fs.existsSync(IMAGE_CACHE_DIR)) fs.mkdirSync(IMAGE_CACHE_DIR, { recursive: true })

            fs.writeFileSync(localImagePath, csaResponse.data)

            return res.sendFile(localImagePath)
         }
      } catch (error) {
         res.status(500).json({ message: 'Server error', error: error})
      }
      return res.status(404).json({ error: 'Player image not found.'})
   }

   // Game Room Controllers
   async isAvailable (req, res) {
      try {
         const { gra_id } = req.params
         const { available, enabled, room, rules } = req.body
   
         let status = readDatabase(GAME_ROOM_STATUS_PATH, {})
         let roomToGame = readDatabase(ROOM_TO_GAME_PATH, {})
   
         if (!status) return res.status(500).json({ error: 'Error reading game room status database' })
   
         let hostname = `${gra_id}`
         if (!status[hostname]) status[hostname] = {}
         if (!roomToGame[gra_id]) roomToGame[gra_id] = {}
   
         status[hostname].online = true
         status[hostname].isAvailable = available
         status[hostname].enabled = enabled
   
         roomToGame[gra_id].roomType = room
         roomToGame[gra_id].rules = rules
   
         if(status[hostname].online) this.reportErrorToCentral.resolveError({message: `${hostname} is offline.`})
   
         const sortedStatus = Object.fromEntries(
            Object.entries(status).sort(([a], [b]) => a.localeCompare(b, undefined, {numeric: true}))
         )
   
         const sortedRooms = Object.fromEntries(
            Object.entries(roomToGame).sort(([a], [b]) => a.localeCompare(b, undefined, {numeric: true}))
         )
   
         writeDatabase(GAME_ROOM_STATUS_PATH, sortedStatus)
         writeDatabase(ROOM_TO_GAME_PATH, sortedRooms)

         let previousAvailability = null
   
         if (status[hostname].isAvailable !== previousAvailability) {
            const gameRoomId = `game-room-${gra_id.match(/\d+/)[0]}`
            this.socket.broadcastMessage(gameRoomId, {
               type: 'roomAvailable',
               message: 'Room is now available, proceed with the scan.',
               isAvailable: status[hostname].isAvailable
            })

            previousAvailability = status[hostname].isAvailable
         }   
         res.send(`Game Room ${gra_id} is now available`)
      } catch (error) {
         res.status(500).json({message: 'Server error', error: error})
      }
   }

   isUpcomingGameSession (req, res) {
      const { gra_id } = req.params

      const hostname = `${gra_id}.local`

      const upcomingSessions = readDatabase(WAITING_GAME_SESSION_PATH, {});

      if (!upcomingSessions) {
         return res.status(500).json({ error: 'Error reading upcoming game session database' });
      }
   
      const sessionsForGra = upcomingSessions[hostname];
   
      if (Array.isArray(sessionsForGra) && sessionsForGra.length !== 0) {
         return res.json({ is_upcoming: true });
      }

      res.json({ is_upcoming: false })
   }

   async toggleRoom(req, res) {
      try {
         const { gra_id } = req.params
         const { status } = req.body

         const graStatus = readDatabase(GAME_ROOM_STATUS_PATH, {})

         const hostname = `${gra_id}.local`

         graStatus[hostname].online = true
         graStatus[hostname].enabled = status

         writeDatabase(GAME_ROOM_STATUS_PATH, graStatus)

         this.socket.broadcastMessage('monitor', {
            type: 'toggleRoom',
            states: graStatus
         })

         console.log(graStatus[hostname].enabled)

         try {
            const response = await axios.post(`http://${hostname}:3002/api/toggle-room`, {
               status: graStatus[hostname].enabled
            })

            if (response.status === 200) {
               res.json('success')
            }
         } catch (error) {
            console.error(`Can't toggle ${hostname}`)
         }
      } catch (error) {
         return res.status(500).json({message: 'Server error', error: error})
      }
   }

   // Game Session Controller
   async uploadGameSession (req, res) {
      try {
         const { players, team, roomType, gameRule, gameLevel, durationStheory, isWon, score, isCollaborative, log, parentGsId } = req.body
         
         // save players and team data to db.json
         let cache = readDatabase(DB_PATH, {})
         if (!cache.players) cache.players = {}
         if (!cache.teams) cache.teams = {}

         if (Array.isArray(players)) {
            for (const player of players) {
               if (player.id) {
                  cache.players[player.id] = {
                     ...(cache.players[player.id] || {}),
                     ...player
                  }
               }
            }
         }

         if (team && team.id) {
            cache.teams[team.id] = {
               ...(cache.teams[team.id] || {}),
               ...team
            }
         }

         writeDatabase(DB_PATH, cache)

         // prepare payload for CSA
         const roomKey = `${roomType} > ${gameRule} > L${gameLevel}`

         let duration_s_actual = 0

         if (team && team.id && cache.teams[team.id]?.games_history?.[roomKey]?.best_time) {
            duration_s_actual = cache.teams[team.id].games_history[roomKey].best_time;
         } else if (Array.isArray(players)) {
            for (const player of players) {
               const playerData = cache.players[player.id];
               const time = playerData?.games_history?.[roomKey]?.best_time;
               if (typeof time === 'number' && time > duration_s_actual) {
                  duration_s_actual = time; // Pick the highest
               }
            }
         }

         let game_log = []

         if(team?.events_to_debrief?.length) {
            game_log = team.events_to_debrief
         } else if (Array.isArray(players)) {
            for (const player of players) {
               const events = cache.players[player.id]?.events_to_debrief
               if (Array.isArray(events)) {
                  game_log.push(...events)
               }
            }
         }

         game_log = game_log.map(event => {
            if (typeof event === 'object') {
               return JSON.stringify(event)
            }
            return event
         }).join(',')

         const flattenedLog = log && log.length ? log.map(event => typeof event === 'object' ? JSON.stringify(event) : event).join(',') : null

         const gameSessionData = {
            room_type: roomType,
            game_rule: gameRule,
            game_level: gameLevel,
            duration_s_theory: durationStheory,
            duration_s_actual,
            game_log,
            log: flattenedLog,
            is_collaborative: isCollaborative,
            facility_id: this.facility_id,
            team_id: team?.id ?? null,
            player_id: team?.id ? null : players[0]?.id,
            is_won: isWon,
            score,
            parent_gs_id: parentGsId
         }

         // console.log(gameSessionData)

         // Store API call details locally
         const apiCallRecord = {
            call_id: `call_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
            endpoint: `${process.env.CSA_API_URL}/game-sessions/`,
            payload: gameSessionData,
            status: "pending",
            attempts: 0,
         }

         await storeApiCall(CSA_API_CALLS_PATH, apiCallRecord)

         const jobId = Date.now()
         jobQueue.addJob({
             id: jobId,
             run: async () => {
              try {
                  await axios.post(apiCallRecord.endpoint, apiCallRecord.payload)
                  console.log(`Job ${jobId} success.`)
                  await updateApiCallStatus(CSA_API_CALLS_PATH, apiCallRecord.call_id, 'completed')

                  this.reportErrorToCentral.resolveError({error: `Failed API call to ${apiCallRecord.endpoint}`})
              } catch (error) {
                  await updateApiCallStatus(CSA_API_CALLS_PATH, apiCallRecord.call_id, 'failed')
                  this.reportErrorToCentral.report({
                     error: `Failed API call to ${apiCallRecord.endpoint}`,
                     stack: error.stack || null
                  })
              }
             },
         })

         res.status(200).json({ message: 'Success'})
      } catch (error) {
         res.status(500).json({ message: 'Server error', error: error})
      }
   }

   // RFID Controllers
   async gameRoom(req, res) {
      const { gra_id } = req.params
      const { rfid_tag, player } = req.body

      const roomKey = `gra-${gra_id}`
      const hostname = `${roomKey}.local`

      if (!rfid_tag) {
         return res.status(400).send('Missing RFID tag')
      }

      try {
         let allScans = readDatabase(SCANS_PATH, {})
         const status = readDatabase(GAME_ROOM_STATUS_PATH, {})
         
         if (!allScans[roomKey]) {
            allScans[roomKey] = { booth: [], 'game-room': [], status: 'waiting', boothConfirmed: false }
         }

         const roomData = allScans[roomKey]
         const roomStatus = status[hostname]

         if (!roomStatus || !roomStatus.isAvailable) {
            return res.status(400).send('Game room is currently busy. Please wait.')
         }

         if (!roomData['game-room'].includes(player)) {
            roomData['game-room'].push(player)
         }

         writeDatabase(SCANS_PATH, allScans)

         this.socket.broadcastMessage('monitor', {
            type: 'rfid_scanned',
            location: 'game-room',
            id: gra_id,
            player
         })

         await this.processRfidScan('game-room', gra_id, roomKey)
         
         return res.send('ok')
      } catch (error) {
         return res.status(500).send('Error processing scan')
      }
   }

   async booth(req, res) {
      const { booth_id } = req.params
      const { rfid_tag, player } = req.body
   
      if (!rfid_tag) {
         return res.status(400).send('Missing RFID tag')
      }
   
      const allRoomStatuses = readDatabase(GAME_ROOM_STATUS_PATH, {})

      // Select first available room (no pending session)
      let roomKey = null
      for (const key in allRoomStatuses) {
         const room = allRoomStatuses[key]
         if (!room.hasPending) {
            roomKey = key.replace('.local', '')
            break
         }
      }

      // Block scan if all rooms are busy
      if (!roomKey) {
         return res.status(403).send('All rooms have pending sessions. Please wait.')
      }
   
      try {
         let allScans = readDatabase(SCANS_PATH, {})
   
         if (!allScans[roomKey]) {
            allScans[roomKey] = {
               booth: [],
               'game-room': [],
               status: 'waiting',
               boothConfirmed: false
            }
         }
   
         const roomData = allScans[roomKey]
   
         if (!roomData['booth'].includes(player)) {
            roomData['booth'].push(player)
         }
   
         writeDatabase(SCANS_PATH, allScans)
   
         this.socket.broadcastMessage(`booth-${booth_id}`, {
            type: 'rfid_scanned',
            location: 'booth',
            id: booth_id,
            player
         })
   
         this.socket.broadcastMessage('monitor', {
            type: 'rfid_scanned',
            location: 'booth',
            id: booth_id,
            player
         })
   
         const gra_id = roomKey.split('-')[1]
         this.socket.broadcastMessage(`game-room-${gra_id}`, {
            type: 'rfid_scanned',
            location: 'game-room',
            id: gra_id,
            player
         })
   
         await this.processRfidScan('booth', booth_id, roomKey)
   
         return res.send('ok')
      } catch (error) {
         return res.status(500).send('Error processing scan')
      }
   } 

   async processRfidScan (location, id, roomKey) {
      try {
         let hostname = `${roomKey}.local`
   
         if (!roomKey) {
            return { status: 'error', message: 'No available game room found.' }
         }
   
         const allScans = readDatabase(SCANS_PATH, {})
         const gameRoomStatus = readDatabase(GAME_ROOM_STATUS_PATH, {})
         const pendingSessions = readDatabase(WAITING_GAME_SESSION_PATH, {})
         const sessionHistory = readDatabase(GAME_SESSION_HISTORY_PATH, {})
         const roomStatus = gameRoomStatus[hostname]
         const sessionRecord = pendingSessions[hostname]
         
         // Notify front end if room is busy
         if (location === 'game-room' && roomStatus && roomStatus.isAvailable === false) {
            console.warn(`Game room ${roomKey} is currently busy.`)
            //return { status: 'error', message: 'Game room is currently busy. Please wait.' }
         }

         const roomData = allScans[roomKey]
   
         // Booth validation before game-room scan
         if (location === 'game-room') {
            if (roomData.booth.length === 0) {
               return { status: 'error', message: 'Cannot scan from game-room. Booth is empty.' }
            }
   
            if (!roomData.boothConfirmed) {
               return { status: 'error', message: 'Booth not yet confirmed.' }
            }
         }
   
         // Booth confirmation
         if (location === 'booth') {
            try {
               const message = await this.socket.waitForMessage(`booth-${id}`)
               if (message.type === 'confirm') {
                  // Check if room is not available and a session already exist
                  if (!roomStatus.isAvailable && roomStatus.hasPending){
                     return {
                        status: 'error',
                        message: 'Game room is busy and a session is already waiting.'
                     }
                  }

                  roomData.boothConfirmed = true
                  writeDatabase(SCANS_PATH, allScans)

                  this.socket.broadcastMessage(`booth-${id}`, {
                     type: 'destination',
                     goal: roomKey
                  })

                  if(sessionHistory[roomKey]) {
                     this.socket.broadcastMessage(`game-room-${roomKey.split('-')[1]}`, {
                        type: 'status_update',
                        status: roomData.status,
                        book_room_until: sessionHistory[roomKey].book_room_until
                     })
                  }
         
                  // Create Game Session Data
                  const gameSessionData = await this.createGameSession(roomData.booth, hostname)
         
                  // Store temporarily
                  pendingSessions[hostname] = {
                     data: gameSessionData
                  }
         
                  writeDatabase(WAITING_GAME_SESSION_PATH, pendingSessions)

                  roomStatus.hasPending = true

                  writeDatabase(GAME_ROOM_STATUS_PATH, gameRoomStatus)

                  const messageText = roomStatus.isAvailable
                     ? 'Booth confirmation handled.'
                     : 'Game room busy. Session queued.'

                  return { status: roomStatus.isAvailable ? 'ok' : 'waiting', message: messageText }
               }
         
               return { status: 'ok', message: 'Booth confirmation handled.' }
            } catch (error) {
               console.error('Error during waitForMessage:', error)
               return { status: 'error', message: 'Booth confirmation failed.' }
            }
         }
   
         // Game-room scan
         if (location === 'game-room' && roomData.boothConfirmed) {
            const boothSorted = [...roomData.booth].sort()
            const gameRoomSorted = [...roomData['game-room']].sort()
   
            if (!sessionRecord) {
               return { status: 'error', message: 'No session data found for room.' }
            }
   
            const gameSessionData = sessionRecord.data
   
            const proceedToSubmitSession = async () => {
               const bookRoomUntil = new Date(Date.now() + 6 * 60 * 1000).toISOString()
               gameSessionData.book_room_until = bookRoomUntil

               // Save book_room_until to session history before proceeding
               sessionHistory[roomKey] = {
                  book_room_until: bookRoomUntil
               }

               writeDatabase(GAME_SESSION_HISTORY_PATH, sessionHistory)
   
               const apiCallRecord = {
                  call_id: `call_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
                  endpoint: `http://${hostname}:3002/api/start-game-session`,
                  payload: gameSessionData,
                  status: "pending",
                  attempts: 0,
               }
   
               await storeApiCall(GRA_API_CALLS_PATH, apiCallRecord)
   
               const jobId = Date.now()
               jobQueue.addJob({
                  id: jobId,
                  run: async () => {
                     try {
                        await axios.post(apiCallRecord.endpoint, apiCallRecord.payload)
                        await updateApiCallStatus(GRA_API_CALLS_PATH, apiCallRecord.call_id, 'completed')
                        this.socket.broadcastMessage('monitor', {
                           type: 'confirmed',
                           message: `Scan processing completed for room ${roomKey}`
                        })

                        this.reportErrorToCentral.resolveError({ error: `Failed to start game session for room ${roomKey}` })
                     } catch (error) {
                        await updateApiCallStatus(GRA_API_CALLS_PATH, apiCallRecord.call_id, 'failed')
                        this.reportErrorToCentral.report({
                           error: `Failed to start game session for room ${roomKey}`,
                           stack: error.stack || null
                        })
                     }
                  }
               })
   
               roomData.status = 'ready'
               writeDatabase(SCANS_PATH, allScans)
   
               this.socket.broadcastMessage(`${location}-${id}`, {
                  type: 'status_update',
                  status: roomData.status
               })

               roomStatus.hasPending = false
               writeDatabase(GAME_ROOM_STATUS_PATH, gameRoomStatus)
   
               // reset after sending ready message to door-screen
               roomData.booth = []
               roomData['game-room'] = []
               roomData.boothConfirmed = false
               roomData.status = 'waiting'
               writeDatabase(SCANS_PATH, allScans)
   
               delete pendingSessions[hostname]
               writeDatabase(WAITING_GAME_SESSION_PATH, pendingSessions)
            }
   
            if (JSON.stringify(boothSorted) === JSON.stringify(gameRoomSorted)) {
               // Match case
               if (!roomStatus.isAvailable) {
                  if (pendingSessions[hostname]) {
                     return { status: 'error', message: 'Game room is busy, session already waiting.' }
                  }
   
                  roomData.booth = []
                  roomData['game-room'] = []
                  roomData.boothConfirmed = false
                  roomData.status = 'waiting'
                  writeDatabase(SCANS_PATH, allScans)
                  
                  pendingSessions[hostname] = { data: gameSessionData }
                  writeDatabase(WAITING_GAME_SESSION_PATH, pendingSessions)
                  return { status: 'waiting', message: 'Game room is busy, session queued.' }
               }
   
               await proceedToSubmitSession()
   
               return { status: 'ok', message: 'Players match. Session submitted.' }
   
            } else if (roomData['game-room'].length < roomData.booth.length) {
               // Wait for a timeout then proceed anyway
               const waitDuration = 5000 // 5 seconds for example
               setTimeout(async () => {
                  const updatedRoomData = readDatabase(SCANS_PATH, {})[roomKey]
                  if (updatedRoomData['game-room'].length < updatedRoomData.booth.length) {
                     if (roomStatus.isAvailable) {
                        await proceedToSubmitSession()
                     } else {
                        pendingSessions[hostname] = { data: gameSessionData, boothTimestamp: Date.now() }
                        writeDatabase(WAITING_GAME_SESSION_PATH, pendingSessions)
                     }
                  }
               }, waitDuration)
   
               roomData.status = 'waiting'
               writeDatabase(SCANS_PATH, allScans)
               return { status: 'waiting', message: 'Waiting for more players...' }
            } else {
               // Too many players, error
               roomData.status = 'error'
               writeDatabase(SCANS_PATH, allScans)
               return { status: 'error', message: 'Mismatch: More players in game-room than booth.' }
            }
         }
         // Fallback: Cleanup stale session if nobody ever showed up
         if (sessionRecord) {
            const timeSinceBooth = Date.now() - sessionRecord.boothTimestamp
            if (timeSinceBooth > 60000) { // 60 seconds
               delete pendingSessions[hostname]
               writeDatabase(WAITING_GAME_SESSION_PATH, pendingSessions)
               return { status: 'error', message: 'Session timed out. No players showed up.' }
            }
         }
   
         return { status: 'ok', message: 'Scan recorded.' }
      } catch (error) {
         return { status: 'error', message: 'An error occurred while processing the scan.' }
      }
   }
   
   async createGameSession (players, roomKey) {
      try {
         const roomToGame = readDatabase(ROOM_TO_GAME_PATH, {})
         const cache = readDatabase(DB_PATH, {})
   
         const teamsData = cache.teams
         const playersData = cache.players
   
         let teamInfo = null
   
         for(const teamKey in teamsData) {
            const team = teamsData[teamKey]
            
            if (Array.isArray(team.players) && Array.isArray(players) && team.players.length === players.length &&
               team.players.every(player => players.includes(player))) {
               teamInfo = team
               break
            }
         }
   
         const playerDetails = Array.isArray(players) 
            ? players.map(playerId => playersData[playerId] || { id: playerId, error: "Player not found" }) 
            : []
   
         if (!roomToGame[roomKey]) {
            throw new Error(`No room data found for ${roomKey}`)
         }
   
         const { roomType, rules } = roomToGame[roomKey]
   
         if (!rules || rules.length === 0) {
            throw new Error('No rules available for this room')
         }
   
         const selectedRule = rules[Math.floor(Math.random() * rules.length)]
         const roomInfo = `${roomType} > ${selectedRule} > L1`
   
         // Update players games_history
         for (const playerId of players) {
            if (!playersData[playerId]) continue
   
            if (!playersData[playerId].games_history) playersData[playerId].games_history = {}
   
            if (playersData[playerId].games_history[roomInfo]) playersData[playerId].games_history[roomInfo] = { best_time: 0, played: 0, played_today: 0 }
         }
   
         // Update team games_history
         if (teamInfo) {
            if (!teamInfo.games_history) teamInfo.games_history = {}
   
            if (teamInfo.games_history[roomInfo]) teamInfo.games_history[roomInfo] = { best_time: 0, played: 0, played_today: 0 }
         }
   
         writeDatabase(DB_PATH, cache)
   
         const gameSessionData = {
            team: teamInfo,
            players: playerDetails,
            is_collaborative: true,
            room: `${roomType},${selectedRule},1`,
            book_room_until: ''
         }
         return gameSessionData
      } catch (error) {
         throw new Error(`Server error: ${error.message}`)
      }
   }

}