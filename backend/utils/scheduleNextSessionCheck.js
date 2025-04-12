import { getPlayersWithActiveSession, getPlayersWithRecentSession } from './dbHelpers.js'

const DEFAULT_CHECK_INTERVAL = 60000

export const scheduleNextSesionCheck = async (facilityInstance) => {
   if (!facilityInstance || !facilityInstance.socket) {
      console.error('Facility instance not initialized.')
      return
   }

   const activePlayers = await getPlayersWithActiveSession()

   const now = new Date()
   let nextExpiration = null

   activePlayers.forEach(player => {
      const sessionEnd = new Date(player.facility_session.date_end + 'Z')
      const remainingTime = sessionEnd - now

      if (remainingTime > 0 && (!nextExpiration || remainingTime < nextExpiration.time)) {
         nextExpiration = { time: remainingTime, player_id: player.id }
      }
   })
 
   let nextCheckTime = nextExpiration ? nextExpiration.time : DEFAULT_CHECK_INTERVAL

   // if (!nextExpiration) {
   //    console.log(`No active sessions expiring soon. Next Check in ${DEFAULT_CHECK_INTERVAL / 1000} seconds`)
   // } else {
   //    const minutes = Math.floor(nextExpiration.time / 60000)
   //    const seconds = Math.ceil((nextExpiration.time % 60000) / 1000)
   //    console.log(`Tracking session for Player ID: ${nextExpiration.player_id}, Time Left: ${minutes} minutes ${seconds} seconds`)
   // }

   setTimeout(async() => {
      const updatedActivePlayers = await getPlayersWithActiveSession()
      const updatedRecentPlayers = await getPlayersWithRecentSession()

      facilityInstance.socket.broadcastMessage('monitor', {
         type: "facility_session",
         active_players: updatedActivePlayers,
         recent_players: updatedRecentPlayers
      })

      scheduleNextSesionCheck(facilityInstance)
   }, nextCheckTime)
}
