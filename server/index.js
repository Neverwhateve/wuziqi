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

// 广播等待中的房间列表给所有客户端
function broadcastWaitingRooms() {
    const waitingRoomList = [];
    rooms.forEach((room, roomId) => {
        if (room.waitingForOpponent && room.players.length === 1) {
            waitingRoomList.push(roomId);
        }
    });
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'waitingRoomsList',
                rooms: waitingRoomList
            }));
        }
    });
}

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
        undoRequest: null, // 悔棋请求状态 {requesterIndex: ...}
        // 骰子相关
        dicePhase: true, // 是否处于骰子阶段
        diceValues: [null, null], // 双方骰子点数
        diceRolled: [false, false], // 双方是否已投掷
        playerNames: [null, null] // 玩家昵称
    };
    // 保存玩家1的昵称
    if (player1.playerName) {
        room.playerNames[0] = player1.playerName;
    }
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

function handleRestart(ws) {
    const room = rooms.get(ws.roomId);
    if (!room) return;
    
    // 重置游戏状态，但保留骰子状态让双方重新投掷
    room.board = Array(15).fill(null).map(() => Array(15).fill(0));
    room.currentTurn = 0;
    room.gameOver = false;
    room.winner = null;
    room.moveHistory = [];
    room.undoRequest = null;
    room.dicePhase = true; // 重新进入骰子阶段
    room.diceValues = [null, null];
    room.diceRolled = [false, false];
    
    broadcastToRoom(room, {
        type: 'restartGame'
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
    // 广播等待房间列表
    broadcastWaitingRooms();
}

wss.on('connection', (ws) => {
    console.log('New player connected');
    
    // 发送等待房间列表给新连接的客户端
    const waitingRoomList = [];
    rooms.forEach((room, roomId) => {
        if (room.waitingForOpponent && room.players.length === 1) {
            waitingRoomList.push(roomId);
        }
    });
    ws.send(JSON.stringify({
        type: 'waitingRoomsList',
        rooms: waitingRoomList
    }));

    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (e) {
            return;
        }

        switch (data.type) {
            case 'ping':
                // 响应心跳
                ws.send(JSON.stringify({ type: 'pong' }))
                break
            case 'findMatch':
                if (waitingPlayer && waitingPlayer !== ws && waitingPlayer.readyState === WebSocket.OPEN) {
                    const room = createRoom(waitingPlayer, ws);
                    // 保存玩家昵称
                    if (data.playerName) {
                        room.playerNames[1] = data.playerName;
                    }
                    waitingPlayer.send(JSON.stringify({ 
                        type: 'matched', 
                        roomId: room.id, 
                        player: 1, 
                        dicePhase: true,
                        opponentName: data.playerName || '对手'
                    }));
                    ws.send(JSON.stringify({ 
                        type: 'matched', 
                        roomId: room.id, 
                        player: 2, 
                        dicePhase: true,
                        opponentName: room.playerNames[0] || '对手'
                    }));
                    waitingPlayer = null;
                } else {
                    waitingPlayer = ws;
                    // 保存等待玩家的昵称
                    if (data.playerName) {
                        ws.playerName = data.playerName;
                    }
                    ws.send(JSON.stringify({ type: 'waiting' }));
                    // 广播等待房间列表
                    broadcastWaitingRooms();
                }
                break;

            case 'createRoom':
                const crRoomId = generateRoomId();
                const newRoom = {
                    id: crRoomId,
                    players: [ws],
                    currentTurn: 0,
                    board: Array(15).fill(null).map(() => Array(15).fill(0)),
                    gameOver: false,
                    winner: null,
                    waitingForOpponent: true,
                    moveHistory: [],
                    undoRequest: null,
                    dicePhase: true,
                    diceValues: [null, null],
                    diceRolled: [false, false],
                    playerNames: [null, null]
                };
                // 保存创建房间的玩家昵称
                if (data.playerName) {
                    newRoom.playerNames[0] = data.playerName;
                }
                rooms.set(crRoomId, newRoom);
                ws.roomId = crRoomId;
                ws.playerIndex = 0;
                ws.send(JSON.stringify({ type: 'roomCreated', roomId: crRoomId }));
                // 广播等待房间列表
                broadcastWaitingRooms();
                break;

            case 'joinRoom':
                const joinRoomData = rooms.get(data.roomId);
                if (joinRoomData && joinRoomData.waitingForOpponent && joinRoomData.players.length === 1) {
                    joinRoomData.players.push(ws);
                    joinRoomData.waitingForOpponent = false;
                    ws.roomId = data.roomId;
                    ws.playerIndex = 1;
                    
                    // 设置昵称
                    if (data.playerName) {
                        joinRoomData.playerNames[1] = data.playerName;
                    }

                    // 双方都发送对手加入的消息，进入骰子阶段
                    joinRoomData.players[0].send(JSON.stringify({ 
                        type: 'opponentJoined', 
                        player: 1, 
                        roomId: data.roomId,
                        dicePhase: true,
                        opponentName: data.playerName || '对手'
                    }));
                    ws.send(JSON.stringify({ 
                        type: 'opponentJoined', 
                        player: 2, 
                        roomId: data.roomId,
                        dicePhase: true,
                        opponentName: joinRoomData.playerNames[0] || '对手'
                    }));
                    // 广播等待房间列表
                    broadcastWaitingRooms();
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: 'Room not found or already full' }));
                }
                break;
                
            case 'setPlayerName':
                const nameRoom = rooms.get(ws.roomId);
                if (nameRoom && ws.playerIndex !== undefined) {
                    nameRoom.playerNames[ws.playerIndex] = data.playerName;
                    // 广播昵称给对手
                    const opponent = nameRoom.players.find(p => p !== ws);
                    if (opponent && opponent.readyState === WebSocket.OPEN) {
                        opponent.send(JSON.stringify({
                            type: 'opponentNameChanged',
                            opponentName: data.playerName
                        }));
                    }
                }
                break;
                
            case 'rollDice':
                const diceRoom = rooms.get(ws.roomId);
                if (!diceRoom || !diceRoom.dicePhase) return;
                if (diceRoom.diceRolled[ws.playerIndex]) return; // 已投掷过
                
                // 生成1-6的随机点数
                const diceValue = Math.floor(Math.random() * 6) + 1;
                diceRoom.diceValues[ws.playerIndex] = diceValue;
                diceRoom.diceRolled[ws.playerIndex] = true;
                
                // 广播骰子结果给双方
                broadcastToRoom(diceRoom, {
                    type: 'diceRolled',
                    player: ws.playerIndex + 1,
                    value: diceValue,
                    diceValues: diceRoom.diceValues,
                    diceRolled: diceRoom.diceRolled
                });
                
                // 检查双方是否都投掷了
                if (diceRoom.diceRolled[0] && diceRoom.diceRolled[1]) {
                    // 决定先手
                    const player1Dice = diceRoom.diceValues[0];
                    const player2Dice = diceRoom.diceValues[1];
                    
                    let firstPlayer;
                    if (player1Dice > player2Dice) {
                        firstPlayer = 0; // 玩家1先手
                    } else if (player2Dice > player1Dice) {
                        firstPlayer = 1; // 玩家2先手
                    } else {
                        // 平局，重新投掷
                        diceRoom.diceValues = [null, null];
                        diceRoom.diceRolled = [false, false];
                        
                        setTimeout(() => {
                            broadcastToRoom(diceRoom, {
                                type: 'diceTie',
                                message: `点数相同(${player1Dice} vs ${player2Dice})，重新投掷！`
                            });
                        }, 100);
                        return;
                    }
                    
                    // 进入游戏阶段
                    diceRoom.dicePhase = false;
                    diceRoom.currentTurn = firstPlayer;
                    
                    setTimeout(() => {
                        broadcastToRoom(diceRoom, {
                            type: 'diceComplete',
                            firstPlayer: firstPlayer + 1,
                            diceValues: diceRoom.diceValues,
                            playerNames: diceRoom.playerNames
                        });
                    }, 100);
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

            case 'restart':
                handleRestart(ws);
                break;

            case 'cancelMatch':
                if (waitingPlayer === ws) {
                    waitingPlayer = null;
                }
                // 广播等待房间列表
                broadcastWaitingRooms();
                break;

            case 'leaveRoom':
                if (ws.roomId) {
                    handleDisconnect(ws);
                }
                // 广播等待房间列表
                broadcastWaitingRooms();
                break;
                
            case 'chatMessage':
                const chatRoom = rooms.get(ws.roomId);
                if (chatRoom && data.content) {
                    const senderName = chatRoom.playerNames[ws.playerIndex] || `玩家${ws.playerIndex + 1}`;
                    // 广播聊天消息给房间内的所有玩家
                    broadcastToRoom(chatRoom, {
                        type: 'chatMessage',
                        messageType: data.messageType || 'text',
                        content: data.content,
                        from: senderName,
                        senderIndex: ws.playerIndex
                    });
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