import React, { useEffect, useRef, useState } from 'react'
import { Container, Toast, ToastContainer } from 'react-bootstrap'
import WebSocketService from '../utils/WebSocketService.js'
import Navigation from "../components/Navigation"
import Alerts from "../components/Alerts"
import Controls from '../components/Controls'
import axios from 'axios'

const WS_URL = `ws://${window.location.hostname}:8081`
const CLIENT = 'monitor'

const Monitor = () => {
   const wsService = useRef(null)

   const [showAlerts, setShowAlerts] = useState(false)
   const [activePlayers, setActivePlayers] = useState([])
   const [recentPlayers, setRecentPlayers] = useState([])
   const [clients, setClients] = useState({})
   const [scannedPlayers, setScannedPlayers] = useState({})
   const [gameRoomEnabled, setGameRoomEnabled] = useState({})
   const [errors, setErrors] = useState({})

   const [showToast, setShowToast] = useState(false)
   const [toastMessage, setToastMessage] = useState('')
   const [toastVariant, setToastVariant] = useState('success')

   const [searchAttempted, setSearchAttempted] = useState(false)
   const [players, setPlayers] = useState([])

   const scannedPlayersRef = useRef(scannedPlayers)
   const searchAttemptedRef = useRef(searchAttempted)

   const fetchFacilitySessionData = async () => {
      try {
         const { data } = await axios.get('/api/facility-session')

         setActivePlayers(data.active_players)
         setRecentPlayers(data.recent_players)

         if (!searchAttemptedRef.current) {
            setPlayers(data.active_players);
         }
      } catch (error) {
         
      }
   }

   useEffect(() => {
      scannedPlayersRef.current = scannedPlayers
      searchAttemptedRef.current = searchAttempted
   }, [scannedPlayers, searchAttempted])

   useEffect(() => {
      fetchFacilitySessionData()

      const handleFocus = () => {
         fetchFacilitySessionData()
      }

      window.addEventListener('focus', handleFocus)

      return () => { window.removeEventListener('focus', handleFocus) }
   }, [])

   useEffect(() => {
      document.title = "GFA | Monitor"
      if (!wsService.current) {
         wsService.current = new WebSocketService(WS_URL, CLIENT)
         wsService.current.connect()
      }

      return () => {
         if (wsService.current) {
            wsService.current.close()
            wsService.current = null
         }
      }
   }, [])

   useEffect(() => {
      const handleWebSocketMessage = (data) => {
         console.log(`Received message: ${JSON.stringify(data)}`)
         const messageHandlers = {
            'clientData': () => setClients(data.clients),
            'confirmed': () => setScannedPlayers({}),
            'error': () => {
               setErrors((prevErrors) => {
                  const newErrors = { ...prevErrors }
            
                  Object.keys(data.data).forEach((source) => {
                     const merged = data.data[source]
            
                     const deduped = []
                     const seen = new Set()

                     for (const err of merged) {
                        if (err.resolved) continue

                        const key = `${err.message}`
                        if (!seen.has(key)) {
                           seen.add(key)
                           deduped.push(err)
                        }
                     }

                     newErrors[source] = deduped
                  })
            
                  return newErrors
               })
            },
            'facility_session': () => { 
               setActivePlayers(data.active_players)
               setRecentPlayers(data.recent_players)
            },
            'reportedErrors': () => {
               const cleanedErrors = {}

               Object.keys(data.data).forEach((source) => {
                  const merged = data.data[source]

                  const deduped = []
                  const seen = new Set()

                  for (const err of merged) {
                     if (err.resolved) continue

                     const key = `${err.message}` // or include timestamp if needed
                     if (!seen.has(key)) {
                        seen.add(key)
                        deduped.push(err)
                     }
                  }

                  cleanedErrors[source] = deduped
               })

               setErrors(cleanedErrors)
            },
            'rfid_scanned': () => {
               if (data.location === 'booth') {
                  // Check if the player has already been scanned at any booth
                  const playerScannedLocations = scannedPlayersRef.current[data.player]

                  if (playerScannedLocations && playerScannedLocations.some(loc => loc.startsWith('booth'))) {
                     // Player has already been scanned at a booth
                     console.log(`Player ${data.player} has already been scanned at a booth`)
                     return // Stop further processing, or send an error message to the user
                  }
               }

               // Add the new scan to the state
               setScannedPlayers((prev) => ({
                  ...prev,
                  [data.player]: prev[data.player]
                     ? [...prev[data.player], `${data.location}-${data.id}`]
                     : [`${data.location}-${data.id}`]
                  }))
            },
            'status_update': () => console.log(data),
            'storedStates': () => setClients(data.states),
            'toggleRoom': () => {
               setGameRoomEnabled(Object.fromEntries(
                  Object.entries(data.states).map(([id, data]) => [id, data.enabled]))
               )
            }
         }

         if (!messageHandlers[data.type]) console.warn(`No handler for this message type ${data.type}`)

         messageHandlers[data.type]()
      }

      if (wsService.current) {
         wsService.current.addListener(handleWebSocketMessage)
      }

      return () => {
         if (wsService.current) {
            wsService.current.removeListener(handleWebSocketMessage)
         }
      }
   }, [])

   // Compute errorCount directly from errors state
   const errorCount = Object.values(errors).reduce(
      (total, sourceErrors) => total + (Array.isArray(sourceErrors) ? sourceErrors.length : 0),
      0
   )

   return (
      <div className="d-flex flex-column vh-100">  
         <Navigation setShowAlerts={setShowAlerts} errorCount={errorCount} />
         <Alerts show={showAlerts} onClose={() => setShowAlerts(false)} errors={errors} />

         <div className="w-100 px-4 mt-4 flex-grow-1">
            <Controls 
               wsService={wsService.current} 
               clients={clients} 
               activePlayers={activePlayers} 
               recentPlayers={recentPlayers} 
               scannedPlayers={scannedPlayers} 
               gameRoomEnabled={gameRoomEnabled} 
               setShowToast={setShowToast} 
               setToastMessage={setToastMessage} 
               setToastVariant={setToastVariant} 
               searchAttempted={searchAttempted} 
               setSearchAttempted={setSearchAttempted}
               players={players} 
               setPlayers={setPlayers} 
               fetchFacilitySessionData={fetchFacilitySessionData}
            />
         </div>

         <ToastContainer position='bottom-end' className='p-3'>
            <Toast
               show={showToast} 
               delay={3000} 
               autohide
               bg={toastVariant}
               onClose={() => setShowToast(false)} 
               closeButton={false}
            >
               <Toast.Body className="text-white">
                  {toastMessage}
               </Toast.Body>
            </Toast>
         </ToastContainer>

         <footer class="w-100 d-flex align-items-center justify-content-center text-center py-3">
            <p class="mb-0">&copy; 2025</p>
         </footer>
      </div>
   )
}

export default Monitor