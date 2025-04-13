import WebSocketService from "./WebSocketService.js";
import { formatDate, formatTime } from "./FormatDateAndTime.js";

const WS_URL = `ws://${window.location.hostname}:8081`
const CLIENT = 'monitor'

let wsService = null

let clients = {}
let activePlayers = []
let recentPlayers = []
let scannedPlayers = []

let toggleRoomData = {}

let searchedPlayers = []
let category = "email"; // default category
let query = "";
let searchAttempted = false;

let selectedPlayer = null;

const playerCardsContainer = document.getElementById("player-cards");
const queryInput = document.getElementById("query");
const searchButton = document.getElementById("search-btn");
const categoryDropdownToggle = document.getElementById("categoryDropdown");
const categoryItems = document.querySelectorAll(".dropdown-item");

function startListeningToSocket() {
    function handleWebSocketMessage(data) {
        console.log('Received webSocket message:', data)
        const messageHandlers = {
            'clientData': () => {
              clients = data.clients

              console.log(clients)
              renderScanButtons();
            },
            'confirmed': () => scannedPlayers = {},
            'error': () => {
                // Clone the current errors
                const newErrors = { ...errors };
                                
                Object.keys(data.data).forEach((source) => {
                    const merged = data.data[source];
                    newErrors[source] = dedupeErrors(merged);
                });

                // Update global state and render
                errors = newErrors;
                renderAlerts(errors);
            },
            'facility_session': () => {
              activePlayers = data.active_players || []            
              recentPlayers = data.recent_players || []
              
              if (!searchAttempted) {
                setPlayers([...activePlayers]);
              }

              renderPlayerList(activePlayers, 'active-players', true);
              renderPlayerList(recentPlayers, 'recent-players', false);

              populatePlayers();
            },
            'reportedErrors': () => {
                const cleanedErrors = {};
                 
                Object.keys(data.data).forEach((source) => {
                   const merged = data.data[source]; 
                   cleanedErrors[source] = dedupeErrors(merged);
                });
             
                // Replace global state and render
                errors = cleanedErrors;
                renderAlerts(errors);    
            },
            'rfid_scanned': () => {
              if (data.location === 'booth') {
                // Check if the player has already been scanned at any booth
                const playerScannedLocations = scannedPlayers[data.player]

                if (playerScannedLocations && playerScannedLocations.some(loc => loc.startsWith('booth'))) {
                    // Player has already been scanned at a booth
                    console.log(`Player ${data.player} has already been scanned at a booth`)
                    return // Stop further processing, or send an error message to the user
                }
              }

              if (!scannedPlayers[data.player]) {
                scannedPlayers[data.player] = [`${data.location}-${data.id}`];
              } else {
                scannedPlayers[data.player].push(`${data.location}-${data.id}`);
              }
            },
            'status_update': () => {},
            'storedStates': () => {},
            'toggleRoom': () => {
              toggleRoomData = data.states
              renderGameRoomToggles()
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

// DOM renders
const errorBadgeElement = document.getElementById('error-badge')
let errors = {}

function renderAlerts(errors) {
    const errorCount = Object.values(errors).reduce(
        (total, sourceErrors) => total + (Array.isArray(sourceErrors) ? sourceErrors.length : 0),
        0
    )
    
    if (errorCount > 0) {
        errorBadgeElement.textContent = errorCount;
        errorBadgeElement.classList.remove('d-none');
    } else {
        errorBadgeElement.textContent = '';
        errorBadgeElement.classList.add('d-none');
    }

    const content = document.getElementById('alerts-body')
    content.innerHTML = ''

    if (!errors || Object.keys(errors).length === 0) {
        content.innerHTML = `<p class="text-muted">No alerts at the moment.</p>`;
        return;
    }

    let hasContent = false;

    for (const [source, errorList] of Object.entries(errors)) {
        if (errorList.length === 0) continue;
    
        hasContent = true;
        const container = document.createElement('div');
        container.className = 'mb-4';
    
        for (const error of errorList) {
          const card = document.createElement('div');
          card.className = 'card mb-3 border-danger';
    
          const cardBody = document.createElement('div');
          cardBody.className = 'card-body';
    
          const title = document.createElement('h5');
          title.className = 'card-title text-danger fw-semibold';
          title.textContent = (typeof error.error === 'object') ? 'An error occurred' : (error.error || 'Unknown error');
    
          const metaInfo = document.createElement('div');
          metaInfo.className = 'card-text text-muted';
          
          const timestampEl = document.createElement('small');
          timestampEl.textContent = new Date(error.timestamp).toLocaleString();
          
          const sourceEl = document.createElement('small');
          sourceEl.textContent = ` • Source: ${source}`; // or format however you like
          sourceEl.classList.add('ms-2'); // margin-left for spacing
          
          metaInfo.appendChild(timestampEl);
          metaInfo.appendChild(sourceEl);
          cardBody.appendChild(title);
          cardBody.appendChild(metaInfo)
          card.appendChild(cardBody);
          container.appendChild(card);
        }
    
        content.appendChild(container);
      }
    
      if (!hasContent) {
        content.innerHTML = `<p class="text-muted">No alerts at the moment.</p>`;
      }
}

function dedupeErrors(errorsArray) {
    const seen = new Set();
    return errorsArray.filter((err) => {
       if (err.resolved) return false;
       const key = err.error;
       if (seen.has(key)) return false;
       seen.add(key);
       return true;
    });
}

/** Toast */
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toastMessage');

function showToast(message, variant) {
    toast.classList.remove('bg-success', 'bg-danger');
    toast.classList.add(variant === 'success' ? 'bg-success' : 'bg-danger');
    toastMessage.textContent = message;
    const bsToast = new bootstrap.Toast(toast, { delay: 3000 });
    bsToast.show();
}

function initPlayerFormHandler() {
    const playerForm = document.getElementById('playerForm');

    if (!playerForm || !toast || !toastMessage) {
        console.error('Missing required elements for player form');
        return;
    }

    playerForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const formData = new FormData(playerForm);
        const data = Object.fromEntries(formData.entries());

        const phone = `${data.phone_country_code || '+1'}${data.phone}`;
        delete data.phone_country_code;
        data.phone = phone;

        try {
            const response = await fetch('/api/players/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            const result = await response.json();

            if (response.ok) {
                playerForm.reset();
                showToast(result.message || 'Player created successfully.', 'success');
            } else {
                throw new Error(result.error || 'Something went wrong.');
            }
        } catch (err) {
            showToast(err.message, 'danger');
        }
    });
}

function initFacilitySearchHandlers() {
    // Format category text
    function formatCategoryText(text) {
      return text
        .replace(/_/g, ' ')
        .replace(/\b\w/g, char => char.toUpperCase());
    }
  
    // Set loading state
    function setLoading(isLoading) {
        const loader = document.getElementById("search-loader");
        if (loader) {
          loader.classList.toggle("d-none", !isLoading);
        }
    }
      
    // Handle search click
    async function handleSearchClick() {
        query = queryInput.value.trim(); 
    
        if (query === '') return;
    
        searchAttempted = true; 
        setLoading(true);
        playerCardsContainer.innerHTML = '';
    
        try {
            const res = await fetch(`/api/players/search?${category}=${encodeURIComponent(query)}`);
            if (!res.ok) throw new Error("Search request failed");
        
            const data = await res.json();

            setLoading(false)

            if (Array.isArray(data) && data.length > 0) {
                searchedPlayers = data || []
                setPlayers(data);
            } else {
                setPlayers([]); 
            }
        } catch (err) {
            console.error("Search error:", err);
            setLoading(false);       // stop loader first
            setPlayers([]);          // still show "No players found"
        } finally {
            setLoading(false)
        }
    }
  
    // Clear players if query is empty
    queryInput.addEventListener("input", (e) => {
      query = e.target.value.trim();
      if (query === "") {
        searchAttempted = false;
        setLoading(false)
        setPlayers([...activePlayers]);
      }
    });
  
    // Category selection
    categoryItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        category = item.getAttribute("data-value");
        // Update dropdown text
        const formattedCategory = formatCategoryText(category);
        // console.log(`Updating dropdown button text to: ${formattedCategory}`);
        categoryDropdownToggle.textContent = formattedCategory;
      });
    });
  
    // Search button click
    searchButton.addEventListener("click", handleSearchClick);
}

