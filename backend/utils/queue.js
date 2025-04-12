export class JobQueue {
   constructor () {
       this.queue = [] // Store jobs in an array
       this.isProcessing = false // Prevent parallel processing
   }

   // Add a new job to the queue
   addJob (job, attempt = 1) {
       job.attempt = attempt  // track retry count
       this.queue.push(job)
       console.log(`Job added: ${job.id}`)
       this.processQueue()    // start processing
   }

   async processQueue () {
       if (this.isProcessing || this.queue.length === 0) return // Avoid duplicate processing

       this.isProcessing = true

       while (this.queue.length > 0) {
           const job = this.queue.shift() // Get first job
           console.log(`Processing job: ${job.id}`)

           try {
               await job.run()    // Execute job function
               console.log(`Job ${job.id} completed`)
           } catch (error) {
               console.error(`Job ${job.id} failed:`, error)

               if (job.attempt < 3) {
                   console.log(`Retrying job ${job.id} in 5 seconds...`)
                   setTimeout(() => this.addJob(job, job.attempt + 1), 5000)
               } else {
                   console.error(`Job ${job.id} permanently failed after 3 attempts.`)
               }
           }
       }

       this.isProcessing = false
   }
}

export const jobQueue = new JobQueue()