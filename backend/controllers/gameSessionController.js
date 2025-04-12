import path from 'path'
import axios from 'axios'
import { Mutex } from 'async-mutex'
import { fileURLToPath } from 'url'
import { readDatabase, storeApiCall, updateApiCallStatus, writeDatabase } from '../utils/dbHelpers.js'
import { jobQueue } from '../utils/queue.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let facilityInstance = null
const mutex = new Mutex()

const CSA_API_CALLS_PATH = path.join(__dirname, '../assets/csa/calls.json')
const DB_PATH = path.join(__dirname, '../assets/gfa/db.json')

const gameSessionController = {
   setFacilityInstance: (instance) => {
      facilityInstance = instance
   },

   uploadGameSession: async(req, res) => {
      const release = await mutex.acquire()

      try {
         const facility_id = facilityInstance.facility_id
         const { players, team, roomType, gameRule, gameLevel, durationStheory, isWon, score, isCollaborative, log } = req.body
         
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
            facility_id,
            team_id: team?.id ?? null,
            player_id: team?.id ? null : players[0]?.id,
            is_won: isWon,
            score
         }

         // console.log(gameSessionData)

         // Store API call details locally
         const generateCallId = () => `call_${Date.now()}_${Math.floor(Math.random() * 10000)}`
         const apiCallRecord = {
            call_id: generateCallId(),
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

                  facilityInstance.reportErrorToCentral.resolveError({error: `Failed API call to ${apiCallRecord.endpoint}`})
              } catch (error) {
                  facilityInstance.reportErrorToCentral.report({
                     error: `Failed API call to ${apiCallRecord.endpoint}`,
                     stack: error.stack || null
                  })
                  await updateApiCallStatus(CSA_API_CALLS_PATH, apiCallRecord.call_id, 'failed')
              }
             },
         })

         facilityInstance.reportErrorToCentral.resolveError({error: `Error processing game session`})
         res.status(200).json({ message: 'Success'})
      } catch (error) {
         facilityInstance.reportErrorToCentral.report({
            error: `Error processing game session`,
            stack: error.stack || null
         })
         res.status(500).json({ message: 'Server error', error: error})
      } finally {
         release()
      }
   },
}

export default gameSessionController