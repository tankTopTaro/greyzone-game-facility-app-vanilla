import axios from "axios"
import fs from 'fs'
import FormData from "form-data"
import { readDatabase,  writeDatabase } from "./dbHelpers.js"

export class JobQueue {
   constructor () {
       this.isProcessing = false // Prevent parallel processing
   }

   _readQueue(filePath) {
        const db = readDatabase(filePath, {})
        if (!db['pending_api_calls']) db['pending_api_calls'] = []
        return db
   }

   _writeQueue(filePath, db) {
        writeDatabase(filePath, db)
   }

   async storeApiCall(filePath, apiCallRecord) {
        const db = this._readQueue(filePath)
        db['pending_api_calls'].push(apiCallRecord)
        this._writeQueue(filePath, db)
        console.log(`API call for ${apiCallRecord.call_id} stored.`)
   }

   async updateApiCallStatus(filePath, call_id, status, failure_reason = null) {
        const db = this._readQueue(filePath)
        const apiCallIndex = db['pending_api_calls'].findIndex(call => call.call_id === call_id)

        if (apiCallIndex !== -1) {
            db['pending_api_calls'][apiCallIndex].status = status
            db['pending_api_calls'][apiCallIndex].failure_reason = failure_reason

            this._writeQueue(filePath, db)
            console.log(`API call status for ${call_id} updated to '${status}'.`)

            if (status === 'completed') await this.clearCompletedApiCalls(filePath)
        }
   }

   async clearCompletedApiCalls(filePath) {
        const db = this._readQueue(filePath)
        db['pending_api_calls'] = db['pending_api_calls'].filter(call => call.status === 'completed')
        this._writeQueue(filePath, db)
        console.log('Cleared completed API calls.')
   }

   async runQueue (filePath, facility) {
       if (this.isProcessing) return // Avoid duplicate processing

       this.isProcessing = true

       let db = this._readQueue(filePath)
       let pendingCalls = (db['pending_api_calls'] || []).filter(c => c.status === 'pending')

        while (pendingCalls.length > 0) {
            const call = pendingCalls.shift()

            try {
                console.log(`Processing API call ${call.call_id}`)
                let headers = {}
                let data

                if ('avatarPath' in call.payload) {
                    const formData = new FormData()
                    for (const [key, value] of Object.entries(call.payload)) {
                        if (key === 'avatarPath') {
                            formData.append('avatar', fs.createReadStream(value))
                        } else {
                            formData.append(key, value ?? '')

                        }
                    }
                    data = formData
                    headers = formData.getHeaders()
                } else {
                    data = call.payload
                    headers['Content-Type'] = 'application/json'
                }

                await axios.post(call.endpoint, data, {headers})

                await this.updateApiCallStatus(filePath, call.call_id, 'completed')

                if (call.endpoint.includes('start-game-session')) {
                    facility.socket.broadcastMessage('monitor', {
                        type: 'confirmed'
                    })
                }

                facility.reportErrorToCentral.resolveError({ error: `Failed API call to ${call.endpoint}` })
            } catch (error) {
                console.error(`Error processing ${call.call_id}`, error)

                call.attempts = (call.attempts || 0) + 1

                if (call.attempts < 3) {
                    console.log(`Retrying ${call.call_id}, attempt ${call.attempts}`)
    
                    // Update the attempt count and keep it pending
                    const db = this._readQueue(filePath)
                    const idx = db['pending_api_calls'].findIndex(c => c.call_id === call.call_id)

                    if (idx !== -1) {
                        db['pending_api_calls'][idx].attempts = call.attempts
                        db['pending_api_calls'][idx].status = 'pending'
                        this._writeQueue(filePath, db)
                    }
    
                    // Sleep 5 seconds before retrying this job
                    await new Promise(resolve => setTimeout(resolve, 5000))
    
                    // Add it back to pendingCalls to retry again
                    pendingCalls.push(call)
                } else {
                    console.log(`Marking ${call.call_id} as failed after 3 attempts`)
                    await this.updateApiCallStatus(filePath, call.call_id, 'failed')
    
                    facility.reportErrorToCentral.report({
                        error: `Failed API call to ${call.endpoint}`,
                        stack: error.stack || null
                    })
                }
            }
        }

       this.isProcessing = false
   }

   async retryPendingAPICalls(filePath, facility) {
        const db = this._readQueue(filePath)

        if (!db['pending_api_calls']) return 

        const hasRetryableCalls = db['pending_api_calls'].some(c => c.status === 'failed')

        if (hasRetryableCalls) {
            await this.runQueue(filePath, facility)
        }
   }
}

export const jobQueue = new JobQueue()