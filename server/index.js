const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(__dirname, 'public', filePath);

    const extname = path.extname(filePath);
    const contentTypes = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon'
    };
    const contentType = contentTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('Not found');
            } else {
                res.writeHead(500);
                res.end('Server error');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

const wss = new WebSocket.Server({ server });

const rooms = new Map();
let waitingPlayer = null;

function generateRoomId() {
    let roomId;
    do {
        roomId = String(Math.floor(Math.random() * 90) + 10);
    } while (rooms.has(roomId));
    return roomId;
}

function createRoom(player1, player2) {
    const roomId = generateRoomId();
    const room = {
        id: roomId,
        players: [player1, player2],
        currentTurn: 0,
        board: Array(15).fill(null).map(() => Array(15).fill(0)),
        gameOver: false,
        winner: null,
        moveHistory: [], // 记录落子历史
        undoRequest: null // 悔棋请求状态 {requesterIndex: ...}
    };
    rooms.set(roomId, room);

    player1.roomId = roomId;
    player1.playerIndex = 0;
    player2.roomId = roomId;
    player2.playerIndex = 1;

    return room;
}

function broadcastToRoom(room, message) {
    room.players.forEach(player => {
        if (player.readyState === WebSocket.OPEN) {
            player.send(JSON.stringify(message));
        }
    });
}

function checkWin(board, row, col, player) {
    const directions = [
        [1, 0],
        [0, 1],
        [1, 1],
        [1, -1]
    ];

    for (const [dx, dy] of directions) {
        let count = 1;
        let r, c;

        r = row + dx;
        c = col + dy;
        while (r >= 0 && r < 15 && c >= 0 && c < 15 && board[r][c] === player) {
            count++;
            r += dx;
            c += dy;
        }

        r = row - dx;
        c = col - dy;
        while (r >= 0 && r < 15 && c >= 0 && c < 15 && board[r][c] === player) {
            count++;
            r -= dx;
            c -= dy;
        }

        if (count >= 5) return true;
    }
    return false;
}

function handleMove(ws, data) {
    const { row, col } = data;
    const room = rooms.get(ws.roomId);

    if (!room || room.gameOver) return;
    if (room.players[room.currentTurn] !== ws) return;
    if (room.board[row][col] !== 0) return;

    const player = ws.playerIndex + 1;
    
    // 记录落子历史
    room.moveHistory.push({
        row,
        col,
        player,
        boardState: room.board.map(r => [...r]) // 保存棋盘状态快照
    });
    
    room.board[row][col] = player;
    room.currentTurn = 1 - room.currentTurn; // 更新当前回合

    const win = checkWin(room.board, row, col, player);

    broadcastToRoom(room, {
        type: 'move',
        row,
        col,
        player,
        currentTurn: room.currentTurn
    });

    if (win) {
        room.gameOver = true;
        room.winner = player;
        broadcastToRoom(room, {
            type: 'gameOver',
            winner: player
        });
    }
}

function handleRequestUndo(ws) {
    const room = rooms.get(ws.roomId);
    if (!room || room.gameOver || room.moveHistory.length === 0) return;
    if (room.undoRequest) return; // 已经有请求了
    
    const requesterIndex = ws.playerIndex;
    room.undoRequest = { requesterIndex };
    
    broadcastToRoom(room, {
        type: 'undoRequested',
        requester: requesterIndex + 1
    });
}

function handleAcceptUndo(ws) {
    const room = rooms.get(ws.roomId);
    if (!room || !room.undoRequest) return;
    if (room.undoRequest.requesterIndex === ws.playerIndex) return; // 请求者不能同意自己的请求
    
    // 执行悔棋
    const lastMove = room.moveHistory.pop();
    if (lastMove) {
        // 恢复棋盘到上一个状态
        room.board = lastMove.boardState;
        room.currentTurn = (room.currentTurn === 0) ? 1 : 0; // 回退回合
        room.gameOver = false;
        room.winner = null;
    }
    
    room.undoRequest = null;
    
    broadcastToRoom(room, {
        type: 'undoAccepted',
        board: room.board,
        currentTurn: room.currentTurn
    });
}

function handleRejectUndo(ws) {
    const room = rooms.get(ws.roomId);
    if (!room || !room.undoRequest) return;
    if (room.undoRequest.requesterIndex === ws.playerIndex) return; // 请求者不能拒绝自己的请求
    
    room.undoRequest = null;
    
    broadcastToRoom(room, {
        type: 'undoRejected'
    });
}

function handleDisconnect(ws) {
    if (ws.roomId) {
        const room = rooms.get(ws.roomId);
        if (room) {
            const opponent = room.players.find(p => p !== ws);
            if (opponent && opponent.readyState === WebSocket.OPEN) {
                opponent.send(JSON.stringify({ type: 'opponentLeft' }));
                opponent.roomId = null;
            }
            rooms.delete(ws.roomId);
        }
    }
    if (waitingPlayer === ws) {
        waitingPlayer = null;
    }
}

wss.on('connection', (ws) => {
    console.log('New player connected');

    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (e) {
            return;
        }

        switch (data.type) {
            case 'findMatch':
                if (waitingPlayer && waitingPlayer !== ws && waitingPlayer.readyState === WebSocket.OPEN) {
                    const room = createRoom(waitingPlayer, ws);
                    waitingPlayer.send(JSON.stringify({ type: 'matched', roomId: room.id, player: 1 }));
                    ws.send(JSON.stringify({ type: 'matched', roomId: room.id, player: 2 }));
                    waitingPlayer = null;
                } else {
                    waitingPlayer = ws;
                    ws.send(JSON.stringify({ type: 'waiting' }));
                }
                break;

            case 'createRoom':
                const crRoomId = generateRoomId();
                rooms.set(crRoomId, {
                    id: crRoomId,
                    players: [ws],
                    currentTurn: 0,
                    board: Array(15).fill(null).map(() => Array(15).fill(0)),
                    gameOver: false,
                    winner: null,
                    waitingForOpponent: true,
                    moveHistory: [],
                    undoRequest: null
                });
                ws.roomId = crRoomId;
                ws.playerIndex = 0;
                ws.send(JSON.stringify({ type: 'roomCreated', roomId: crRoomId }));
                break;

            case 'joinRoom':
                const joinRoom = rooms.get(data.roomId);
                if (joinRoom && joinRoom.waitingForOpponent && joinRoom.players.length === 1) {
                    joinRoom.players.push(ws);
                    joinRoom.waitingForOpponent = false;
                    ws.roomId = data.roomId;
                    ws.playerIndex = 1;

                    joinRoom.players[0].send(JSON.stringify({ type: 'opponentJoined', player: 1, roomId: data.roomId }));
                    ws.send(JSON.stringify({ type: 'opponentJoined', player: 2, roomId: data.roomId }));
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: 'Room not found or already full' }));
                }
                break;

            case 'move':
                handleMove(ws, data);
                break;

            case 'requestUndo':
                handleRequestUndo(ws);
                break;

            case 'acceptUndo':
                handleAcceptUndo(ws);
                break;

            case 'rejectUndo':
                handleRejectUndo(ws);
                break;

            case 'leaveRoom':
                if (ws.roomId) {
                    handleDisconnect(ws);
                }
                break;
        }
    });

    ws.on('close', () => {
        handleDisconnect(ws);
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});