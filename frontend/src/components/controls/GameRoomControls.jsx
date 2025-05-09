import { useEffect, useState } from "react"
import axios from 'axios'
import { Form, InputGroup, Button, Container, Toast } from "react-bootstrap"

const GameRoomControls = ({ activePlayers, recentPlayers, gameRoomEnabled, setShowToast, setToastMessage, setToastVariant, fetchFacilitySessionData }) => {
   const [playerId, setPlayerId] = useState('')
   const [timeCredit, setTimeCredit] = useState('')
   const [error, setError] = useState(false)
   const [resetTimeout, setResetTimeout] = useState(false)

   const toggleGameRoom = async (game_room) => {
   const newStatus = !gameRoomEnabled[game_room]

   const roomId = game_room.split('.')[0]

   try {
      const response = await axios.post(`/api/game-room/${roomId}/toggle-game-room-status`, {
            status: newStatus
      })
      if (response.status === 200) {
         setShowToast(true)
         setToastMessage(`${game_room} ${newStatus ? 'enabled' : 'disabled'} successfully!`) 
         setToastVariant('success')          
      }
   } catch (error) {
      console.error('Request error:', error.response?.data)
      setShowToast(true)
      setToastMessage(`Failed to toggle ${game_room}`) 
      setToastVariant('danger')  
   }
   }

   const addTimeCredits = async () => {
   if (!playerId || !timeCredit) {
      setError(true)
      setResetTimeout(true)
      setShowToast(true)
      setToastMessage('Please select a player and time credit.') 
      setToastVariant('warning') 
      return;
   }

   try {
      const response = await axios.post('/api/facility-session/add-time-credits', {
            player_id: playerId,
            additional_m: parseInt(timeCredit, 10)
      });

      if (response.status === 200) {
            setPlayerId('')
            setTimeCredit(''); // Reset input field
            setShowToast(true)
            setToastMessage(`Added ${timeCredit} minutes to player ${playerId} successfully!`) 
            setToastVariant('success') 
            fetchFacilitySessionData()
      }
   } catch (error) {
      console.error("Failed to add time credits:", error.response?.data);
      setError(true)
      setResetTimeout(true)
      setShowToast(true)
      setToastMessage('Failed to add time credits.') 
      setToastVariant('danger') 
   }
   }

   useEffect(() => {
      if (resetTimeout) {
         const timer = setTimeout(() => {
            setError(false)
            setResetTimeout(false)
         }, 1500)
         return () => clearTimeout(timer)
      }
   }, [resetTimeout])

    return (
        <Container className="p-3 player-form-container">
            <h4>Add time credits to player</h4>
            
            <InputGroup className="w-100 d-flex mb-4">
               <Form.Select 
               value={playerId}
               onChange={(e) => setPlayerId(e.target.value)}
               style={{ height: '38px', flex: '0 0 35%' }}
               >
               <option>Select a player</option>
               
               {/* Players with active session */}
               {Array.isArray(activePlayers) && activePlayers.length > 0 && (
                  <optgroup label="Active Sessions">
                     {activePlayers
                        .slice() // Create a shallow copy to avoid mutating the original array
                        .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
                        .map((p) => (
                           <option key={p.id} value={p.id}>
                              {p.id} - {p.nick_name}
                           </option>
                        ))}
                  </optgroup>
               )}

               {/* Players with recently ended sessions */}
               {Array.isArray(recentPlayers) && recentPlayers.length > 0 && (
                  <optgroup label="Recently Ended Sessions">
                     {recentPlayers
                        .slice()
                        .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
                        .map((p) => (
                           <option key={p.id} value={p.id}>
                              {p.id} - {p.nick_name}
                           </option>
                        ))}
                  </optgroup>
               )}
               </Form.Select>

               <Form.Select
                  value={timeCredit}
                  onChange={(e) => setTimeCredit(e.target.value)}
                  style={{ height: '38px', flex: '0 0 35%' }}
               >
                  <option value="">Select time credit</option>
                  {[5, 10, 15, 20, 25, 30].map((value) => (
                     <option key={value} value={value}>
                           {value} minutes
                     </option>
                  ))}
               </Form.Select>

               <Button 
                  onClick={addTimeCredits} 
                  variant={error ? 'danger' : 'primary'}
                  style={{ height: '38px'}}>
                     Add Time Credits
               </Button>
            </InputGroup>      

            <h4>Enable | Disable Game Rooms</h4>

            {Object.keys(gameRoomEnabled).length > 0 && Object.keys(gameRoomEnabled).map((game_room) => {
               return (
                  <Form.Check
                     key={game_room}
                     type="switch"
                     label={`${gameRoomEnabled[game_room] ? "Disable" : "Enable"} ${game_room}`}
                     checked={gameRoomEnabled[game_room] || false} // Ensure default `false` if not found
                     onChange={() => toggleGameRoom(game_room)}  // Assuming `toggleGameRoom` toggles the state
                  />
               )
            })}
        </Container>
    )
}

export default GameRoomControls