import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { WebSocketServer } from 'ws'
import { EventEmitter } from "events"
import { getPlayersWithActiveSession, getPlayersWithRecentSession, readDatabase, writeDatabase } from '../utils/dbHelpers.js'

dotenv.config()
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const GFA_CLIENTS_PATH = path.join(__dirname, '../assets/db/gfa/clients.json')
const GRA_STATUS_PATH = path.join(__dirname, '../assets/db/gra/game-room-status.json')
const SCANS_PATH = path.join(__dirname, '../assets/db/gfa/scans.json')

export default class Socket extends EventEmitter {
   constructor(port = 8081) {
      super()
      this.port = port
      this.socket = null
      this.clientByName = {}
      this.errorReporter = null
      this.init()
   }

   init() {
      const host = process.env.HOST || '0.0.0.0'
      this.socket = new WebSocketServer({ port: this.port, host: host })

      this.socket.on('connection', (client, request) => {
         const forwarded = request.headers['x-forwarded-for']
         let clientIp = forwarded ? forwarded.split(',')[0].trim() : request.socket.remoteAddress

         // Normalize IPv6 localhost
         if (clientIp === '::1') clientIp = '127.0.0.1'

         client.clientIp = clientIp
         client.userAgent = request.headers['user-agent']

         // Expect the first message to contain the hostname
         client.once('message', async (message) => {
            try {
               const data = JSON.parse(message.toString())

               if (data.clientname) {
                  const clientName = data.clientname

                  // Initialize storage for this hostname if not exists
                  if (!this.clientByName[clientName]) {
                     this.clientByName[clientName] = new Set()
                  }

                  // Add client to the hostname group
                  this.clientByName[clientName].add(client)
                  console.log('New client connected on the webSocket for '+clientName+'. clientIp: '+client.clientIp+' browser: '+client.userAgent);
                  this.updateClientData(clientName, true)

                  console.log(`Client registered under name: ${clientName}`)

                  this.errorReporter.forward()
                  
                  this.sendStoredStates(client, 'toggleRoom', GRA_STATUS_PATH)
                  this.sendStoredStates(client, 'status_update', SCANS_PATH)
                  const newPlayerSessions = await getPlayersWithActiveSession()
                  const recentPlayerSessions = await getPlayersWithRecentSession()
         
                  this.broadcastMessage('monitor', {
                     type: 'facility_session',
                     active_players: newPlayerSessions,
                     recent_players: recentPlayerSessions
                  })

                  // Handle messages from this client
                  client.on('message', (message) => {
                     // console.log('Received message from '+data.clientname+' message:'+message.toString())
                     this.emit(clientName, message.toString())
                  })

                  // Handle disconnections
                  client.on('close', () => {
                     this.handleClientDisconnect(clientName, client)
                  })
               }
            } catch (error) {
               console.error('WebSocket connection error', error)
               // TODO reportErrorToCentral(error)
            }
         })
      })

      console.log('WebSocket Server running on port ', this.port)
   }

   setErrorReporter(errorReporter) {
      this.errorReporter = errorReporter
   }

   broadcastMessage(clientname, message) {
      // console.log(`Broadcasting ${message} to ${clientname}`)
      if (this.clientByName[clientname]) {
         this.clientByName[clientname].forEach(client => {
            if (client.readyState === 1) {
               client.send(JSON.stringify(message))
            }
         })
      }
   }

   handleClientDisconnect(clientname, client) {
      if (this.clientByName[clientname]) {
         this.clientByName[clientname].delete(client)
         if (this.clientByName[clientname].size === 0) {
            this.updateClientData(clientname, false)
            delete this.clientByName[clientname]
            console.log(`All clients from ${clientname} are disconnected.`)
         }
      }
   }

   onClientMessage(clientname, callback) {
      this.on(clientname, callback)
   }

   sendStoredStates(client, type, JSON_PATH) {
      if (fs.existsSync(JSON_PATH)) {
         try {
            const storedStates = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'))

            if (storedStates && Object.keys(storedStates).length > 0) {
               client.send(JSON.stringify({
                  type: type,
                  states: storedStates
               }))
               console.log('Sent stored states to client')
            }
         } catch (error) {
            // TODO reportErrorToCentral(error)
            console.error('Error reading file: ', error)
         }
      }
   }

   async waitForMessage(clientname) {
      return new Promise((resolve, reject) => {
          try {
              if (!this.clientByName[clientname] || this.clientByName[clientname].size === 0) {
                  const error = new Error(`No clients found under name: ${clientname}`)
                  return reject(error)  // Reject after passing the error to the handler
              }

              // Listen for the first message from any client in the group
              this.clientByName[clientname].forEach((client) => {
                  const messageHandler = (raw) => {
                      try {
                        const message = JSON.parse(raw)
                        client.off('message', messageHandler) // Remove listener after first message
                        resolve(message)
                      } catch (error) {
                        reject(error)
                      }
                  }

                  client.on('message', messageHandler)
              })
          } catch (error) {
              reject(error)
          }
      })
   }

   async updateClientData(clientname, isConnected = true) {
      try {
         // Load memory cache if it's not already loaded
         if (!this.clients) {
            this.clients = readDatabase(GFA_CLIENTS_PATH, {
                  "booths": [],
                  "game-room-door-screens": [],
            })
         }

         // Ensure arrays are properly initialized before use
         this.clients["booths"] = this.clients["booths"] || []
         this.clients["game-room-door-screens"] = this.clients["game-room-door-screens"] || []

         if (isConnected) {
            if (clientname.startsWith("booth-") && !this.clients["booths"].includes(clientname)) {
               this.clients["booths"].push(clientname)
            } else if (clientname.startsWith("game-room-") && !this.clients["game-room-door-screens"].includes(clientname)) {
               this.clients["game-room-door-screens"].push(clientname)
            }
         } else {
            // Remove the client from the appropriate array if it's disconnected
            this.clients["booths"] = this.clients["booths"].filter(client => client !== clientname)
            this.clients["game-room-door-screens"] = this.clients["game-room-door-screens"].filter(client => client !== clientname)
         }

         // Sort for consistency
         this.clients["booths"].sort()
         this.clients["game-room-door-screens"].sort()

         // Save updated data
         writeDatabase(GFA_CLIENTS_PATH, this.clients)

         // Broadcast clients data
         this.broadcastMessage('monitor', {
            type: 'clientData',
            clients: this.clients,
         })
      } catch (error) {
         console.error('Error in updateClientData', error)
      }
   }
}