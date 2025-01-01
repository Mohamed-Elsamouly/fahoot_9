const express = require('express');
const app = express();
const { v4: uuidv4 } = require('uuid'); // For generating unique session IDs

// Serve static files from the 'public' directory
app.use(express.static('public'));

// Start the Express server
const expressServer = app.listen(process.env.PORT || 4000, () => {
    console.log(`Server is running on port ${process.env.PORT || 4000}`);
});

// Import and initialize Socket.IO with the Express server
const socketio = require('socket.io');
const io = socketio(expressServer);

let sessions = []; // Stores all active game sessions
let sessionLock = false; // Lock to handle concurrent player joins

// Socket.IO logic
io.on('connection', (socket) => {
    // Listen for "find" event (player name submission)
    socket.on("find", (e) => {
        // Wait until the lock is released
        const waitForLock = async () => {
            while (sessionLock) {
                await new Promise(resolve => setTimeout(resolve, 10)); // Wait 10ms
            }
            sessionLock = true; // Acquire the lock
        };

        waitForLock().then(() => {
            // Check if the player is already in a session
            const existingSession = sessions.find(session => session.players.some(player => player.socketId === socket.id));

            if (existingSession) {
                console.log(`Player ${e.name} is already in a session.`);
                sessionLock = false; // Release the lock
                return;
            }

            // Find a session with less than 4 players
            let session = sessions.find(s => s.players.length < 4);

            // If no session with available slots exists, create a new one
            if (!session) {
                session = { id: uuidv4(), players: [], playersScore: [], disconnectedPlayersCount: 0 };
                sessions.push(session);
                console.log(`New session created: ${session.id}`);
            }

            // Add the player to the session
            session.players.push({ name: e.name, socketId: socket.id });
            console.log(`Player ${e.name} added to session ${session.id}. Total players: ${session.players.length}`);

            // If the session has exactly 4 players, start the game
            if (session.players.length === 4) {
                io.emit("find", { connected: true, sessionId: session.id });
                console.log("Game started for session:", session.id);
                console.log("Players in session:", session.players.map(player => player.name));
            }

            sessionLock = false; // Release the lock
        });
    });

    // Listen for "getScore" event (player score submission)
    socket.on("getScore", (e) => {
        const session = sessions.find(s => s.id === e.sessionId);

        if (session) {
            session.playersScore.push(e);

            // If all 4 players in the session have submitted their scores
            if (session.playersScore.length === 4) {
                io.emit("getScore", {
                    sessionId: e.sessionId,
                    scores: session.playersScore.map(player => ({ name: player.name, score: player.score }))
                });
                console.log("Scores sent for session:", session.playersScore);
                session.players = []; // Reset players for the session
                session.playersScore = []; // Reset scores for the session
            }
        }
    });

    // Handle player disconnection
    socket.on('disconnect', () => {
        for (let session of sessions) {
            const disconnectedPlayerIndex = session.players.findIndex(player => player.socketId === socket.id);

            if (disconnectedPlayerIndex !== -1) {
                if (session.players.length < 4) {
                    // Remove the player from the session if the number of players is less than 4
                    session.players.splice(disconnectedPlayerIndex, 1);
                    console.log(`Player disconnected before 4 players were connected. Removed from the session.`);
                } else {
                    // Set the player's score to zero if the number of players is 4 or more
                    const disconnectedPlayer = session.players[disconnectedPlayerIndex];
                    session.playersScore.push({ name: disconnectedPlayer.name, score: 0 });
                    session.disconnectedPlayersCount++;
                    console.log(`Player disconnected after 4 players were connected. Score set to zero.`);

                    // Check if all 4 players in the session have submitted their scores (either explicitly or by disconnecting)
                    if (session.playersScore.length === 4) {
                        io.emit("getScore", {
                            sessionId: session.id,
                            scores: session.playersScore.map(player => ({ name: player.name, score: player.score }))
                        });
                        console.log("Scores sent for session:", session.playersScore);
                        session.players = []; // Reset players for the session
                        session.playersScore = []; // Reset scores for the session
                    }
                }

                // Check if all 4 players in the session have disconnected
                if (session.disconnectedPlayersCount === 4) {
                    // Remove the session from the sessions array
                    sessions.splice(sessions.indexOf(session), 1);
                    console.log("All 4 players disconnected in session. Session removed.");
                }
                break; // Exit the loop once the player is found and handled
            }
        }
    });
});
