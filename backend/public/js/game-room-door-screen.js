import WebSocketService from "./WebSocketService.js"

const path = window.location.pathname

document.title = `GRA-${path.split('/')[2]}`

const WS_URL = `ws://${window.location.hostname}:8081`
const CLIENT = `game-room-${path.split('/')[2]}`
const gameRoomId = path.split('/')[2]

let wsService = null
let isRoomAvailable = false

let players = []
let messageTimeout = null;
let messageUpdateInterval = null
let removePlayerTimeout = null;  // New timeout for player removal after "Please come in"
let highlightedPlayerIds = new Set()

const messageArea = document.getElementById('message-area')

function startListeningToSocket() {
    function handleWebSocketMessage(data) {
        console.log('Received webSocket message:', data)
        const messageHandlers = {
            'booth_confirmed': async () => {
                if (data.location === 'game-room' && Number(data.id) === Number(gameRoomId)) {
                    const playerId = data.player;
                    try {
                        const res = await fetch(`/api/players/${playerId}`);
                        if (res.ok) {
                            const player = await res.json();
                            if (!players.some(p => p.id === player.id)) {
                                players.push(player);
                                renderPlayers();
                            }
                        } else {
                            console.error('Failed to fetch player data:', res.status);
                        }
                    } catch (err) {
                        console.error('Fetch error:', err);
                    }
                }
            },
            'rfid_scanned': async () => {
                if (data.location === 'game-room' && Number(data.id) === Number(gameRoomId)) {
                    const playerId = data.player;
                    try {
                        const res = await fetch(`/api/players/${playerId}`);
                        if (res.ok) {
                            const player = await res.json();
                            if (!highlightedPlayerIds.has(player.id)) {
                                highlightedPlayerIds.add(player.id);
                            }
                            renderPlayers(player.id); // highlight the player
                        } else {
                            console.error('Failed to fetch player data:', res.status);
                        }
                    } catch (err) {
                        console.error('Fetch error:', err);
                    }
                }
            }, 
            'status_update': () => {
                if (data.status === 'waiting') {
                    const bookRoomUntil = new Date(data.book_room_until)
                    const now = new Date()
                    const minutesLeft = Math.max(0, Math.ceil((bookRoomUntil - now) / 60000))
                    // Display the waiting message only if no players have been scanned or the room is busy
                    if (players.length === 0 || !isRoomAvailable) {
                        showMessage(`Please hold on for a while, it will be your turn in ${minutesLeft} minute${minutesLeft !== 1 ? 's' : ''}`, bookRoomUntil)
                    }
                }
                if (data.status === 'ready') {
                    showMessage('Please come in');
                    // Set a timeout to remove players after 5 seconds
                    if (removePlayerTimeout) clearTimeout(removePlayerTimeout);
                    removePlayerTimeout = setTimeout(() => {
                        players = [];  // Clear players after the timeout
                        highlightedPlayerIds.clear();
                        renderPlayers();  // Re-render player cards
                        showMessage("Room is busy, please wait..."); // Default message after players are removed
                    }, 5000);
                }
            },
            'toggleRoom': () => {
                //isRoomAvailable = data.states[`gra-${gameRoomId}.local`].isAvailable
                isRoomAvailable = data.states[`localhost`].isAvailable
                renderPlayers()
            },
            'roomAvailable': () => {
                const prevRoomAvailability = isRoomAvailable;
                isRoomAvailable = data.isAvailable
                renderPlayers()

                // Only show the "Please scan your tags" message when the room is available and there are no players.
                if (isRoomAvailable && players.length === 0) {
                    showMessage('Please scan your tags');
                }

                // If the room availability changed from false to true, update the message.
                if (!prevRoomAvailability && isRoomAvailable && messageArea.innerHTML.includes("Please hold on")) {
                    showMessage('Please scan your tags');
                }
            }
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

function showMessage(msg, untilTime = null) {
    // If the message is "Please come in", clear any previous messages and stop intervals or timeouts.
    if (msg === "Please come in") {
        messageArea.innerHTML = `<div class="message display-6">${msg}</div>`;
        if (messageTimeout) clearTimeout(messageTimeout);
        if (messageUpdateInterval) clearInterval(messageUpdateInterval);
        return;  // Exit early to prevent other actions
    }

    messageArea.innerHTML = `<div class="message display-6">${msg}</div>`;

    // Clear any existing intervals or timeouts to avoid conflicts.
    if (messageTimeout) clearTimeout(messageTimeout);
    if (messageUpdateInterval) clearInterval(messageUpdateInterval);

    if (untilTime) {
        const delay = untilTime - new Date();
        messageTimeout = setTimeout(() => {
            messageArea.innerHTML = `<div class="message display-6">Please scan your tags</div>`;
        }, delay);

        messageUpdateInterval = setInterval(() => {
            const now = new Date();
            const minutesLeft = Math.max(0, Math.ceil((untilTime - now) / 60000));
            messageArea.innerHTML = `<div class="message display-6">Please hold on for a while, it will be your turn in less than ${minutesLeft} minute${minutesLeft !== 1 ? 's' : ''}</div>`;
        }, 60000);
    } else {
        messageTimeout = setTimeout(() => {
            messageArea.innerHTML = ``;
        }, 5000);
    }

    renderPlayers();
}

function renderPlayers(highlightedPlayerId = null) {
    const container = document.getElementById('player-container');
    container.innerHTML = '';

    // If there are no players and the room is available, show the "scan tags" message.
    if (players.length === 0 && isRoomAvailable) {
        messageArea.innerHTML = `<div class="message display-6">Please scan your tags</div>`;
        return;
    }

    players.forEach(player => {
        const card = document.createElement('div');
        card.className = 'player-card border rounded p-2 mb-4 d-flex align-items-center justify-content-center gap-2 disabled';
        if (highlightedPlayerIds.has(player.id)) {
            card.classList.remove('disabled')
            card.classList.add('highlighted')
        }

        card.innerHTML = `
            <img src="/api/images/players/${player.id}.jpg" alt="${player.nick_name}'s image" style="width: 100px; height: 100px; object-fit: cover;" />
            <span class="display-6">${player.nick_name}</span>
        `;
        container.appendChild(card);
    });
}

renderPlayers()
startListeningToSocket()
