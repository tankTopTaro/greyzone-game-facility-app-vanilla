import express from 'express' 
import reportErrorToCentralController from '../controllers/reportErrorToCentralController.js'

const router = express.Router()

router.post('/', reportErrorToCentralController.reportError)

export default router