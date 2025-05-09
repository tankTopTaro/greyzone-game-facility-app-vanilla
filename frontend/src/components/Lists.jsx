import { Container, ListGroup } from "react-bootstrap"

const Lists = ({ activePlayers, recentPlayers, player, setPlayer }) => {
   const playersToShow = (Array.isArray(activePlayers) && activePlayers.length > 0) 
      ? activePlayers 
      : (Array.isArray(recentPlayers) ? recentPlayers : [])

   
   const sortedPlayers = [...playersToShow].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
   
   const handleClick = (p) => {
      if (player?.id === p.id) {
         setPlayer(null) // Deselect
      } else {
         setPlayer(p) // Select
      }
   }
   
   return (
      <Container className="py-3">
         <ListGroup>
            {sortedPlayers.length > 0 ? (
               sortedPlayers.map((p) => (
                  <ListGroup.Item 
                     key={p.id}  
                     className={`list-group-item-action 
                        ${player?.id === p.id ? 'list-group-item-dark' : ''}`}
                     onClick={() => handleClick(p)}
                     style={{ cursor: 'pointer' }}
                  >
                     <div className="d-flex justify-content-between align-items-center">
                        <span className="text-truncate w-100 overflow-hidden" style={{ whiteSpace: "nowrap" }}>
                           {p.id} - {p.nick_name}
                        </span>
                     </div>
                  </ListGroup.Item>
               ))
            ) : (
               <p>No players found.</p>
            )}
         </ListGroup>
      </Container>
   )
}

export default Lists