import WebSocketService from "./WebSocketService.js";

const path = window.location.pathname

document.title = `Booth ${path.split('/')[2]}`

const WS_URL = `ws://${window.location.hostname}:8081`
const CLIENT = `booth-${path.split('/')[2]}`
const boothId = `${path.split('/')[2]}`

let wsService = null

let players = []
let messageTimeout = null;

const confirmArea = document.getElementById('confirm-area');

function startListeningToSocket() {
    function handleWebSocketMessage(data) {
        console.log('Received webSocket message:', data)
        const messageHandlers = {
            'rfid_scanned': async () => {
                if (data.location === 'booth' && Number(data.id) === Number(boothId)) {
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
            'destination': () => {
               showMessage(`Follow the pink lights to ${data.goal}`)
            },
            'rooms_are_busy': () => {
               console.log(data)
            },
        };
    
        const handler = messageHandlers[data.type];
        if (typeof handler === 'function') {
            handler(); // We can safely call it
        } else {
            console.warn(`No valid handler for message type: ${data.type}`);
        }
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

function getCommonLeague(players) {
    const leagues = players.map(p => p.league);
    return leagues.reduce((common, league) => {
      if (!common) return league;
      if (common.country === league.country && common.city === league.city) return common;
      return null;
    }, null);
}

async function handleConfirm() {
    try {
      if (players.length > 1) {
        const commonLeague = getCommonLeague(players);
        const teamData = {
          unique_identifiers: players.map(p => p.id),
          leagues: commonLeague ? (() => {
            const { district, other, ...cleaned } = commonLeague;
            return cleaned;
          })() : null
        };

        const res = await fetch('/api/teams/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(teamData)
        });

        if (res.ok) {
          console.log('Players sent to team:', await res.json());
          wsService.send({ type: 'confirm', from: CLIENT });
        }
      } else {
        wsService.send({ type: 'confirm', from: CLIENT });
      }

      setTimeout(() => {
        players = [];
        renderPlayers();
      }, 5000);
    } catch (err) {
      console.error('Error confirming:', err);
    }
}

function showMessage(msg) {
   confirmArea.innerHTML = `<div class="message display-6">${msg}</div>`;
   if (messageTimeout) clearTimeout(messageTimeout);
   messageTimeout = setTimeout(() => {
      confirmArea.innerHTML = '';
      players = []
      renderPlayers();
   }, 5000);
}

function renderPlayers() {
   const container = document.getElementById('player-container');
   container.innerHTML = '';
   confirmArea.innerHTML = '';

   if (players.length === 0) {
      container.innerHTML = `<div class="message display-6">Please scan your tags</div>`;
      return;
   }

   players.forEach(player => {
   const card = document.createElement('div');
   card.className = 'player-card border rounded p-2 mb-4 d-flex align-items-center justify-content-center gap-2';
   card.innerHTML = `
      <img src="/api/images/players/${player.id}.jpg" alt="${player.nick_name}'s image" style="width: 100px; height: 100px; object-fit: cover;" />
      <span class="display-6">${player.nick_name}</span>
   `;
   container.appendChild(card);
   });

   const button = document.createElement('button');
   button.className = 'confirm-button btn';
   button.textContent = 'Confirm';
   button.onclick = handleConfirm;
   confirmArea.appendChild(button);
}

renderPlayers()
startListeningToSocket()
