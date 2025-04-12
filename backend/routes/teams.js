import express from 'express'
import teamsController from '../controllers/teamsController.js'

const router = express.Router()

router.get('/:team_id', teamsController.getTeam)
router.post('/', teamsController.createTeam)

export default router