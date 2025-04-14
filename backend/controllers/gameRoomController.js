import path from 'path'
import axios from 'axios'
import { fileURLToPath } from 'url'
import { Mutex } from 'async-mutex'

import { readDatabase, writeDatabase } from '../utils/dbHelpers.js'


const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let facilityInstance = null
const mutex = new Mutex()

const GAME_ROOM_STATUS_PATH = path.join(__dirname, '../assets/gra/game-room-status.json')
const WAITING_GAME_SESSION_PATH = path.join(__dirname, '../assets/gra/waiting-game-session')
const ROOM_TO_GAME_PATH = path.join(__dirname, '../assets/gra/room-to-game.json')

const gameRoomController = {
   setFacilityInstance: (instance) => {
      facilityInstance = instance
   },

   isAvailable: async (req, res) => {
      const release = await mutex.acquire()
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
   
         if(status[hostname].online) facilityInstance.reportErrorToCentral.resolveError({message: `${hostname} is offline.`})
   
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
            facilityInstance.socket.broadcastMessage(gameRoomId, {
               type: 'roomAvailable',
               message: 'Room is now available, proceed with the scan.',
               isAvailable: status[hostname].isAvailable
            })

            previousAvailability = status[hostname].isAvailable
         }   
         res.send(`Game Room ${gra_id} is now available`)
      } catch (error) {
         res.status(500).json({message: 'Server error', error: error})
      } finally {
         release()
      }
   },

   isUpcomingGameSession: (req, res) => {
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
   },

   toggleRoom: async(req, res) => {
      const release = await mutex.acquire()
      try {
         const { gra_id } = req.params
         const { status } = req.body

         const graStatus = readDatabase(GAME_ROOM_STATUS_PATH, {})

         const hostname = `${gra_id}.local`

         graStatus[hostname].online = true
         graStatus[hostname].enabled = status

         writeDatabase(GAME_ROOM_STATUS_PATH, graStatus)

         facilityInstance.socket.broadcastMessage('monitor', {
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
      } finally {
         release()
      }
   }
}

export default gameRoomController