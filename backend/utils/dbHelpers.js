import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'

dotenv.config()
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DB_PATH = path.join(__dirname, '../assets/gfa/db.json')

export const readDatabase = (filePath, defaultValue = {}) => {
   try {
      const dirPath = path.dirname(filePath)

      if (!fs.existsSync(dirPath)) {
         fs.mkdirSync(dirPath, { recursive: true })
      }

      if (!fs.existsSync(filePath)) {
         console.warn(`File ${filePath} not found, initializing with default values.`)
         fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf8')
         return defaultValue
      }

      const rawData = fs.readFileSync(filePath, 'utf8')
      const parsedData = JSON.parse(rawData)

      if (!parsedData || typeof parsedData !== 'object') {
         console.warn(`Invalid DB structure in ${filePath}:`, parsedData)
         return defaultValue
      }

      return parsedData
   } catch (error) {
      console.error(`Error reading ${filePath}`)
      return defaultValue
   }
}

export const writeDatabase = (filePath, data) => {
   try {
      const dirPath = path.dirname(filePath)

      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true })

      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')

      return true
   } catch (error) {
      console.error(`Error writing to ${filePath}`)
      return false
   }
}

// API CALLS
export const storeApiCall = async(filePath, apiCallRecord) => {
   const db = readDatabase(filePath, {})

   if (!db['pending_api_calls']) db['pending_api_calls'] = []

   db['pending_api_calls'].push(apiCallRecord)
   writeDatabase(filePath, db)
   console.log(`API call for ${apiCallRecord.call_id} stored.`)
}

export const updateApiCallStatus = async(filePath, call_id, status, failure_reason = null) => {
   const db = readDatabase(filePath, {})

   if (!db['pending_api_calls']) return

   const apiCallIndex = db['pending_api_calls'].findIndex(call => call.call_id === call_id)

   if (apiCallIndex !== -1) {
      db['pending_api_calls'][apiCallIndex].status = status
      db['pending_api_calls'][apiCallIndex].failure_reason = failure_reason

      writeDatabase(filePath, db)
      console.log(`API call status for ${call_id} updated to '${status}'.`)
      if (status === 'completed') await clearCompletedApiCalls(filePath)
   }
}

export const clearCompletedApiCalls = async(filePath) => {
   const db = readDatabase(filePath, {})

   if (!db['pending_api_calls']) return

   db['pending_api_calls'] = db['pending_api_calls'].filter(call => call.status !== 'completed')
   writeDatabase(filePath, db)
   console.log('Cleared completed API calls.')
}

// DB.JSON
export const savePlayer = async (playerData) => {
   try {
      const db = await readDatabase(DB_PATH, {})

      if (!db['players']) db['players'] = {}

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
      db['players'][playerData.id] = formattedPlayer

      // Sort the players numerically by the increment part of their ID (after the '-')
      const sortedPlayers = Object.values(db['players']).sort((a, b) => {
         const idA = a.id && typeof a.id === 'string' ? a.id.split('-')[1] : null
         const idB = b.id && typeof b.id === 'string' ? b.id.split('-')[1] : null

         if (idA === null || idB === null) return 0

         return parseInt(idA, 10) - parseInt(idB, 10)
      })

      // Rebuild the players object with sorted entries
      db['players'] = Object.fromEntries(sortedPlayers.map(player => [player.id, player]))

      // Write the sorted database back
      await writeDatabase(DB_PATH, db)

      console.log(`Player ${playerData.id} saved to local database.`)
   } catch (error) {
      console.error('Error saving player data:', error)
   }
}

export const saveTeam = async(teamData, unique_identifiers, league) => {
   const db = readDatabase(DB_PATH, {})

   if (!db['teams']){
       db['teams'] = {}
   }

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

   db['teams'][teamData.id] = formattedTeam

   writeDatabase(DB_PATH, db)
   console.log(`Team ${teamData.name} saved to local database`)
}

