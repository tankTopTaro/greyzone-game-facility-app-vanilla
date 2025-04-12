import express from 'express' 
import rfidController from '../controllers/rfidController.js'

const router = express.Router()

router.post('/game-room/:gra_id', rfidController.gameRoom)
router.post('/booth/:booth_id', rfidController.booth)

export default router