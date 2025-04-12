import path, { resolve } from 'path'
import { fileURLToPath } from 'url'
import { readDatabase, writeDatabase } from '../utils/dbHelpers.js'
import { Mutex } from 'async-mutex'

const mutex = new Mutex()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const REPORTED_ERRORS_PATH = path.join(__dirname, '../assets/gfa/reported-errors.json')

export default class ReportErrorToCentral {
   constructor(socket) {
      this.socket = socket
   }

   async report (err, source = 'facility') {
      const release = await mutex.acquire()
      try {
         let currentData = readDatabase(REPORTED_ERRORS_PATH, {})

         if (!currentData) currentData = {}

         if(!currentData[source]) currentData[source] = []

         const newError = err.error || 'Unknown error'
         const newStack = err.stack || null

         const existingError = currentData[source].find(e => 
            e.error === newError && !e.resolved
         )

         if (existingError) {
            // Only update the timestamp if the error exists
            const updated = existingError.timestamp !== new Date().toISOString()

            if (updated) {
               existingError.timestamp = new Date().toISOString()

               writeDatabase(REPORTED_ERRORS_PATH, currentData)
            }
         } else {
            const newErr = {
               error: newError,
               stack: newStack,
               timestamp: new Date().toISOString(),
               resolved: false
            }

            currentData[source].push(newErr)
            writeDatabase(REPORTED_ERRORS_PATH, currentData)

            this.socket.broadcastMessage('monitor', {
               type: 'error',
               data: {
                  [source]: [{
                     error: newError.error,
                     stack: newError.stack ? newError.stack.split('\n')[0] : null,
                     timestamp: newError.timestamp,
                     resolved: newError.resolved
                  }]
               }
            })
         }
         // console.log('[ReportErrorToCentral] Error reported successfully.')
      } catch (err) {
         console.error('[ReportErrorToCentral] Failed to report error: ', err)
      } finally {
         release()
      }
   }

   async resolveError(err, source = 'facility') {
      const release = await mutex.acquire()
      try {
         let currentData = readDatabase(REPORTED_ERRORS_PATH, {})

         if (!currentData || !currentData[source]) return

         const errorIndex = currentData[source].findIndex(e => 
            e.error === err.error && !e.resolved
         )

         if (errorIndex !== -1) {
            currentData[source][errorIndex].resolved = true
            writeDatabase(REPORTED_ERRORS_PATH, currentData)

            // Broadcast updated error list (excluding resolved errors)
            const trimmedErrors = {}

            for (const source in currentData) {
               trimmedErrors[source] = currentData[source]
                  .map(err => ({
                     error: err.error,
                     stack: err.stack ? err.stack.split('\n')[0] : null,
                     timestamp: err.timestamp,
                     resolved: err.resolved
                  }))
            }

            this.socket.broadcastMessage('monitor', {
               type: 'error',
               data: trimmedErrors
            })
         }
      } catch (err) {
         console.error('[ReportErrorToCentral] Failed to resolve error.')
      } finally {
         release()
      }
   }

   forward() {
      const errors = readDatabase(REPORTED_ERRORS_PATH, {})

      if (!errors) errors = {}

      const trimmedErrors = {}

      for (const source in errors) {
         trimmedErrors[source] = errors[source]
         .map(err => ({
            error: err.error,
            stack: err.stack ? err.stack.split('\n')[0] : null,
            timestamp: err.timestamp,
            resolved: err.resolved
         }))
      }

      this.socket.broadcastMessage('monitor', {
         type: 'reportedErrors',
         data: trimmedErrors
      })
   }
}