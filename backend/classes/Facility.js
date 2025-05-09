import fs from 'fs'
import cors from 'cors'
import path from 'path'
import axios from 'axios'
import dotenv from 'dotenv'
import express from 'express'

import multer from 'multer'
const upload = multer({ dest: 'tmp_uploads/'})

import { fileURLToPath } from 'url'
import { jobQueue } from '../utils/queue.js'
import DBManager from './DBManager.js'

import Socket from './Socket.js'
import ReportErrorToCentral from './ReportErrorToCentral.js'

dotenv.config()
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const CSA_API_CALLS_PATH = path.join(__dirname, '../public/assets/db/csa/calls.json')
const IMAGE_CACHE_DIR = path.join(__dirname, '../public/assets/db/gfa/images')

const GRA_API_CALLS_PATH = path.join(__dirname, '../public/assets/db/gra/calls.json')

const RETRY_INTERVAL_MS = 5000
const MAX_RETRY_LIMIT = 1

export default class Facility {
   constructor(facility_id) {
      this.gfaManager = new DBManager(path.join(__dirname, '../public/assets/db/gfa'))
      this.graManager = new DBManager(path.join(__dirname, '../public/assets/db/gra'))

      this.gfaManager.loadDatabase('db')
      this.graManager.loadDatabase('db')

      this.facility_id = facility_id
      this.socket = new Socket(8081, this.gfaManager)
      this.reportErrorToCentral = new ReportErrorToCentral(this.socket)
      this.socket.setErrorReporter(this.reportErrorToCentral)

      this.csaOnlineStatus = false
      this.nextPlayerNumber = null
      this.nextGameSessionNumber = null

      this.init()
   }

