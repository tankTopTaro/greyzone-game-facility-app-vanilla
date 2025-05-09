import { useState } from "react"
import { Tab, Tabs } from "react-bootstrap"
import FacilityControls from "./controls/FacilityControls"
import RfidControls from "./controls/RfidControls"
import GameRoomControls from "./controls/GameRoomControls"
import CreatePlayers from "./controls/CreatePlayers"

const Controls = ({ wsService, clients, activePlayers, recentPlayers, scannedPlayers, gameRoomEnabled, setShowToast, setToastMessage, setToastVariant, searchAttempted, setSearchAttempted, players, setPlayers, fetchFacilitySessionData}) => {
   const [key, setKey] = useState('createPlayerInfo')

   return (
      <> 
         <Tabs
            id="controlled-tab-example"
            activeKey={key}
            onSelect={(k) => {
               setKey(k)

               // fetch only when relevant tabs are selected
               const tabsNeedingUpdate = ['createFacilitySession', 'simulateRfidScan', 'gameRoomControl']
               if (tabsNeedingUpdate.includes(k)) {
                  fetchFacilitySessionData()
               }
            }}
            justify
            variant="pills"
            className="gap-3 mb-3"
         >
            <Tab eventKey="createPlayerInfo" title="Player">
               <CreatePlayers 
                  setShowToast={setShowToast} 
                  setToastMessage={setToastMessage} 
                  setToastVariant={setToastVariant} />
            </Tab>
            <Tab eventKey="createFacilitySession" title="Facility Session">
               <FacilityControls 
                  players={players}
                  setPlayers={setPlayers}
                  activePlayers={activePlayers} 
                  searchAttempted={searchAttempted} 
                  setSearchAttempted={setSearchAttempted}
                  setShowToast={setShowToast} 
                  setToastMessage={setToastMessage} 
                  setToastVariant={setToastVariant}
                  fetchFacilitySessionData={fetchFacilitySessionData} />
            </Tab>
            <Tab eventKey="simulateRfidScan" title="RFID">
               <RfidControls 
                  wsService={wsService} 
                  clients={clients} 
                  activePlayers={activePlayers} 
                  recentPlayers={recentPlayers} 
                  scannedPlayers={scannedPlayers}
                  setShowToast={setShowToast} 
                  setToastMessage={setToastMessage} 
                  setToastVariant={setToastVariant} />
            </Tab>
            <Tab eventKey="gameRoomControl" title="Others">
               <GameRoomControls 
                  clients={clients} 
                  activePlayers={activePlayers} 
                  recentPlayers={recentPlayers} 
                  gameRoomEnabled={gameRoomEnabled}
                  setShowToast={setShowToast} 
                  setToastMessage={setToastMessage} 
                  setToastVariant={setToastVariant} 
                  fetchFacilitySessionData={fetchFacilitySessionData}/>
            </Tab>
         </Tabs>
      </>
   )
}

export default Controls