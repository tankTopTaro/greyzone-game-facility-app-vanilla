# Greyzone Game Facility App

## Table of Contents
- [Greyzone Game Facility App](#greyzone-game-facility-app)
  - [Table of Contents](#table-of-contents)
  - [Mission](#mission)
  - [Technologies Used](#technologies-used)
  - [Installation](#installation)
  - [Application Suite Execution Order](#application-suite-execution-order)
  - [Bugs and Issues](#bugs-and-issues)
  - [Important Features](#important-features)

---
## Mission
The **Greyzone Game Facility App** is a comprehensive system designed to manage operations within a game facility. It serves as a central hub for handling player data, coordinating RFID scans, managing game room sessions, and maintaining a smooth facility workflow.


---

## Technologies Used

The following technologies and frameworks are used in this application:

![HTML](https://img.shields.io/badge/HTML-5-orange?style=flat-square&logo=html5&logoColor=white)  
![CSS](https://img.shields.io/badge/CSS-3-blue?style=flat-square&logo=css3&logoColor=white)  
![JavaScript](https://img.shields.io/badge/JavaScript-ES6-yellow?style=flat-square&logo=javascript&logoColor=white)  
![Bootstrap](https://img.shields.io/badge/Bootstrap-5-purple?style=flat-square&logo=bootstrap&logoColor=white)  
![React](https://img.shields.io/badge/React-18-blue?style=flat-square&logo=react&logoColor=white)  
![Node.js](https://img.shields.io/badge/Node.js-16-green?style=flat-square&logo=node.js&logoColor=white)

---

## Installation

To set up the **Greyzone Game Room App** on your local environment:

1. **Install Dependencies**  
   - Install the necessary dependencies for both the backend and frontend:
   ```bash 
   npm install
   ```

2. **Build the Frontend**  
   - Build the frontend for production:
   ```bash 
   npm run build
   ```

3. **Start the Backend**  
   - Start the backend server:
   ```bash 
   npm start
   ```
---
## Application Suite Execution Order

To ensure proper operation and communication between the components of the system, follow this execution order:

1. **Start the Game Facility App (GFA) First**
   - The GFA is responsible for initializing and loading all shared resources required by other modules.

   - It must be running before any Game Room App (GRA) instance can connect.
  
2. **Start Game Room Apps (GRAs) After GFA Initialization**
   - Once the GFA is fully initialized, GRAs can be launched.

   - Upon successful connection, each GRA will transmit its current room status to the GFA.

   - These statuses are saved and used by the GFA to monitor and coordinate game room operations in real-time.

---
---
## Bugs and Issues

1. **Delayed CSA Response**  
   In some cases, the CSA (Central Server App) may experience delayed responses. This is due to the hosting service's behavior of spinning down inactive servers, resulting in cold starts that can delay request handling by up to 50 seconds.

2. **Temporary Storage of Player Images**  
   Player profile images uploaded for new users may be deleted at the end of each day. This occurs because the current hosting environment for the CSA does not support persistent file storage. As a result, all uploaded images are stored temporarily in-memory or in a non-persistent file system.


---
## Important Features

1. **Player Profile Creation**
   - Users can register new players through a simple form.

   - RFID tag assignment and profile image uploads are currently disabled due to public server limitations.

   - Player images are temporarily assigned from a preset image pool and are cleared daily.

2. **Facility Session Controller**
   - Enables player search and facility session creation.

   - Automatically moves players from "Active Players" to "Recent Players" when sessions end.

   - "Recent Players" includes users whose sessions ended within the last hour.
   
3. **RFID Simulator**
   - Simulates player scans at booths and game room doors.

   - Booth scans prompt players to confirm their session, creating a pending game session.

   - Once confirmed, players can scan at the game room door to gain entry.
  
4. **Administrative Controls**
   - **Add Time Credits**: Allows adding session time to active or recent players.
   - **Enable/Disable Game Room**: Toggles the operational state of each game room.
  
5. **Alerts System**
   - Displays errors or system messages from the Game Facility App (GFA) or connected game rooms.

6. **Background Session Monitoringr**
   - Periodically refreshes the player list and monitors session durations.

   - Future updates may include player notifications or alerts.
  
7. **Job Queue**
   - Ensures reliable sequential API request processing between the CSA and GRA.

   - Automatically retries failed requests when network connectivity is restored.
  
8. **Waiting Game Sessions**
   - Manages overflow when a game room is occupied.

   - Blocks door scans until the room becomes available, after which pending players can proceed.