   async init() {
      this.startServer()
      this.startConnectionMonitors()
      await this.initializeIdCounters()
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
      this.server.use(express.static(path.join(__dirname, '../assets')))   
      this.server.use(express.static(path.join(__dirname, '../public'))) // Booth and Door Screens are in here
      this.server.use(express.static(path.join(__dirname, '../../frontend/dist')))  // Monitor in here

      // API routes
      this.server.get('/api/players/search', this.searchPlayer.bind(this))
      this.server.post('/api/players/', upload.single('avatar'), this.createPlayer.bind(this))
      this.server.post('/api/teams/', this.createTeam.bind(this))
      this.server.get('/api/images/players/:player_id.jpg', this.getPlayerImage.bind(this))

      this.server.get('/api/game-room/:gra_id/is-upcoming-game-session', this.isUpcomingGameSessionAtGameRoom.bind(this))
      this.server.post('/api/game-room/:gra_id/available', this.isGameRoomAvailable.bind(this))
      this.server.post('/api/game-room/:gra_id/toggle-game-room-status', this.toggleGameRoomStatus.bind(this))

      this.server.post('/api/game-sessions/', this.uploadGameSession.bind(this))

      this.server.post('/api/rfid/game-room/:gra_id', this.handleRfidScannedAtGameRoom.bind(this))
      this.server.post('/api/rfid/booth/:booth_id', this.handleRfidScannedAtBooth.bind(this))

      this.server.post('/api/facility-session/create', this.createFacilitySession.bind(this))
      this.server.post('/api/facility-session/add-time-credits', this.addTimeCreditsToFacilitySession.bind(this))
      this.server.get('/api/facility-session', async (req, res) => {
         try {
            const activePlayers = await this.getPlayersWithActiveSession()
            const recentPlayers = await this.getPlayersWithRecentSession()

            res.json({
               active_players: activePlayers,
               recent_players: recentPlayers
            })
         } catch (error) {
            res.status(500).json({message: 'Internal Server Error', error})
         }
      })

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
         const filePath = path.join(__dirname, '../public/booth.html')
         res.sendFile(filePath)
      })
      this.server.get('/game-room-door-screen/:gra_id', (req, res) => {
         const filePath = path.join(__dirname, '../public/game-room-door-screen.html')
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

   async initializeIdCounters() {
      const action = async () => {
         const playerRes = await axios.get(`${process.env.CSA_API_URL}/latest-player-id/${this.facility_id}`)
         const gameSessionRes = await axios.get(`${process.env.CSA_API_URL}/latest-game-session-id/${this.facility_id}`)
      
         const playerId = playerRes.data.player
         const gameSessionId = gameSessionRes.data.gameSession

         this.nextPlayerNumber = playerId ? parseInt(playerId.split('-')[1], 10) + 1 : 1
         this.nextGameSessionNumber = gameSessionId ? parseInt(gameSessionId.split('-')[1], 10) + 1 : 1
      }

      const success = await this.retryWithBackoff(action, MAX_RETRY_LIMIT, RETRY_INTERVAL_MS)

      if (!success) {
         this.nextPlayerNumber = 1;
         this.nextGameSessionNumber = 1;
      }
   }

   getNextPlayerId() {
      const id = `F${this.facility_id}-${this.nextPlayerNumber}`
      this.nextPlayerNumber += 1
      return id
   }

   getNextGameSessionId() {
      const id = `F${this.facility_id}-${this.nextGameSessionNumber}`
      this.nextGameSessionNumber += 1
      return id
   }

   // Monitor Connection Health
   setOnlineStatus(status, hostname, isOnline) {
      if (hostname) {
         if (!status[hostname]) status[hostname] = {}
         status[hostname].online = isOnline
      } else {
         status.online = isOnline
      }
   }

   async persistStatus(dbManager, dbName) {
      if (dbManager && dbName) {
         dbManager.markDirty(dbName)
         await dbManager.maybeSave(dbName)
      }
   }

   reportConnectionError(error, hostname, health_url) {
      const label = hostname
         ? `${hostname.split('.')[0].toUpperCase()}`
         : new URL(health_url).hostname
   
      this.reportErrorToCentral.report({
         error: `${label} is offline`,
         stack: error.stack || null,
      })
   }

   resolveConnectionError(hostname, health_url) {
      const label = hostname
         ? `${hostname.split('.')[0].toUpperCase()}`
         : new URL(health_url).hostname
   
      this.reportErrorToCentral.resolveError({
         error: `${label} is offline`,
      })
   }

   async checkConnectionHealth(health_url, dbManager = null, dbName = null, callback, hostname) {
      const fullDb = dbManager && dbName ? dbManager.get(dbName) : {}
      if (dbName === 'db' && !fullDb['game-room-status']) fullDb['game-room-status'] = {}
   
      const status = dbName === 'db' ? fullDb['game-room-status'] : fullDb

      const updateStatus = async (isOnline) => {
         this.setOnlineStatus(status, hostname, isOnline)

         if (dbName === 'db') {
            fullDb['game-room-status'] = status
            dbManager.databases['db'] = fullDb
         }

         await this.persistStatus(dbManager, dbName)
      }
   
      const action = async () => {
         const response = await axios.get(health_url, { timeout: 5000 })
         if (response.status !== 200) throw new Error(`Unexpected status ${response.status}`)
         
         callback?.()
         await updateStatus(true)
         return status
      }
   
      try {
         const updatedStatus = await action()
         this.resolveConnectionError(hostname, health_url)
         return updatedStatus
      } catch (error) {
         await updateStatus(false)
         this.reportConnectionError(error, hostname, health_url)
   
         const success = await this.retryWithBackoff(action, MAX_RETRY_LIMIT, RETRY_INTERVAL_MS)
         if (!success) await updateStatus(false)
   
         return dbName === 'db' ? { [hostname] : status[hostname] } : status
      }
   }
   
   async monitorCSAConnection() {
      const health_url = `${process.env.CSA_API_URL}/health`
      let interval = 15000
      let allOnlineSince = Date.now()
   
      const check = async () => {
         const status = await this.checkConnectionHealth(
            health_url,
            null,
            null,
            async () => await jobQueue.retryPendingAPICalls(CSA_API_CALLS_PATH, this)
         )
   
         this.csaOnlineStatus = status?.online === true
   
         interval = this.csaOnlineStatus && Date.now() - allOnlineSince > 5 * 60 * 1000
            ? 60000
            : (allOnlineSince = Date.now(), 15000)
   
         setTimeout(check, interval)
      }
   
      check()
   }
   
   async monitorGRAConnection() {
      let interval = 15000
      let allOnlineSince = Date.now()
   
      const check = async () => {
         const fullDb = this.graManager.get('db') || {}
         if(!fullDb['game-room-status']) fullDb['game-room-status'] = {}

         const currentStatus = fullDb['game-room-status'] || {}
         const statusUpdates = {}
   
         const checks = await Promise.all(
            Object.entries(currentStatus).map(async ([hostname, oldStatus]) => {
               if (!hostname) return false
   
               const health_url = `http://${hostname}:3002/api/health`
   
               let updatedStatus = {}

               try {
                 updatedStatus = await this.checkConnectionHealth(
                   health_url,
                   this.graManager,
                   'db',
                   async () => await jobQueue.retryPendingAPICalls(GRA_API_CALLS_PATH, this),
                   hostname
                 )
               } catch (err) {
                 updatedStatus[hostname] = {
                   online: false
                 }
               }
               
               statusUpdates[hostname] = {
                  ...oldStatus,
                  ...updatedStatus[hostname]
               }
   
               return updatedStatus[hostname]?.online
            })
         )
   
         const allOnline = checks.every(Boolean)
   
         fullDb['game-room-status'] = Object.fromEntries(
            Object.entries(statusUpdates).sort(([a], [b]) => a.localeCompare(b))
         )
   
         this.graManager.databases['db'] = fullDb
         this.graManager.markDirty('db')
         await this.graManager.maybeSave('db')
   
         interval = allOnline && Date.now() - allOnlineSince > 5 * 60 * 1000
            ? 60000
            : (allOnlineSince = Date.now(), 15000)
   
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

   // GFA helpers
   getPlayersDB() {
      return this.gfaManager.get('db')?.players || {}
   }

   writePlayersDB(updatedPlayers) {
      const db = this.gfaManager.get('db')
      db.players = updatedPlayers
      this.gfaManager.markDirty('db')
      this.gfaManager.maybeSave('db')
   }

   getPlayer(player_id) {
      const players = this.getPlayersDB()
      return players[player_id] || null
   }

   updatePlayer(player_id, updatedData) {
      const players = this.getPlayersDB()
      players[player_id] = updatedData
      this.writePlayersDB(players)
   }

   savePlayer = async (playerData) => {
      try {
         const players = this.getPlayersDB()
   
         const formattedPlayer = {
            id: playerData.id,
            nick_name: playerData.nick_name,
            date_add: playerData.date_add,
            last_name: playerData.last_name,
            first_name: playerData.first_name,
            gender: playerData.gender,
            birth_date: playerData.birth_date,
            league: {
               country: playerData.league_country,
               city: playerData.league_city,
               district: playerData.league_district,
               other: playerData.league_other,
            },
            games_history: {},
            facility_session: {},
            events_to_debrief: []
         }
   
         // Add/Update the player data
         players[playerData.id] = formattedPlayer
   
         // Sort the players numerically by the increment part of their ID (after the '-')
         const sortedPlayers = Object.values(players).sort((a, b) => {
            const idA = a.id?.split('-')[1] || '0'
            const idB = b.id?.split('-')[1] || '0'
            return parseInt(idA, 10) - parseInt(idB, 10)
         })

         const sortedPlayersObject = Object.fromEntries(
            sortedPlayers.map(player => [player.id, player])
         )

         this.writePlayersDB(sortedPlayersObject)

         console.log(`Player ${playerData.id} saved to local database.`)
      } catch (error) {
         console.error('Error saving player data:', error)
      }
   }

   async getPlayersWithActiveSession () {
      try {
         const players = this.getPlayersDB()
         const now = new Date()
   
         let activePlayers = Object.values(players).filter(player => {
            const dateEndStr = player.facility_session?.date_end
            if (!dateEndStr) return false
   
            const dateEnd = new Date(dateEndStr) 
            return now < dateEnd
         })
   
         return activePlayers
      } catch (error) {
         // console.error('Error fetching active players.')
         return []
      }
   }
   
   async getPlayersWithRecentSession() {
      try {
         const players = this.getPlayersDB()
         const now = new Date()
         const oneHourAgo = new Date(now.getTime() - 60 * 60000)
   
         let recentPlayers = Object.values(players).filter(player => {
            const dateEndStr = player.facility_session?.date_end
            if (!dateEndStr) return false
   
            const dateEnd = new Date(dateEndStr) // Directly using the date string
            return dateEnd <= now && dateEnd >= oneHourAgo
         })
   
         return recentPlayers
      } catch (error) {
         // console.error('Error fetching recent players.')
         return []
      }
   }

   getTeamsDB() {
      return this.gfaManager.get('db')?.teams || {}
   }

   writeTeamsDB(updatedTeams) {
      const db = this.gfaManager.get('db')
      db.teams = updatedTeams
      this.gfaManager.markDirty('db')
      this.gfaManager.maybeSave('db')
   }

   saveTeam = async(teamData, unique_identifiers, league) => {
      try {
         const teams = this.getTeamsDB()
   
         const formattedTeam = {
            id: teamData.id,
            name: teamData.name,
            nbr_of_players: teamData.nbr_of_players,
            players: unique_identifiers,
            unique_identifier: teamData.unique_identifier,
            league,
            games_history: {},
            events_to_debrief: []
         }
      
         teams[teamData.id] = formattedTeam
      
         this.writeTeamsDB(teams)
      
         console.log(`Team ${teamData.name} saved to local database`)
      } catch (error) {
         console.error('Error saving team data:', error)
      }
   }

   // Facility Controllers
   async createFacilitySession (req, res) {
      try {
         const { player_id, duration_m } = req.body
         const facility_id = this.facility_id
         
         if (!player_id || !duration_m) return res.status(400).json({ error: 'Missing required field.' })

         let player = this.getPlayer(player_id)

         if (!player) {
            try {
               const csaResponse = await axios.get(`${process.env.CSA_API_URL}/players/${player_id}`)

               if (csaResponse.status === 200) {
                  const playerData = csaResponse.data

                  await this.savePlayer(playerData)

                  // Refresh cache after saving
                  player = this.getPlayer(player_id)

                  if (!player) return res.status(500).json({ error: 'No active session for this player.'})
               }
            } catch (error) {
               return res.status(500).json({ error: 'Failed to fetch player from CSA'})
            }
         }

         const date_start = new Date().toISOString()  // Get the current date in ISO format
         const date_end = new Date(Date.now() + duration_m * 60000).toISOString()  // Add duration to start time

         if (!player) return res.status(500).json({ message: "Player object is missing in database after save." })

         player.facility_session = {
            date_start: date_start,
            duration_m: duration_m,
            date_end: date_end
         }

         this.updatePlayer(player_id, player)

         const facilitySessionData = {
            date_exec: date_start,
            duration_m: duration_m,
            facility_id: facility_id,
            player_id: player_id
         }

         // Create the job
         const apiCallRecord = {
            call_id: `call_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
            endpoint: `${process.env.CSA_API_URL}/facility-session/create`,
            payload: facilitySessionData,
            status: "pending",
            attempts: 0,
         }

         // add the job to the queue
         await jobQueue.storeApiCall(CSA_API_CALLS_PATH, apiCallRecord)

         // run the queue
         jobQueue.runQueue(CSA_API_CALLS_PATH, this)

         return res.status(200).json({ message: 'Facility session created.'})
      } catch (error) {
         return res.status(500).json({ message: 'Server error', error: error.message, stack: error.stack })

      }
   }

   async addTimeCreditsToFacilitySession(req, res) {
      try {
         const { player_id, additional_m } = req.body;
         if (!player_id || !additional_m) return res.status(400).json({ message: "Missing required field." })

         let player = this.getPlayer(player_id)

         if (!player || !player.facility_session) return res.status(404).json({ message: "Player does not have an active facility session." })

         // Extract session details
         const { date_start, duration_m, date_end } = player.facility_session;
         const now = new Date();
         const parsedDateEnd = new Date(date_end)

         let new_duration_m, new_date_start = date_start, new_date_end
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

         this.updatePlayer(player_id, player)

         // Fetch updated player sessions
/*          const updatedSessions = await getPlayersWithActiveSession()
         const recentSessions = await getPlayersWithRecentSession()

         this.socket.broadcastMessage('monitor', {
            type: 'facility_session',
            active_players: updatedSessions,
            recent_players: recentSessions
         });
 */
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

         await jobQueue.storeApiCall(CSA_API_CALLS_PATH, apiCallRecord)

         jobQueue.runQueue(CSA_API_CALLS_PATH, this)

         return res.json({ message: "Time credits updated successfully.", facility_session: player.facility_session })
      } catch (error) {
         return res.status(500).json({ message: 'Server error', error: error.message, stack: error.stack })
      }
   }

   // Player Controllers
   async getPlayerById(req, res) {
      const playerId = req.params.player_id
      try {
         let existingPlayer = this.getPlayer(playerId)

         if (existingPlayer) return res.json(existingPlayer)

         const csaResponse = await axios.get(`${process.env.CSA_API_URL}/players/${playerId}`)

         if (csaResponse.status === 200) {
            const playerData = csaResponse.data
            await this.savePlayer(playerData)
            return res.json(this.getPlayer(playerId))
         } else {
            return res.status(404).json({ error: 'Player not found in CSA.'})
         }
         
      } catch (error) {
         res.status(500).json({ error: 'Could not fetch player data.', error})
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
         const avatar = req.file

         const playerId = this.getNextPlayerId()

         if (!first_name || !last_name || !email) return res.status(400).json({ error: 'Missing required fields.' })

         if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ message: "Invalid email format." })

         if (!/^\+?\d{10,15}$/.test(phone)) return res.status(400).json({ message: "Invalid phone number format." })

         if (birth_date && isNaN(Date.parse(birth_date))) return res.status(400).json({ message: "Invalid birth date format." })

         // rename the avatar and cache it
         if (!fs.existsSync(IMAGE_CACHE_DIR)) {
            fs.mkdirSync(IMAGE_CACHE_DIR, {recursive: true})
         }

         const ext = path.extname(avatar.originalname) || '.jpg'
         const newFilename = `${playerId}${ext}`
         const destinationPath = path.join(IMAGE_CACHE_DIR, newFilename)

         // console.log('Moving avatar from:', avatar.path, 'to:', destinationPath)
         fs.renameSync(avatar.path, destinationPath)

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

         await this.savePlayer(playerData)

         const apiCallRecord = {
            call_id: `call_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
            endpoint: `${process.env.CSA_API_URL}/players`,
            payload: {
               ...playerData,
               avatarPath: destinationPath
            },
            status: "pending",
            attempts: 0,
         }

         await jobQueue.storeApiCall(CSA_API_CALLS_PATH, apiCallRecord)

         res.status(200).json({ message: 'Player data submitted.'})

         jobQueue.runQueue(CSA_API_CALLS_PATH, this)
      } catch (error) {
         res.status(500).json({ message: "Server error", error })
      }
   }

   // Team Controllers
   async getTeamById(req, res) {
      try {
         const teamId = req.params.team_id
         let teams = this.getTeamsDB

         // Check if team data exist
         if (teams[teamId]) return res.json(teams[teamId])

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

            teams[teamId] = transformedData
            this.writeTeamsDB(teams)

            return res.json(transformedData)
         } else {
            return res.status(404).json({ error: 'Team not found in CSA.' })
         }
      } catch (error) {
         res.status(500).json({ message: 'Could not fetch team data.', error })
      }
   }

   async createTeam (req, res) {
      try {
          const { unique_identifiers, leagues } = req.body;
  
          if (!unique_identifiers || unique_identifiers.length < 2) {
              return res.status(400).json({ message: "Missing required field." });
          }
  
          const formattedIdentifiers = unique_identifiers.sort((a, b) => {  
              const aParts = a.split('-');
              const bParts = b.split('-');
              if (aParts.length !== 2 || bParts.length !== 2) return 0
              return parseInt(aParts[1], 10) - parseInt(bParts[1], 10);
          }).join(',');
  
          let team;
  
          /* // If team exists in the local database, skip processing and return success response
          if (team) {
              console.log(`Team ${formattedIdentifiers} already exists in local database.`);
              return res.json({ message: "Team already exists in the local database.", team: team });
          } */
  
          // If player does not exist, fetch from CSA
          try {
              console.log(`Fetching team ${formattedIdentifiers} from CSA...`);
              const csaResponse = await axios.get(`${process.env.CSA_API_URL}/teams/${formattedIdentifiers}`);
  
              if (csaResponse.status === 200) {
                  await this.saveTeam(csaResponse.data, unique_identifiers, leagues);
                  team = this.getTeamsDB()[formattedIdentifiers]
  
                  // If the team still doesn't exist in the local DB after saving, return an error
                  if (!team) {
                      return res.status(500).json({ message: "Failed to store team in the local database." });
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
  
          if(!team) {
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
            await this.saveTeam(teamData, unique_identifiers, leagues)

            team = this.getTeamsDB()[formattedIdentifiers]

             // Store API call details locally
            const apiCallRecord = {
               call_id: `call_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
               endpoint: `${process.env.CSA_API_URL}/teams`,
               payload: teamData,
               status: "pending",
               attempts: 0,
            };

            await jobQueue.storeApiCall(CSA_API_CALLS_PATH, apiCallRecord);

            jobQueue.runQueue(CSA_API_CALLS_PATH, this)
          }

          res.json({ message: "Player added to queue for processing." });
  
      } catch (error) {
          console.error("Error processing team creation:", error.message);
          res.status(500).json({ message: "Server error" });
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
   async isGameRoomAvailable (req, res) {
      try {
         const { gra_id } = req.params
         const { available, enabled, room, rules } = req.body
   
         const fullDb = this.graManager.get('db') || {}
         if (!fullDb['game-room-status']) fullDb['game-room-status'] = {}
     
         const db = fullDb['game-room-status']
         let hostname = `${gra_id}`

         if (!db[hostname]) db[hostname] = {}
   
         db[hostname].online = true
         db[hostname].isAvailable = available
         db[hostname].enabled = enabled
         db[hostname].roomType = room
         db[hostname].rules = rules
   
         if(db[hostname].online) this.reportErrorToCentral.resolveError({message: `${hostname} is offline.`})
   
         const sortedDb = Object.fromEntries(
            Object.entries(db).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
         )
   
         fullDb['game-room-status'] = sortedDb
         this.graManager.databases['db'] = fullDb
         this.graManager.markDirty('db')
         await this.graManager.maybeSave('db')

         let previousAvailability = null
   
         if (db[hostname].isAvailable !== previousAvailability) {
            const gameRoomId = `game-room-${gra_id.match(/\d+/)[0]}`
            this.socket.broadcastMessage(gameRoomId, {
               type: 'roomAvailable',
               message: 'Room is now available, proceed with the scan.',
               isAvailable: db[hostname].isAvailable
            })

            previousAvailability = db[hostname].isAvailable
         }   
         res.send(`Game Room ${gra_id} is now available`)
      } catch (error) {
         res.status(500).json({message: 'Server error', error: error})
      }
   }

   isUpcomingGameSessionAtGameRoom (req, res) {
      const { gra_id } = req.params
      const hostname = `${gra_id}.local`
      const upcomingSessions = this.graManager.get('waiting-game-session')

      if (!upcomingSessions) {
         return res.status(500).json({ error: 'Error reading upcoming game session database' });
      }
   
      const sessionsForGra = upcomingSessions[hostname];
      const isUpcoming = Array.isArray(sessionsForGra) && sessionsForGra.length !== 0

      return res.json({ is_upcoming: isUpcoming })
   }

   async toggleGameRoomStatus(req, res) {
      try {
         const { gra_id } = req.params
         const { status: newStatus } = req.body

         const hostname = `${gra_id}.local`
         const fullDb = this.graManager.get('db') || {}
         if (!fullDb['game-room-status']) fullDb['game-room-status'] = {}
     
         const db = fullDb['game-room-status']

         if (!db[hostname]) db[hostname] = {}

         db[hostname].online = true
         db[hostname].enabled = newStatus

         this.graManager.markDirty('db')
         await this.graManager.maybeSave('db')

         this.socket.broadcastMessage('monitor', {
            type: 'toggleRoom',
            states: db
         })

         try {
            const response = await axios.post(`http://${hostname}:3002/api/toggle-room`, {
               status: newStatus
            })

            if (response.status === 200) {
               res.json('success')
            }
         } catch (error) {
            console.error(`Can't toggle ${hostname}`, error)
         }
      } catch (error) {
         return res.status(500).json({message: 'Server error', error: error})
      }
   }

   // Game Session Controller
   async uploadGameSession (req, res) {
      try {
         const { id, players, team, roomType, gameRule, gameLevel, durationStheory, isWon, score, isCollaborative, log, parentGsId } = req.body
         
         const currentPlayers = this.getPlayersDB()
         const currentTeams = this.getTeamsDB()

         if (Array.isArray(players)) {
            for (const player of players) {
               if (player.id) {
                  currentPlayers[player.id] = {
                     ...(currentPlayers[player.id] || {}),
                     ...player
                  }
               }
            }
         }

         if (team && team.id) {
            currentTeams[team.id] = {
               ...(currentTeams[team.id] || {}),
               ...team
            }
         }

         this.writePlayersDB(currentPlayers)
         this.writeTeamsDB(currentTeams)

         // prepare payload for CSA
         const roomKey = `${roomType} > ${gameRule} > L${gameLevel}`
         let duration_s_actual = 0

         if (team && team.id && currentTeams[team.id]?.games_history?.[roomKey]?.best_time) {
            duration_s_actual = currentTeams[team.id].games_history[roomKey].best_time;
         } else if (Array.isArray(players)) {
            for (const player of players) {
               const time = currentPlayers[player.id]?.games_history?.[roomKey]?.best_time;
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
               const events = currentPlayers[player.id]?.events_to_debrief
               if (Array.isArray(events)) {
                  game_log.push(...events)
               }
            }
         }

         game_log = game_log.map(event => typeof event === 'object' ? JSON.stringify(event) : event).join(',')
         const flattenedLog = log && log.length ? log.map(event => typeof event === 'object' ? JSON.stringify(event) : event).join(',') : null

         const gameSessionData = {
            id: id,
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

         //console.log(gameSessionData)

         // Store API call details locally
         const apiCallRecord = {
            call_id: `call_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
            endpoint: `${process.env.CSA_API_URL}/game-sessions/`,
            payload: gameSessionData,
            status: "pending",
            attempts: 0,
         }

         await jobQueue.storeApiCall(CSA_API_CALLS_PATH, apiCallRecord)

         jobQueue.runQueue(CSA_API_CALLS_PATH, this)

         res.status(200).json({ message: 'Success'})
      } catch (error) {
         res.status(500).json({ message: 'Server error', error: error})
      }
   }

   // RFID Controllers and helpers
   getSection(manager, sectionName) {
      const db = manager.get('db')
      db[sectionName] = db[sectionName] || {}
      return db[sectionName]
   }

   writeSection(manager) {
      manager.markDirty('db')
      manager.maybeSave('db')
   }

   getOrCreateRoomScanData(roomKey) {
      const db = this.gfaManager.get('db')
      db.scans = db.scans || {}
      if (!db.scans[roomKey]) {
         db.scans[roomKey] = {
            booth: [],
            'game-room': [],
            status: 'waiting',
            boothConfirmed: false
         }

         this.writeSection(this.gfaManager)
      }
      return db.scans[roomKey]
   }

   updateRoomScanData(roomKey, updatedRoomData) {
      const db = this.gfaManager.get('db')
      db.scans = db.scans || {}
      db.scans[roomKey] = updatedRoomData
      this.writeSection(this.gfaManager)
   }

   findAvailableRoom() {
      const statuses = this.getSection(this.graManager, 'game-room-status')

      let fallbackRoom = null

      for (const hostname in statuses) {
         const room = statuses[hostname]

         // First priority: isAvailable === true
         if (room.isAvailable) {
            return hostname.replace('.local', '')
         }

         // Fallback: first room where hasPending === false
         if (!room.hasPending && !fallbackRoom) {
            fallbackRoom = hostname.replace('.local', '')
         }
      }

      return fallbackRoom
   }

   isRoomBusy(roomHostname) {
      const db = this.getSection(this.graManager, 'game-room-status')
      const status = db[roomHostname]
      return !status?.isAvailable
   }

   markRoomHasPending(roomHostname, hasPending) {
      const status = this.getSection(this.graManager, 'game-room-status')
      if (status[roomHostname]) {
         status[roomHostname].hasPending = hasPending
         this.writeSection(this.graManager)
      }
   }

   resetRoomScanData(roomKey) {
      const defaultData = { booth: [], 'game-room': [], status: 'waiting', boothConfirmed: false }
      this.updateRoomScanData(roomKey, defaultData)
   }
   
   async handleRfidScannedAtBooth(req, res) {
      const { booth_id } = req.params
      const { rfid_tag, player } = req.body

      if (!rfid_tag) return res.status(400).send('Missing RFID tag')

      const roomKey = this.findAvailableRoom()
      if (!roomKey) return res.status(403).send('All rooms busy')

      const roomData = this.getOrCreateRoomScanData(roomKey)
      if(!roomData.booth.includes(player)) {
         roomData.booth.push(player)
         this.updateRoomScanData(roomKey, roomData)
      }

      this.socket.broadcastMessage(`booth-${booth_id}`, { type: 'rfid_scanned', location: 'booth', id: booth_id, player})
      this.socket.broadcastMessage(`monitor`, { type: 'rfid_scanned', location: 'booth', id: booth_id, player})
      
      const result = await this.confirmBooth(booth_id, roomKey, roomData, player)

      return res.send(result.status === 'ok' ? 'ok' : result.message)
   }

   async handleRfidScannedAtGameRoom(req, res) {
      const { gra_id } = req.params
      const { rfid_tag, player } = req.body
   
      if (!rfid_tag) return res.status(400).send('Missing RFID tag')
   
      const roomKey = `gra-${gra_id}`
      const hostname = `${roomKey}.local`
   
      if (this.isRoomBusy(hostname)) {
         return res.status(400).send('Game room busy. Please wait.')
      }
   
      const roomData = this.getOrCreateRoomScanData(roomKey)
      if (!roomData['game-room'].includes(player)) {
         roomData['game-room'].push(player)
         this.updateRoomScanData(roomKey, roomData)
      }
   
      this.socket.broadcastMessage('monitor', { type: 'rfid_scanned', location: 'game-room', id: gra_id, player })
      this.socket.broadcastMessage(`game-room-${gra_id}`, { 
         type: 'rfid_scanned', 
         location: 'game-room',
         id: gra_id, 
         player
      })
   
      const result = await this.tryStartGameSession(gra_id, roomKey, roomData)
   
      return res.send(result.status === 'ok' ? 'ok' : result.message)
   }   

   async confirmBooth(booth_id, roomKey, roomData, player) {
      try {
         const message = await this.socket.waitForMessage(`booth-${booth_id}`)
         if (message.type !== 'confirm') {
            return { status: 'error', message: 'Booth not confirmed' }
         }
   
         roomData.boothConfirmed = true
         this.updateRoomScanData(roomKey, roomData)
   
         this.socket.broadcastMessage(`booth-${booth_id}`, { type: 'destination', goal: roomKey })
         const gra_id = roomKey.split('-')[1]
         this.socket.broadcastMessage(`game-room-${gra_id}`, { 
            type: 'booth_confirmed', 
            location: 'game-room',
             id: gra_id, 
             player
         })

         const hostname = `${roomKey}.local`
         const db = this.graManager.get('db')
         
         const gameSessionData = await this.createGameSession(roomData.booth, hostname)

         if (!db['waiting-game-session']) db['waiting-game-session'] = {}
         db['waiting-game-session'][hostname] = { data: gameSessionData }
   
         this.graManager.databases['db'] = db
         this.graManager.markDirty('db')
         await this.graManager.maybeSave('db')
   
         this.markRoomHasPending(hostname, true)
   
         return { status: 'ok', message: 'Booth confirmed and session prepared.' }
      } catch (err) {
         return { status: 'error', message: 'Booth confirmation failed', error: err }
      }
   }

   async tryStartGameSession(gra_id, roomKey, roomData) {
      const hostname = `${roomKey}.local`
      const db = this.graManager.get('db')
      const pendingSessions = db['waiting-game-session'] = db['waiting-game-session'] || {}
      const sessionRecord = pendingSessions[hostname]
   
      if (!roomData.boothConfirmed) {
         return { status: 'error', message: 'Booth not confirmed' }
      }
   
      if (!sessionRecord) {
         return { status: 'error', message: 'No session prepared' }
      }
   
      const boothSorted = [...roomData.booth].sort()
      const gameRoomSorted = [...roomData['game-room']].sort()
   
      if (JSON.stringify(boothSorted) !== JSON.stringify(gameRoomSorted)) {
         return { status: 'waiting', message: 'Waiting for all players...' }
      }
   
      // Players match — start session
      const sessionData = sessionRecord.data
      sessionData.book_room_until = new Date(Date.now() + 6 * 60 * 1000).toISOString()
   
      const sessionHistory = db['session-history'] = db['session-history'] || {}

      sessionHistory[roomKey] = { book_room_until: sessionData.book_room_until }
      this.graManager.markDirty('db')
      await this.graManager.maybeSave('db')
   
      const apiCallRecord = {
         call_id: `call_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
         endpoint: `http://${hostname}:3002/api/start-game-session`,
         payload: sessionData,
         status: "pending",
         attempts: 0,
      }
   
      await jobQueue.storeApiCall(GRA_API_CALLS_PATH, apiCallRecord)
      jobQueue.runQueue(GRA_API_CALLS_PATH, this)
   
      this.socket.broadcastMessage(`game-room-${gra_id}`, { type: 'status_update', status: 'ready' })
   
      this.markRoomHasPending(hostname, false)
      this.resetRoomScanData(roomKey)
   
      delete pendingSessions[hostname]
      this.graManager.markDirty('db')
      await this.graManager.maybeSave('db')
   
      return { status: 'ok', message: 'Session started' }
   }

   async createGameSession (players, hostname) {
      try {
         const db = this.graManager.get('db')
         const roomStatus = db['game-room-status'] || {}
         const teamsData = this.getTeamsDB()
         const playersData = this.getPlayersDB()

         const gameSessionId = this.getNextGameSessionId()

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
            ? players.map(playerId => playersData[playerId] || { id: playerId, message: "Player not found" }) 
            : []
   
         if (!roomStatus[hostname]) {
            throw new Error(`No room data found for ${hostname}`)
         }
   
         const { roomType, rules } = roomStatus[hostname]
   
         if (!rules || rules.length === 0) {
            throw new Error('No rules available for this room')
         }
   
         const selectedRule = rules[Math.floor(Math.random() * rules.length)]
         const roomInfo = `${roomType} > ${selectedRule} > L1`
   
         // Update players games_history
         for (const playerId of players) {
            if (!playersData[playerId]) continue
   
            if (!playersData[playerId].games_history) playersData[playerId].games_history = {}
   
            if (!playersData[playerId].games_history[roomInfo]) playersData[playerId].games_history[roomInfo] = { best_time: 0, played: 0, played_today: 0 }
         }
   
         // Update team games_history
         if (teamInfo) {
            if (!teamInfo.games_history) teamInfo.games_history = {}
   
            if (!teamInfo.games_history[roomInfo]) teamInfo.games_history[roomInfo] = { best_time: 0, played: 0, played_today: 0 }
         }
   
         this.writePlayersDB(playersData)
         if (teamInfo) this.writeTeamsDB(teamsData)
   
         const gameSessionData = {
            id: gameSessionId,
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