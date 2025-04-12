import path from 'path'
import axios from 'axios'
import { Mutex } from 'async-mutex'
import { fileURLToPath } from 'url'

import { getPlayersWithActiveSession, getPlayersWithRecentSession, migrateStalePlayerId, readDatabase, savePlayer, storeApiCall, updateApiCallStatus, writeDatabase } from '../utils/dbHelpers.js'
import { jobQueue } from '../utils/queue.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let facilityInstance = null
const mutex = new Mutex()

const API_CALLS_PATH = path.join(__dirname, '../assets/csa/calls.json')
const DB_PATH = path.join(__dirname, '../assets/gfa/db.json')

const facilitySessionController = {
   setFacilityInstance: (instance) => {
      facilityInstance = instance
   },

   createFacilitySession: async(req, res) => {
      const release = await mutex.acquire()

      try {
         const { player_id, duration_m } = req.body

         if (!facilityInstance || !facilityInstance.facility_id) return res.status(500).json({ error: 'Facility not initialized.' })

         const facility_id = facilityInstance.facility_id
         
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
               
               facilityInstance.reportErrorToCentral.resolveError({error: `Player ${player_id} not found.`})
            } catch (error) {
               facilityInstance.reportErrorToCentral.report({
                  error: `Player ${player_id} not found.`,
                  stack: error.stack || null
               })
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

         facilityInstance.socket.broadcastMessage('monitor', {
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

         const generateCallId = () => `call_${Date.now()}_${Math.floor(Math.random() * 10000)}`
         const apiCallRecord = {
            call_id: generateCallId(),
            endpoint: `${process.env.CSA_API_URL}/facility-session/create`,
            payload: facilitySessionData,
            status: "pending",
            attempts: 0,
         }

         await storeApiCall(API_CALLS_PATH, apiCallRecord)

         const jobId = Date.now()

         jobQueue.addJob({
            id: jobId,
            run: async() => {
               try {
                  await axios.post(apiCallRecord.endpoint, apiCallRecord.payload)
                  // console.log(`Job ${jobId} success.`)
                  await updateApiCallStatus(API_CALLS_PATH, apiCallRecord.call_id, 'completed')
                  facilityInstance.reportErrorToCentral.resolveError({error: `Failed API call to ${apiCallRecord.endpoint}`})
               } catch (error) {
                  // console.log(`Job ${jobId} failed.`)
                  await updateApiCallStatus(API_CALLS_PATH, apiCallRecord.call_id, 'failed')

                  facilityInstance.reportErrorToCentral.report({
                     error: `Failed API call to ${apiCallRecord.endpoint}`,
                     stack: error.stack || null
                  })
               }
            }
         })

         return res.status(200).json({ message: 'Facility session created.'})
      } catch (error) {
         return res.status(500).json({ message: 'Server error', error: error })
      } finally {
         release()
      }
   },

   addTimeCredits: async(req, res) => {
      const release = await mutex.acquire()

      try {
         const { player_id, additional_m } = req.body;

         if (!facilityInstance || !facilityInstance.facility_id) return res.status(500).json({ error: "Facility instance is not initialized." })

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

         facilityInstance.socket.broadcastMessage('monitor', {
            type: 'facility_session',
            active_players: updatedSessions,
            recent_players: recentSessions
         });

         // Prepare the session data for the API call
         const facilitySessionData = {
            date_exec: new_date_start,
            duration_m: new_duration_m,
            facility_id: facilityInstance.facility_id,
            player_id: player_id
         };

         // Store API call details locally
         const generateCallId = () => `call_${Date.now()}_${Math.floor(Math.random() * 10000)}`
         const apiCallRecord = {
            call_id: generateCallId(),
            endpoint: apiEndpoint,
            payload: facilitySessionData,
            status: "pending",
            attempts: 0,
         }

         await storeApiCall(API_CALLS_PATH, apiCallRecord)

         const jobId = Date.now()
         jobQueue.addJob({
            id: jobId,
            run: async () => {
               try {
                  await axios.post(apiCallRecord.endpoint, apiCallRecord.payload)
                  // console.log(`Job ${jobId} success.`)
                  await updateApiCallStatus(API_CALLS_PATH, apiCallRecord.call_id, 'completed')
                  facilityInstance.reportErrorToCentral.report({error: `Failed API call to ${apiCallRecord.endpoint}`})
               } catch (error) {
                  // console.log(`Job ${jobId} failed.`)
                  await updateApiCallStatus(API_CALLS_PATH, apiCallRecord.call_id, 'failed')
               
                  facilityInstance.reportErrorToCentral.report({
                     error: `Failed API call to ${apiCallRecord.endpoint}`,
                     stack: error.stack || null
                  })
               }
            },
         })

         return res.json({ message: "Time credits updated successfully.", facility_session: player.facility_session })
      } catch (error) {
         return res.status(500).json({ message: 'Server error', error: error })
      } finally {
         release()
      }
   }
}

export default facilitySessionController