function setPlayers(players) {
  if (!Array.isArray(players)) {
    console.warn("setPlayers expected an array but got:", players);
    return;
  }

  if (!playerCardsContainer) {
    console.error("playerCardsContainer is not set.");
    return;
  }

  // Deduplicate by player.id
  const uniquePlayersMap = new Map();
  players.forEach(p => uniquePlayersMap.set(p.id, p));
  const uniquePlayers = Array.from(uniquePlayersMap.values());

  // Clear old cards
  playerCardsContainer.innerHTML = '';

  if (uniquePlayers.length === 0 && searchAttempted) {
    playerCardsContainer.innerHTML = `<p class='w-100 text-center'>No players found.</p>`;
    return;
  }

  uniquePlayers.forEach(player => {
    renderPlayerCard(player); // abstracted for clarity
  });
}  

function renderPlayerCard(player) {
  const fullName = `${player.first_name ?? ''} ${player.last_name ?? ''}`.trim();

    let displayValue = '';
    if (category === 'first_name' || category === 'last_name') {
      const regex = new RegExp(`(${query})`, 'i');
      displayValue = fullName.replace(regex, `<span class="highlight-match fw-bold">$1</span>`);
    } else {
      const matchedValue = player[category] || '—';
      displayValue = `<span class="highlight-match fw-bold">${matchedValue}</span>`;
    }

    const formatDate = (dateStr) => dateStr ? dateStr.split('T')[0] : '—';
    const formatTime = (timeStr) => new Date(timeStr).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

    const card = document.createElement("div");
    card.className = "border border-4 p-2 mb-2 rounded d-flex flex-column gap-1 bg-transparent text-white";

    const activeInfo = Array.isArray(activePlayers)
      ? activePlayers.find(p => p.id === player.id)
      : null;
    const isActive = !!activeInfo;

    card.innerHTML = `
      ${
        isActive
          ? `<div class="player-card-info">
                <span class="fs-5">${player.first_name} ${player.last_name}</span>
                <span class="fs-5">${player.nick_name}</span>
            </div>
            <div class="active-session-info d-flex justify-content-between mt-2">
                <span><strong>Session Start:</strong> ${formatDate(activeInfo.facility_session.date_start)} ${formatTime(activeInfo.facility_session.date_start)}</span><br/>
                <span><strong>Session End:</strong> ${formatDate(activeInfo.facility_session.date_end)} ${formatTime(activeInfo.facility_session.date_end)}</span>
              </div>`
          : `<div class="player-card-info">
                <h5 class="highlight">${player.nick_name}</h5>
                <span class="highlight">${displayValue}</span>
            </div>
            <div class="player-card-meta">
                <span>Date Added: ${formatDate(player.date_add)}</span>
                <span>Last Visit: ${formatDate(player.last_visit)}</span>
            </div>
            <div class="d-flex align-items-center justify-content-end gap-2 mt-1">
                <select class="form-select form-select-sm w-auto duration-select">
                    <option value="15">15 mins</option>
                    <option value="30">30 mins</option>
                    <option value="45">45 mins</option>
                    <option value="60">60 mins</option>
                    <option value="75">75 mins</option>
                    <option value="90">90 mins</option>
                </select>
                <button class="btn btn-sm btn-success confirm-btn">Confirm</button>
            </div>
            <div class="session-times mt-2"></div>`
      }
    `;

    if (!isActive) {
      const confirmBtn = card.querySelector(".confirm-btn");
      const durationSelect = card.querySelector(".duration-select");

      confirmBtn.addEventListener("click", async () => {
        const selectedDuration = durationSelect.value;

        if (!player.id || !selectedDuration) {
          console.log("Missing player ID or duration");
          return;
        }

        try {
          const res = await fetch("/api/facility-session/create", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              player_id: player.id,
              duration_m: selectedDuration
            })
          });

          if (!res.ok) throw new Error("Session creation failed");

          const data = await res.json();
          console.log("Facility session created:", data);

          showToast("Facility session successfully created!", "success");
          
          if (searchAttempted) {
            setPlayers([...searchedPlayers]);
          } else {
            setPlayers([...activePlayers]);
          }

        } catch (err) {
          console.error("Error creating facility session:", err);
          showToast("Failed to create facility session.", "danger");
        }
      });
    }
    playerCardsContainer.appendChild(card);
} 

