import { useEffect, useState } from "react"
import { Button, Container, Form, InputGroup } from "react-bootstrap"
import { PulseLoader } from 'react-spinners'
import axios from 'axios'
import SearchBar from "../SearchBar"
import PlayerCard from "../PlayerCard"

const FacilityControls = ({ players, setPlayers, activePlayers, searchAttempted, setSearchAttempted, setShowToast, setToastMessage, setToastVariant, fetchFacilitySessionData }) => {
    const [category, setCategory] = useState('email')
    const [query, setQuery] = useState('')

    const [loading, setLoading] = useState(false)

    useEffect(() => {
      if (query === '') {
         setSearchAttempted(false)
         setPlayers([])
      }
    }, [query, setSearchAttempted, setPlayers])
 
    const handleSearchClick = async () => {
      if (query.trim() === '') return
      
      setSearchAttempted(true)
      setLoading(true)
      
      try {
         const response = await axios.get(`/api/players/search?${category}=${encodeURIComponent(query)}`)
         if (response.status === 200) {
            if (response.data.length > 0) {
               setPlayers(response.data)
            }
         } else {
            console.log(response.data)
         }
      } catch (error) {
         console.error(error)
      } finally {
         setLoading(false)
      }
    }

    return (
      <div className="p-4 player-form-container">
         <h4>Create Facility Session</h4>
         <SearchBar category={category} query={query} setQuery={setQuery} setCategory={setCategory} handleSearchClick={handleSearchClick}/>
         <div className="mt-4">
            {loading ? (
               <div className="w-100 d-flex align-items-center justify-content-center">
                  <PulseLoader color="gray" loading={loading} size={10} />
               </div>
            ) : players.length > 0 ? (
               players.map((player) => {
                  return (
                     <PlayerCard 
                     key={player.id} 
                     player={player} 
                     query={query} 
                     category={category} 
                     activePlayers={activePlayers}
                     setPlayers={setPlayers} 
                     players={players} 
                     setShowToast={setShowToast} 
                     setToastMessage={setToastMessage} 
                     setToastVariant={setToastVariant}
                     fetchFacilitySessionData={fetchFacilitySessionData} />
                  )
               })
            ) : searchAttempted && query.trim() !== '' ? (
               <p className="text-white text-center mt-3">No players found. Try a different search.</p>
            ) : null }
         </div>
      </div>
    )
}

export default FacilityControls