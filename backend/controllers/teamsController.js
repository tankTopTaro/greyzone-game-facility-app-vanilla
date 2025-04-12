import path from 'path'
import axios from 'axios'
import { fileURLToPath } from 'url'

import { readDatabase, saveTeam, storeApiCall, updateApiCallStatus, writeDatabase } from '../utils/dbHelpers.js'
import { jobQueue } from '../utils/queue.js'
import { Mutex } from 'async-mutex'

const mutex = new Mutex()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let facilityInstance = null

const API_CALLS_PATH = path.join(__dirname, '../assets/csa/calls.json')
const DB_PATH = path.join(__dirname, '../assets/gfa/db.json')

const teamsController = {
   setFacilityInstance: (instance) => {
      facilityInstance = instance
   }, 

   getTeam: async(req, res) => {
      const release = await mutex.acquire()
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

            facilityInstance.reportErrorToCentral.resolveError({error: `Error fetching team ${teamId} from CSA`})

            return res.json(transformedData)
         } else {
            return res.status(404).json({ error: 'Team not found in CSA.' })
         }
      } catch (error) {
         facilityInstance.reportErrorToCentral.report({
            error: `Error fetching team ${teamId} from CSA`,
            stack: error.stack || null
         })
         res.status(500).json({ error: 'Could not fetch team data.' })
      } finally {
         release()
      }
   },

   createTeam: async (req, res) => {
      const release = await mutex.acquire()
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

          console.log(teamName)
  
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
  
          await storeApiCall(API_CALLS_PATH, apiCallRecord);
  
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
                      await updateApiCallStatus(API_CALLS_PATH, apiCallRecord.call_id, "completed");
                  } catch (error) {
                      console.error(`Job ${jobId} failed:`, error.message);
  
                      // Mark API call as failed in local DB
                      await updateApiCallStatus(API_CALLS_PATH, apiCallRecord.call_id, "failed");
                  }
              },
          });
  
      } catch (error) {
          console.error("Error processing team creation:", error.message);
          res.status(500).json({ error: "Server error" });
      } finally {
         release()
      }
   }
}

export default teamsController