function renderPlayerList(list, containerId, isSelectable = true) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  list.forEach(player => {
    const li = document.createElement('li');
    li.className = 'list-group-item list-group-item-action';
    li.textContent = `${player.id} - ${player.nick_name}`;
    if (isSelectable) {
      li.style.cursor = 'pointer';
      li.onclick = () => {
        selectedPlayer = player;
        document.querySelectorAll(`#${containerId} .active`).forEach(el => el.classList.remove('active'));
        li.classList.add('active');
      };
    }
    container.appendChild(li);
  });
}

function groupClients() {
  const grouped = {};

  // Group booths
  clients?.booths?.forEach((booth, index) => {
    const match = booth.match(/(\d+)$/); // Extract number from name
    if (match) {
      const id = match[0];
      if (!grouped[id]) grouped[id] = {};
      grouped[id].booth = { name: booth, index };
    }
  });

  // Group game-room-door-screens
  clients?.['game-room-door-screens']?.forEach((gameRoom, index) => {
    const match = gameRoom.match(/(\d+)$/);
    if (match) {
      const id = match[0];
      if (!grouped[id]) grouped[id] = {};
      grouped[id].gameRoom = { name: gameRoom, index };
    }
  });

  return grouped;
}

function renderScanButtons() {
  const grouped = groupClients();
  const container = document.getElementById('scan-buttons');
  container.innerHTML = '';

  Object.entries(grouped).forEach(([id, { booth, gameRoom }]) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'p-2 d-flex flex-column';

    if (booth) {
      const btn = document.createElement('button');
      btn.className = 'btn mb-2';
      btn.textContent = `Scan at ${booth.name}`;
      btn.style.minWidth = '200px';
      btn.style.maxWidth = '300px';
      btn.onclick = () => handleScan('booth', booth.index + 1, selectedPlayer);
      wrapper.appendChild(btn);

      console.log('selected player:', selectedPlayer)
    }

    if (gameRoom) {
      const btn = document.createElement('button');
      btn.className = 'btn mb-2';
      btn.textContent = `Scan at ${gameRoom.name}`;
      btn.style.minWidth = '200px';
      btn.style.maxWidth = '300px';
      btn.onclick = () => handleScan('game-room', gameRoom.index + 1, selectedPlayer);
      wrapper.appendChild(btn);

      console.log('selected player:', selectedPlayer)
    }

    container.appendChild(wrapper);
  });
}

