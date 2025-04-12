import path from 'path'
import axios from 'axios'
import { fileURLToPath } from 'url'
import { Mutex } from 'async-mutex'

const mutex = new Mutex()

import { getPlayerNextIncrement, getPlayersWithActiveSession, getPlayersWithRecentSession, readDatabase, savePlayer, storeApiCall, updateApiCallStatus, updatePlayerId } from '../utils/dbHelpers.js'
import { jobQueue } from '../utils/queue.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let facilityInstance = null

const API_CALLS_PATH = path.join(__dirname, '../assets/csa/calls.json')
const DB_PATH = path.join(__dirname, '../assets/gfa/db.json')

const playersController = {
   setFacilityInstance: (instance) => {
      facilityInstance = instance
   },

   getById: async(req, res) => {
      const release = await mutex.acquire()
      try {
         const playerId = req.params.player_id

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
         facilityInstance.reportErrorToCentral.resolveError({error: `Error fetching player ${playerId} from CSA`})
      } catch (error) {
         facilityInstance.reportErrorToCentral.report({
            error: `Error fetching player ${playerId} from CSA`,
            stack: error.stack || null
         })
         res.status(500).json({ error: 'Could not fetch player data.'})
      } finally {
         release()
      }
   },

   search: async(req, res) => {
      const facility_id = facilityInstance.facility_id
      const { email, phone, first_name, last_name } = req.query
      if (!email && !phone && !first_name && !last_name) return res.status(400).json({ error: 'At least one search parameter is required.' })
      try {
         const csaResponse = await axios.get(`${process.env.CSA_API_URL}/players/search`, {
            params: { email, phone, first_name, last_name }
         })

         const filteredData = csaResponse.data.filter(player => {
            return player.id.startsWith(`F${facility_id}-`)
         })

         const sortedData = filteredData.sort((a, b) => {
            const numA = parseInt(a.id.split('-')[1], 10)
            const numB = parseInt(b.id.split('-')[1], 10)
            return numA - numB
         })

         facilityInstance.reportErrorToCentral.resolveError({ error: 'CSA not reachable'})
         return res.json(sortedData)
      } catch (error) {
         if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            facilityInstance.reportErrorToCentral.report({
               error: 'CSA not reachable',
               stack: error.stack || null
            })

            // fallback to local
            try {
               const cache = readDatabase(DB_PATH, {});
               const players = cache.players || {};
            
               const results = Object.values(players).filter(player => {
                  if (email && player.email !== email) return false;
                  if (phone && player.phone !== phone) return false;
                  if (first_name && !player.first_name?.toLowerCase().includes(first_name.toLowerCase())) return false;
                  if (last_name && !player.last_name?.toLowerCase().includes(last_name.toLowerCase())) return false;
                  return true;
               });
            
               results.sort((a, b) => {
                  const numA = parseInt(a.id.split('-')[1], 10);
                  const numB = parseInt(b.id.split('-')[1], 10);
                  return numA - numB;
               });
            
               if (results.length === 0) {
                  return res.status(503).json({ message: 'csa_not_reachable' });
               }
            
               return res.status(200).json(results);
            } catch (error) {
               console.error('Local DB fallback error:', error);
               return res.status(500).json({ error: 'Failed to query local database.' });
            }
            
         }
      }
   },

   create: async(req, res) => {
      const release = await mutex.acquire()
      const facility_id = facilityInstance.facility_id

      try {
         const { nick_name, email, phone, last_name, first_name, gender, birth_date, notes, league_country, league_city, league_district, league_other } = req.body

         if (!first_name || !last_name || !email) return res.status(400).json({ error: 'Missing required fields.' })

         if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Invalid email format." })

         if (!/^\+?\d{10,15}$/.test(phone)) return res.status(400).json({ error: "Invalid phone number format." })

         if (birth_date && isNaN(Date.parse(birth_date))) return res.status(400).json({ error: "Invalid birth date format." })

         const next_increment = getPlayerNextIncrement(facility_id)
         let playerId = `F${facility_id}-${next_increment}`

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

         const generateCallId = () => `call_${Date.now()}_${Math.floor(Math.random() * 10000)}`
         const apiCallRecord = {
            call_id: generateCallId(),
            endpoint: `${process.env.CSA_API_URL}/players`,
            payload: playerData,
            status: "pending",
            attempts: 0,
         }

         await storeApiCall(API_CALLS_PATH, apiCallRecord)

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

                  await updateApiCallStatus(API_CALLS_PATH, apiCallRecord.call_id, 'completed')
                  facilityInstance.reportErrorToCentral.resolveError({error: `Failed API call to ${apiCallRecord.endpoint}`})
               } catch (error) {
                  const failureReason = error.code === 'ECONNREFUSED' || error.message.includes('Network') 
                     ? 'host_offline'
                     : 'other'

                  await updateApiCallStatus(API_CALLS_PATH, apiCallRecord.call_id, 'failed', failureReason)

                  facilityInstance.reportErrorToCentral.report({
                     error: `Failed API call to ${apiCallRecord.endpoint}`,
                     stack: error.stack || null
                  })
               }
            }
         })

         facilityInstance.reportErrorToCentral.resolveError({error: 'Error processing player creation'})
      } catch (error) {
         facilityInstance.reportErrorToCentral.report({
            error: 'Error processing player creation',
            stack: error.stack || null
         })
         res.status(500).json({ error: "Server error" })
      } finally {
         release()
      }
   },

   getPlayersWithActiveSession: async(req, res) => {
      try {
         let activePlayers = await getPlayersWithActiveSession()
         facilityInstance.reportErrorToCentral.resolveError({error: 'Could not fetch active player data'})
         res.status(200).json(activePlayers)
      } catch (error) {
         facilityInstance.reportErrorToCentral.report({
            error: 'Could not fetch active player data',
            stack: null
         })
         res.status(500).json({ error: 'Could not fetch active player data'})
      }
   },

   getPlayersWithRecentSession: async(req, res) => {
      try {
         let recentPlayers = await getPlayersWithRecentSession()
         facilityInstance.reportErrorToCentral.resolveError({error: 'Could not fetch recent player data'})
         res.status(200).json(recentPlayers)
      } catch (error) {
         facilityInstance.reportErrorToCentral.report({
            error: 'Could not fetch recent player data',
            stack: null
         })
         res.status(500).json({ error: 'Could not fetch recent player data'})
      }
   }
}

export default playersController