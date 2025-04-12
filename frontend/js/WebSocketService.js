class WebSocketService {
   constructor (url, clientname) {
       this.url = url
       this.clientname = clientname
       this.socket = null
       this.listeners = []
       this.reconnectInterval = 5000
   }

   isConnected () {
       return this.socket && this.socket.readyState === WebSocket.OPEN
   }

   connect () {
       if (!this.socket || this.socket.readyState === WebSocket.CLOSED) {
           this.socket = new WebSocket(this.url)

           this.socket.onopen = () => {
               console.log(`Connected to WebSocket at ${this.url}`)

               // send initial message to register hostname
               this.send({ clientname: this.clientname, message: 'Hello from browser!' })
           }

           this.socket.onmessage = (event) => {
               try {
                   const data = JSON.parse(event.data)
                   this.listeners.forEach((listener) => listener(data))
               } catch (error) {
                   console.error('Error parsing WebSocket message:', error)
               }
           }

           this.socket.onerror = (error) => {
               console.error('WebSocket error:', error)
           }

           this.socket.onclose = () => {
               console.log('WebSocket connection closed. Attempting to reconnect...')
               setTimeout(() => this.connect(), this.reconnectInterval)
           }
       }
   }

   send (data) {
       if (this.isConnected()) {
           this.socket.send(JSON.stringify(data))
       } else {
           console.warn('WebSocket is not connected. Message not sent.')
       }
   }

   addListener (callback) {
       this.listeners.push(callback)
   }

   removeListener (callback) {
       this.listeners = this.listeners.filter((listener) => listener != callback)
   }

   close () {
       if (this.socket) {
           this.socket.close()
       }
   }
}

export default WebSocketService