export const getPlayers = async () => {
   try {
      let db = readDatabase(DB_PATH, {})

      if (!db.players) db.players = {}

      return Object.values(db.players)
   } catch (error) {
      console.error('Error fetching players')
      return []
   }
}

export const updatePlayerId = async (oldId, newPlayerData) => {
   try {
      const db = await readDatabase(DB_PATH, {})

      const players = db.players

      const existingPlayer = players[oldId]

      if (!existingPlayer) {
         console.log(`Player with id ${oldId} does not exist.`)
         return
      }

      // Create a merged player object that keeps all old data but updates the ID and any new fields
      const updatedPlayer = {
         ...existingPlayer,
         id: newPlayerData.id // ensure the new ID overrides the old one
      }

      // Add to the db under the new ID
      db.players[newPlayerData.id] = updatedPlayer

      // Remove the old entry
      delete db.players[oldId]

      // Sort the players by ID again
      const sortedPlayers = Object.values(db.players).sort((a, b) => {
         const idA = a.id && typeof a.id === 'string' ? a.id.split('-')[1] : null
         const idB = b.id && typeof b.id === 'string' ? b.id.split('-')[1] : null

         if (idA === null || idB === null) return 0

         return parseInt(idA, 10) - parseInt(idB, 10)
      })

      db.players = Object.fromEntries(sortedPlayers.map(player => [player.id, player]))

      await writeDatabase(DB_PATH, db)

      console.log("Player data updated successfully.")
   } catch (error) {
      console.error("Error updating player:", error)
   }
}


export const getPlayerNextIncrement = (facility_id) => {
   const db = readDatabase(DB_PATH, {})
   if (!db || !db['players'] || Object.keys(db['players']).length === 0) return 1

   let numbers = []

   numbers = Object.values(db["players"])
      .map(entry => entry.id?.match(new RegExp(`^F${facility_id}-(\\d+)$`)))
      .filter(match => match)
      .map(match => parseInt(match[1], 10))

   return numbers.length === 0 ? 1 : Math.max(...numbers) + 1
}

export const getPlayersWithActiveSession = async() => {
   try {
      const db = readDatabase(DB_PATH, {})

      const now = new Date()

      let activePlayers = Object.values(db.players).filter(player => {
         if (!player.facility_session || !player.facility_session.date_end) return false

         const dateEnd = new Date(player.facility_session.date_end) // Directly using the date string

         return now < dateEnd
      })

      return activePlayers
   } catch (error) {
      // console.error('Error fetching active players.')
      return []
   }
}

export const getPlayersWithRecentSession = async() => {
   try {
      const db = readDatabase(DB_PATH, {})

      const now = new Date()

      const oneHourAgo = new Date(now.getTime() - 60 * 60000)

      let recentPlayers = Object.values(db.players).filter(player => {
         if (!player.facility_session || !player.facility_session.date_end) return false

         const dateEnd = new Date(player.facility_session.date_end) // Directly using the date string

         return dateEnd <= now && dateEnd >= oneHourAgo
      })

      return recentPlayers
   } catch (error) {
      // console.error('Error fetching recent players.')
      return []
   }
}

export const migrateStalePlayerId = (cache, correctPlayer) => {
   const keys = Object.keys(cache.players || {});

   for (const staleId of keys) {
      const stalePlayer = cache.players[staleId];

      const isMatch =
         stalePlayer.first_name === correctPlayer.first_name &&
         stalePlayer.last_name === correctPlayer.last_name &&
         stalePlayer.nick_name === correctPlayer.nick_name &&
         stalePlayer.gender === correctPlayer.gender;

      if (isMatch) {
         cache.players[correctPlayer.id] = {
            ...stalePlayer,
            id: correctPlayer.id, // make sure the ID inside the object is correct too
         };
         delete cache.players[staleId];

         writeDatabase(DB_PATH, cache)

         console.log(`Migrated player from ${staleId} ➜ ${correctPlayer.id}`);
         return true;
      }
   }

   console.log(`No match found to migrate for ${correctPlayer.id}`);
   return false;
};


