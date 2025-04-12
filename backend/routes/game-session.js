import express from 'express'
import gameSessionController from '../controllers/gameSessionController.js'

const router = express.Router()

router.post('/', gameSessionController.uploadGameSession)

export default router