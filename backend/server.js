import facilityInstance from "./utils/facilityInstance.js"
import facilitySessionController from "./controllers/facilitySessionController.js"
import gameSessionController from "./controllers/gameSessionController.js"
import gameRoomController from "./controllers/gameRoomController.js"
import playersController from "./controllers/playersController.js"
import teamsController from "./controllers/teamsController.js"
import rfidController from "./controllers/rfidController.js"
import imagesController from "./controllers/imagesController.js"
import reportErrorToCentralController from "./controllers/reportErrorToCentralController.js"
import { scheduleNextSesionCheck } from "./utils/scheduleNextSessionCheck.js"

facilitySessionController.setFacilityInstance(facilityInstance)
gameSessionController.setFacilityInstance(facilityInstance)
gameRoomController.setFacilityInstance(facilityInstance)
imagesController.setFacilityInstance(facilityInstance)
playersController.setFacilityInstance(facilityInstance)
rfidController.setFacilityInstance(facilityInstance)
teamsController.setFacilityInstance(facilityInstance)
reportErrorToCentralController.setFacilityInstance(facilityInstance)

scheduleNextSesionCheck(facilityInstance)