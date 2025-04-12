import express from 'express'
import gameRoomController from '../controllers/gameRoomController.js'

const router = express.Router()

// these will be called by the GRA
router.post('/:gra_id/available', gameRoomController.isAvailable)   
router.get('/:gra_id/is-upcoming-game-session', gameRoomController.isUpcomingGameSession)

// this is called by the frontend
router.post('/:gra_id/toggle-room', gameRoomController.toggleRoom)

export default router