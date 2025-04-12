import path from 'path'
import { fileURLToPath } from 'url'
import { Mutex } from 'async-mutex'
import { readDatabase, storeApiCall, updateApiCallStatus, writeDatabase } from '../utils/dbHelpers.js'
import { jobQueue } from '../utils/queue.js'
import axios from 'axios'

const mutex = new Mutex()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DB_PATH = path.join(__dirname, '../assets/gfa/db.json')
const SCANS_PATH = path.join(__dirname, '../assets/gfa/scans.json')
const GAME_ROOM_STATUS_PATH = path.join(__dirname, '../assets/gra/game-room-status.json')
const GRA_API_CALLS_PATH = path.join(__dirname, '../assets/gra/calls.json')
const WAITING_GAME_SESSION_PATH = path.join(__dirname, '../assets/gra/waiting-game-session.json')
const ROOM_TO_GAME_PATH = path.join(__dirname, '../assets/gra/room-to-game.json')

let facilityInstance = null

const rfidController = {
   setFacilityInstance: (instance) => {
      facilityInstance = instance
   },

   gameRoom: async (req, res) => {
      const { gra_id } = req.params
      const { rfid_tag, player } = req.body
      //const roomKey = `gra-${gra_id}`
      //const hostname = `${roomKey}.local`
      const roomKey = `localhost`
      const hostname = `localhost`

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

         facilityInstance.socket.broadcastMessage(`game-room-${gra_id}`, {
            type: 'rfid_scanned',
            location: 'game-room',
            id: gra_id,
            player
         })

         facilityInstance.socket.broadcastMessage('monitor', {
            type: 'rfid_scanned',
            location: 'game-room',
            id: gra_id,
            player
         })

         await processRfidScan('game-room', gra_id)
         
         return res.send('ok')
      } catch (error) {
         return res.status(500).send('Error processing scan')
      }
   },

   booth: async (req, res) => {
      const { booth_id } = req.params
      const { rfid_tag, player } = req.body
      // const roomKey = `gra-${booth_id}`
      const roomKey = 'localhost'

      if (!rfid_tag) {
         return res.status(400).send('Missing RFID tag')
      }

      try {
         let allScans = readDatabase(SCANS_PATH, {})
         
         if (!allScans[roomKey]) {
            allScans[roomKey] = { booth: [], 'game-room': [], status: 'waiting', boothConfirmed: false }
         }

         const roomData = allScans[roomKey]

         if (!roomData['booth'].includes(player)) {
            roomData['booth'].push(player)
         }

         writeDatabase(SCANS_PATH, allScans)

         facilityInstance.socket.broadcastMessage(`booth-${booth_id}`, {
            type: 'rfid_scanned',
            location: 'booth',
            id: booth_id,
            player
         })
   
         facilityInstance.socket.broadcastMessage('monitor', {
            type: 'rfid_scanned',
            location: 'booth',
            id: booth_id,
            player
         })

         await processRfidScan('booth', booth_id)
         
         return res.send('ok')
      } catch (error) {
         return res.status(500).send('Error processing scan')
      }
   }
}

const processRfidScan = async (location, id) => {
   const release = await mutex.acquire()

   try {
      // const roomKey = `gra-${id}`
      //const hostname = `${roomKey}.local`
      const hostname = 'localhost'
      const roomKey = `localhost`

      const allScans = readDatabase(SCANS_PATH, {})
      const gameRoomStatus = readDatabase(GAME_ROOM_STATUS_PATH, {})
      const pendingSessions = readDatabase(WAITING_GAME_SESSION_PATH, {})
      const roomStatus = gameRoomStatus[hostname]
      const sessionRecord = pendingSessions[hostname]
      
      // Notify front end if room is busy
      if (location === 'game-room' && roomStatus && roomStatus.isAvailable === false) {
         console.warn(`Game room ${roomKey} is currently busy.`)
         availabilityMessage = 'Game room is currently busy. Please wait.'
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
         facilityInstance.socket.waitForMessage(`booth-${id}`).then(async (message) => {
            if (message.type === 'confirm') {
               //console.log(`Booth confirmed for ID: ${id}`)
               roomData.boothConfirmed = true
               writeDatabase(SCANS_PATH, allScans)

               // Create Game Session Data
               const gameSessionData = await createGameSession(roomData.booth, roomKey)
               
               console.log(gameSessionData)

               // Store temporarily
               pendingSessions[hostname] = {
                  data: gameSessionData
               }

               writeDatabase(WAITING_GAME_SESSION_PATH, pendingSessions)
            }
         })

         return { status: 'ok', message: 'Booth confirmation pending.' }
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
                     facilityInstance.socket.broadcastMessage('monitor', {
                        type: 'confirmed',
                        message: `Scan processing completed for room ${roomKey}`
                     })
                     facilityInstance.reportErrorToCentral.resolveError({ error: `Failed to start game session for room ${roomKey}` })
                  } catch (error) {
                     await updateApiCallStatus(GRA_API_CALLS_PATH, apiCallRecord.call_id, 'failed')
                     facilityInstance.reportErrorToCentral.report({
                        error: `Failed to start game session for room ${roomKey}`,
                        stack: error.stack || null
                     })
                  }
               }
            })

            roomData.status = 'ready'
            writeDatabase(SCANS_PATH, allScans)

            facilityInstance.socket.broadcastMessage(`${location}-${id}`, {
               type: 'status_update',
               status: roomData.status
            })

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
   } finally {
      release()
   }
}

const createGameSession = async (players, roomKey) => {
   const release = await mutex.acquire()  // Acquire the lock

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
   } finally {
      release()   // Release the lock
   }
}

export default rfidController