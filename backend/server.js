import Facility from "./classes/Facility.js"
import { scheduleNextSesionCheck } from "./utils/scheduleNextSessionCheck.js"

const facilityInstance = new Facility(1)  // Change the id to the ID of the facility

scheduleNextSesionCheck(facilityInstance)