function handleScan(type, id, player) {
  if (!player || !player.id) {
    showToast('Please select a player to scan.', 'danger');
    return;
  }

  const playerScannedLocations = scannedPlayers[player.id] || [];
  if (
    (type === 'booth' && playerScannedLocations.some(loc => loc.startsWith('booth'))) ||
    (type === 'game-room' && playerScannedLocations.some(loc => loc.startsWith('game-room')))
  ) {
    showToast(`Player ${player.id} is already scanned at a ${type}.`, 'warning');
    return;
  }

  const url = type === 'booth'
    ? `/api/rfid/booth/${id}`
    : `/api/rfid/game-room/${id}`;

  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      rfid_tag: 'PLACEHOLDER-RFID',
      player: player.id
    })
  })
  .then(response => {
    if (!response.ok) throw new Error('Network response was not ok');
    
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return response.json();
    } else {
      return response.text(); // fallback if response is plain text
    }
  })
  .then(data => {
    showToast(`Scan successful at ${type} for player ${player.id}!`, 'success');
  })
  .catch(error => {
    console.error('Error scanning RFID:', error);
    showToast('Error scanning RFID.', 'danger');
  });
}

const playerIdEl = document.getElementById('playerId');
const timeCreditEl = document.getElementById('timeCredit');
const addTimeBtn = document.getElementById('addTimeBtn');

