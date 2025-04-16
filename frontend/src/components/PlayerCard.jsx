/* eslint-disable no-unused-vars */
import axios from 'axios'
import { useState } from 'react'
import { Button, Form } from 'react-bootstrap'

const formatDate = (dateStr) => dateStr ? dateStr.split("T")[0] : "—"
const formatTime = (timeStr) =>
  new Date(timeStr).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })

const PlayerCard = ({ player, query, category, activePlayers, setPlayers, players, searchAttempted, setShowToast, setToastMessage, setToastVariant }) => {
   const [duration, setDuration] = useState(15)

   const isActive = activePlayers?.some((p) => p.id === player.id)

   const activeInfo = isActive
    ? activePlayers.find((p) => p.id === player.id)
    : null

   const fullName = `${player.first_name ?? ""} ${player.last_name ?? ""}`.trim()

   let displayValue = ""

   if (category === "first_name" || category === "last_name") {
      const nameValue = player[category] ?? ""
      const regex = new RegExp(`(${query})`, "i")
      const highlighted = nameValue.replace(
        regex,
        `<span class="highlight-match fw-bold">$1</span>`
      )
    
      displayValue = `${category === "first_name" ? highlighted : player.first_name ?? ""} ${
        category === "last_name" ? highlighted : player.last_name ?? ""
      }`.trim()
   } else {
      const matchedValue = player[category] || "—"
      displayValue = `<span class="highlight-match fw-bold">${matchedValue}</span>`
   }

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
      <div className="border border-4 p-2 mb-2 rounded d-flex flex-column gap-1 bg-transparent text-white">
         {isActive ? (
         <>
            <div className="player-card-info">
               <span className="fs-5">{fullName}</span>
               <span className="fs-5">{player.nick_name}</span>
            </div>
            <div className="active-session-info d-flex justify-content-between mt-2">
               <span>
               <strong>Session Start:</strong>{" "}
               {formatDate(activeInfo.facility_session.date_start)}{" "}
               {formatTime(activeInfo.facility_session.date_start)}
               </span>
               <br />
               <span>
               <strong>Session End:</strong>{" "}
               {formatDate(activeInfo.facility_session.date_end)}{" "}
               {formatTime(activeInfo.facility_session.date_end)}
               </span>
            </div>
         </>
         ) : (
         <>
            <div className="player-card-info">
               <h5 className="highlight">{player.nick_name}</h5>
               <span
               className="highlight"
               dangerouslySetInnerHTML={{ __html: displayValue }}
               />
            </div>
            <div className="player-card-meta">
               <span>Date Added: {formatDate(player.date_add)}</span>
               <span>Last Visit: {formatDate(player.last_visit)}</span>
            </div>
            <div className="d-flex align-items-center justify-content-end gap-2 mt-1">
               <Form.Select
               className="form-select form-select-sm w-auto duration-select"
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
            <div className="session-times mt-2"></div>
         </>
         )}
      </div>
   )
}

export default PlayerCard