import WebSocketService from "./WebSocketService.js";
import { formatDate } from "./FormatDateAndTime.js";

const WS_URL = `ws://${window.location.hostname}:8081`
const CLIENT = 'monitor'

let wsService = null

let clientData = {}
let activePlayers = []
let recentPlayers = []
let toggleRoomData = []

function startListeningToSocket() {
    function handleWebSocketMessage(data) {
        console.log('Received webSocket message:', data)
        const messageHandlers = {
            'clientData': () => {},
            'confirmed': () => {},
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
            'facility_session': () => {},
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
            'rfid_scanned': () => {},
            'status_update': () => {},
            'storedStates': () => {},
            'toggleRoom': () => {}
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
/** Alert Renders */
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

// Event listeners to load content for each tab on click
document.querySelector('#player-tab').addEventListener('click', (e) => {
    e.preventDefault();
    loadTabContent('player', '/pages/components/create-players.html', () => {
        setActiveTab('player');
        initPlayerFormHandler(); // <== Add this
    });
});


document.querySelector('#facility-tab').addEventListener('click', (e) => {
    e.preventDefault();
    loadTabContent('facility', '/pages/components/create-facility-session.html', () => {
        setActiveTab('facility');
        initFacilitySearchHandlers();
    });
});

document.querySelector('#rfid-tab').addEventListener('click', (e) => {
    e.preventDefault();
    loadTabContent('rfid', '/pages/components/rfid-simulator.html');
    setActiveTab('rfid');
});

document.querySelector('#others-tab').addEventListener('click', (e) => {
    e.preventDefault();
    loadTabContent('others', '/pages/components/game-room-controls.html');
    setActiveTab('others');
});

/** Tab Controls and Search Event Handler */
function loadTabContent(tabId, contentUrl, callback) {
    fetch(contentUrl)
        .then(response => response.text())
        .then(html => {
            document.querySelector(`#${tabId}`).innerHTML = html;
            if (typeof callback === 'function') {
                callback()
            }
        })
        .catch(error => console.error('Error loading content:', error));
}

// Set the active tab and show corresponding content
function setActiveTab(tabId) {
    document.querySelectorAll('.tab-pane').forEach((pane) => {
        pane.classList.remove('show', 'active');
    });
    document.querySelector(`#${tabId}`).classList.add('show', 'active');
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
    const queryInput = document.getElementById("query");
    const searchButton = document.getElementById("search-btn");
    const playerCardsContainer = document.getElementById("player-cards");
    const categoryDropdownToggle = document.getElementById("categoryDropdown");
    const categoryItems = document.querySelectorAll(".dropdown-item");
  
    if (!queryInput || !searchButton || !playerCardsContainer || !categoryDropdownToggle) {
      console.error("One or more required elements are missing!");
      return;
    }
  
    let category = "email"; // default category
    let query = "";
    let searchAttempted = false;
    let loading = false;
  
    // Format category text
    function formatCategoryText(text) {
      return text
        .replace(/_/g, ' ')
        .replace(/\b\w/g, char => char.toUpperCase());
    }
  
    // Set loading state
    function setLoading(isLoading) {
      loading = isLoading;
      searchButton.disabled = isLoading;
      searchButton.textContent = isLoading ? "Searching..." : "Search";
    }
  
    // Set player cards
    function setPlayers(players) {
      playerCardsContainer.innerHTML = '';
  
      if (players.length === 0 && searchAttempted) {
        playerCardsContainer.innerHTML = `<div class="text-muted">No players found.</div>`;
        return;
      }
  
      players.forEach(player => {
        const matchedValue = player[category] || '—';
        const highlightedValue = `<span class="highlight-match fw-bold">${matchedValue}</span>`;

        const card = document.createElement("div");
        card.className = "border border-4 p-2 mb-2 rounded d-flex flex-column gap-1 bg-transparent text-white";

        card.innerHTML = `
        <div class="player-card-info">
            <h5 class="highlight">${player.nick_name}</h5>
            <span class="highlight">${highlightedValue}</span>
        </div>
        <div class="player-card-meta">
            <span>Date Added: ${player.date_add}</span>
            <span>Last Visit: ${player.last_visit}</span>
        </div>
        <div class="d-flex align-items-center justify-content-end gap-2 mt-1">
            <select class="form-select form-select-sm w-auto">
                <option value="15">15 mins</option>
                <option value="30">30 mins</option>
                <option value="45">45 mins</option>
                <option value="60">60 mins</option>
                <option value="75">75 mins</option>
                <option value="90">90 mins</option>
            </select>
            <button class="btn btn-sm btn-success">Confirm</button>
        </div>
        `;

        playerCardsContainer.appendChild(card);
      });
    }
  
    // Handle search click
    async function handleSearchClick() {
      if (query.trim() === '') return;
  
      searchAttempted = true;
      setLoading(true);
  
      try {
        const res = await fetch(`/api/players/search?${category}=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error("Search request failed");
  
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setPlayers(data);
          console.log(data)
        } else {
          setPlayers([]);
        }
      } catch (err) {
        console.error("Search error:", err);
      } finally {
        setLoading(false);
      }
    }
  
    // Clear players if query is empty
    queryInput.addEventListener("input", (e) => {
      query = e.target.value.trim();
      if (query === "") {
        searchAttempted = false;
        setPlayers([]);
      }
    });
  
    // Category selection
    categoryItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        category = item.getAttribute("data-value");
  
        // Log category change
        // console.log(`Category changed to: ${category}`);
  
        // Update dropdown text
        const formattedCategory = formatCategoryText(category);
        // console.log(`Updating dropdown button text to: ${formattedCategory}`);
        categoryDropdownToggle.textContent = formattedCategory;
      });
    });
  
    // Search button click
    searchButton.addEventListener("click", handleSearchClick);
  
    // Confirm duration
 /*    confirmButton.addEventListener("click", () => {
      const selectedDuration = durationSelect.value;
      console.log(`Session duration selected: ${selectedDuration} minutes`);
      // Your logic for duration confirmation here...
    }); */
}
  
  



// Optionally, load the default tab content
loadTabContent('player', '/pages/components/create-players.html');
setActiveTab('player');

startListeningToSocket();

