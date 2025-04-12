import express from 'express'
import imagesController from '../controllers/imagesController.js'

const router = express.Router()

router.get('/players/:player_id.jpg', imagesController.getPlayerImage)

export default router