import WebSocketService from "./WebSocketService.js";

const path = window.location.pathname

document.title = `Booth ${path.split('/')[2]}`

const boothElement = document.getElementById('app')

boothElement.innerText = `Booth ${path.split('/')[2]}`

const WS_URL = `ws://${window.location.hostname}:8081`
const CLIENT = `booth-${path.split('/')[2]}`

let wsService = null

function startListeningToSocket() {
    function handleWebSocketMessage(data) {
        console.log('Received webSocket message:', data)
        const messageHandlers = {
            //'bookRoomCountdown': () => console.log(data.remainingTime),
        }
   
        if (!messageHandlers[data.type]) {console.warn(`No handler for this message type ${data.type}`)}
  
        messageHandlers[data.type]()
    }

    function initWebSocket() {
        if (!wsService) {
            wsService = new WebSocketService(WS_URL, CLIENT)
            wsService.connect()
        }
    
        wsService.addListener(handleWebSocketMessage)
    }
    
    function cleanupWebSocket() {
        if (wsService) {
            wsService.removeListener(handleWebSocketMessage)
            wsService.close()
            wsService = null
        }
    }
    
    window.addEventListener('load', initWebSocket)
    window.addEventListener('beforeunload', cleanupWebSocket)

}

startListeningToSocket()