const populatePlayers = () => {
  playerIdEl.innerHTML = '';

  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = 'Select a player';
  playerIdEl.appendChild(defaultOption);
  
  const appendGroup = (label, players) => {
    const optGroup = document.createElement('optgroup');
    optGroup.label = label;
    players.sort((a, b) => a.id.localeCompare(b.id)).forEach(player => {
      const option = document.createElement('option');
      option.value = player.id;
      option.textContent = `${player.id} - ${player.nick_name}`;
      optGroup.appendChild(option);
    });
    playerIdEl.appendChild(optGroup);
  };

  appendGroup('Active Sessions', activePlayers);
  appendGroup('Recently Ended Sessions', recentPlayers);
}

addTimeBtn.addEventListener('click', async () => {
  const playerId = playerIdEl.value;
  const timeCredit = timeCreditEl.value;

  console.log(playerId);
  console.log(timeCredit);

  if (!playerId || !timeCredit) {
    showToast('Please select a player and time credit.', 'warning');
    return;
  }

  try {
    const response = await fetch('/api/facility-session/add-time-credits', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        player_id: playerId,
        additional_m: parseInt(timeCredit, 10)
      })
    });

    if (response.ok) {
      showToast(`Added ${timeCredit} minutes to player ${playerId} successfully!`, 'success');
      timeCreditEl.value = '';
    } else {
      const errorData = await response.json();
      console.error('Error response:', errorData);
      showToast('Failed to add time credits.', 'danger');
    }
  } catch (err) {
    console.error('Fetch error:', err);
    showToast('Failed to add time credits.', 'danger');
  }
});

const renderGameRoomToggles = () => {
  const container = document.getElementById('gameRoomToggles');
  container.innerHTML = '';

  Object.keys(toggleRoomData).forEach((key) => {
    const isEnabled = toggleRoomData[key].enabled;

    const div = document.createElement('div');
    div.className = 'form-check form-switch';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'form-check-input';
    input.id = `toggle-${key}`;
    input.checked = isEnabled;
    input.addEventListener('change', () => toggleGameRoom(key, isEnabled));

    const label = document.createElement('label');
    label.className = 'form-check-label';
    label.setAttribute('for', input.id);
    label.textContent = `${isEnabled ? 'Disable' : 'Enable'} ${key}`;

    div.appendChild(input);
    div.appendChild(label);
    container.appendChild(div);
  });
};

const toggleGameRoom = async (gameRoomKey, currentStatus) => {
  const newStatus = !currentStatus;
  const roomId = gameRoomKey.split('.')[0];

  try {
    const response = await fetch(`/api/game-room/${roomId}/toggle-room`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: newStatus }),
    });

    if (response.ok) {
      showToast(`${gameRoomKey} ${newStatus ? 'enabled' : 'disabled'} successfully!`, 'success');
      toggleRoomData[gameRoomKey].enabled = newStatus;
      renderGameRoomToggles(); // Re-render with updated state
    } else {
      const errorData = await response.json();
      console.error('Error:', errorData);
      showToast(`Failed to toggle ${gameRoomKey}`, 'danger');
    }
  } catch (err) {
    console.error('Fetch error:', err);
    showToast(`Failed to toggle ${gameRoomKey}`, 'danger');
  }
};

document.addEventListener('DOMContentLoaded', () => {
  initPlayerFormHandler()
  initFacilitySearchHandlers()
})

startListeningToSocket();

