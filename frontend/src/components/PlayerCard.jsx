/* eslint-disable no-unused-vars */
import axios from 'axios'
import { useState } from 'react'
import { Button, Form } from 'react-bootstrap'

const formatDateTime = (dateStr) => {
   if (!dateStr) return "—";
   const date = new Date(dateStr);
   const datePart = date.toISOString().split("T")[0]; // YYYY-MM-DD
   const timePart = date.toLocaleTimeString(undefined, {
     hour: "2-digit",
     minute: "2-digit",
     hour12: false, // optional — for 24hr format
   });
   return `${datePart} ${timePart}`;
 };

 const formatDate = (dateStr) => {
   const d = new Date(dateStr)
   return isNaN(d) ? '—' : d.toLocaleDateString()
 } 
 

const PlayerCard = ({ player, query, category, activePlayers, setPlayers, players, searchAttempted, setShowToast, setToastMessage, setToastVariant, fetchFacilitySessionData }) => {
   const [duration, setDuration] = useState(15)
   const [showDetails, setShowDetails] = useState(false)

   const isActive = activePlayers?.some((p) => p.id === player.id)

   const activeInfo = isActive
    ? activePlayers.find((p) => p.id === player.id)
    : null

   const fullName = `${player.first_name ?? ""} ${player.last_name ?? ""}`.trim()

   const valueToDisplay = player[category]?.trim() ? player[category] : player.nick_name;
   const displayValue = query.trim()
     ? valueToDisplay.replace(new RegExp(`(${query})`, "i"), `<span class="highlight-match fw-bold">$1</span>`)
     : valueToDisplay;
   

   const handleConfirm = async () => {
      if (!duration) {
         setToastMessage('Please select a duration.')
         setToastVariant('warning')
         setShowToast(true)
         return
      }
  
      try {
         const response = await axios.post("/api/facility-session/create", {
            player_id: player.id,
            duration_m: duration,
         })

         if (response.status === 200) {
            setToastMessage(response.data.message || 'Facility session created successfully.')
            setToastVariant('success')
            setShowToast(true)
            fetchFacilitySessionData()
            setPlayers([...players])
         }
      } catch (err) {
         console.error("Error creating facility session:", err)
         setToastMessage('Failed to create facility session.')
         setToastVariant('danger')
         setShowToast(true)
      }
   }
   
   return (
      <div className="border border-2 p-2 mb-2 rounded bg-transparent player-card-grid">
         <span
          className="highlight"
          dangerouslySetInnerHTML={{ __html: displayValue }}
          style={{ width: '200px', overflowWrap: 'break-word' }}
        />

        {isActive ? (
          <>
            <span>
              <strong>Session Start:</strong>{" "}
              {formatDateTime(activeInfo.facility_session.date_start)}
            </span>
            <span>
              <strong>Session End:</strong>{" "}
              {formatDateTime(activeInfo.facility_session.date_end)}
            </span>
          </>
        ) : (
          <>
            <span><strong>Date Added:</strong> {formatDateTime(player.date_add)}</span>
            <span><strong>Last Visit:</strong> {formatDateTime(player.last_visit)}</span>
          </>
        )}
        <Button variant='outline-light' size='sm' className='details-toggle-btn' onClick={() => setShowDetails((prev) => !prev)}>
         { showDetails 
            ? <svg  xmlns="http://www.w3.org/2000/svg"  width={24}  height={24}  viewBox="0 0 24 24"  fill="none"  stroke="currentColor"  strokeWidth={2}  strokeLinecap="round"  strokeLinejoin="round"  className="icon icon-tabler icons-tabler-outline icon-tabler-chevron-up"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M6 15l6 -6l6 6" /></svg>
            : <svg  xmlns="http://www.w3.org/2000/svg"  width={24}  height={24}  viewBox="0 0 24 24"  fill="none"  stroke="currentColor"  strokeWidth={2}  strokeLinecap="round"  strokeLinejoin="round"  className="icon icon-tabler icons-tabler-outline icon-tabler-chevron-down"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M6 9l6 6l6 -6" /></svg>}
        </Button>

        {!isActive && showDetails && (
         <div className="p-2 mt-2 w-100" style={{ gridColumn: '1 / -1' }}>
            <div>
               <h6 className="text-uppercase text-secondary mb-2">Basic Info</h6>
               <div className=" d-flex justify-content-between gap-2">
                  <span><strong>Name:</strong> {fullName}</span>
                  <span><strong>Nickname:</strong> {player.nick_name}</span>
                  <span><strong>Gender:</strong> {(player.gender).toLowerCase()}</span>
                  <span><strong>Birth Date:</strong> {player.birth_date ? formatDate(player.birth_date) : '—'}</span>
               </div>
            </div>

            <div className="mt-2">
               <h6 className="text-uppercase text-secondary mb-2">Location Info</h6>
               <div className=" d-flex justify-content-between gap-2">
                  <span><strong>Country:</strong> {player.league_country || '—'}</span>
                  <span><strong>City:</strong> {player.league_city || '—'}</span>
                  <span><strong>District:</strong> {player.league_district || '—'}</span>
                  <span><strong>Other:</strong> {player.league_other || '—'}</span>
               </div>
            </div>

            <div className='mt-2'>
               <h6 className="text-uppercase text-secondary mb-2">Contact Info</h6>
               <div className=" d-flex justify-content-between gap-2">
                  <span><strong>Phone:</strong> {player.phone || '—'}</span>
                  <span><strong>Email:</strong> {player.email || '—'}</span>
               </div>
            </div>

            <div className="d-flex align-items-start mt-2 mb-2">
               <div className="pe-2 " style={{ flex: '0 0 80%' }}>
                  <h6 className="text-uppercase text-secondary mb-2">Notes</h6>
                  <p className="mb-0">{player.notes || '—'}</p>
               </div>

               <div>
                  <h6 className="text-uppercase text-secondary mb-2">Add Facility Session</h6>
                  <div className="d-flex align-items-center gap-2 justify-content-end" style={{ flex: '1' }}>
                     <Form.Select
                        className="form-select form-select-sm w-auto"
                        value={duration}
                        onChange={(e) => setDuration(Number(e.target.value))}
                     >
                        {[15, 30, 45, 60, 75, 90].map((min) => (
                           <option key={min} value={min}>
                           {min} mins
                           </option>
                        ))}
                     </Form.Select>
                     <Button className="btn btn-sm btn-success confirm-btn" onClick={handleConfirm}>
                        Confirm
                     </Button>
                  </div>
               </div>
            </div>
         </div>
         )}


      </div>
    )
    
}

export default PlayerCard