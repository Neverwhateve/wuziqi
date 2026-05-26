import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'

const BOARD_SIZE = 15
const CELL_SIZE = 32
const PIECE_RADIUS = 14

const WS_URL = window.location.protocol === 'https:' 
  ? `wss://${window.location.host}` 
  : `ws://${window.location.hostname}:8080`

function App() {
  const [gameState, setGameState] = useState('menu')
  const [ws, setWs] = useState(null)
  const [board, setBoard] = useState(Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(0)))
  const [currentTurn, setCurrentTurn] = useState(0)
  const [player, setPlayer] = useState(null)
  const [roomId, setRoomId] = useState(null)
  const [winner, setWinner] = useState(null)
  const [error, setError] = useState(null)
  const [roomInput, setRoomInput] = useState('')
  const [undoRequest, setUndoRequest] = useState(null) // 悔棋请求状态
  const [showUndoNotification, setShowUndoNotification] = useState(null) // 显示悔棋通知
  const [lastMove, setLastMove] = useState(null) // 最后一颗落子位置
  const [hideGameOverOverlay, setHideGameOverOverlay] = useState(false) // 是否隐藏游戏结束弹窗
  const [waitingRooms, setWaitingRooms] = useState([]) // 等待中的房间列表
  const [playerName, setPlayerName] = useState('') // 玩家昵称
  const [opponentName, setOpponentName] = useState('对手') // 对手昵称
  const [dicePhase, setDicePhase] = useState(false) // 是否处于骰子阶段
  const [diceRolled, setDiceRolled] = useState(false) // 是否已投掷骰子
  const [diceValues, setDiceValues] = useState([null, null]) // 骰子点数
  const [chatMessages, setChatMessages] = useState([]) // 聊天消息
  const wsRef = useRef(null)

  const connect = useCallback(() => {
    const websocket = new WebSocket(WS_URL)
    wsRef.current = websocket
    setWs(websocket)

    websocket.onopen = () => {
      setError(null)
    }

    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data)
      handleMessage(data)
    }

    websocket.onerror = () => {
      setError('Connection error')
    }

    websocket.onclose = () => {
      if (gameState === 'playing') {
        setError('Disconnected from server')
        setGameState('menu')
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [])

  const handleMessage = (data) => {
    switch (data.type) {
      case 'waiting':
        setGameState('matching')
        break
      case 'matched':
        setPlayer(data.player)
        setRoomId(data.roomId)
        setGameState('playing')
        setBoard(Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(0)))
        setCurrentTurn(0)
        setWinner(null)
        setUndoRequest(null)
        setDicePhase(data.dicePhase || false)
        setDiceRolled(false)
        setDiceValues([null, null])
        setChatMessages([])
        break
      case 'roomCreated':
        setRoomId(data.roomId)
        setGameState('waitingRoom')
        break
      case 'opponentJoined':
        setPlayer(data.player)
        setRoomId(data.roomId)
        setGameState('playing')
        setBoard(Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(0)))
        setCurrentTurn(0)
        setWinner(null)
        setUndoRequest(null)
        setDicePhase(data.dicePhase || false)
        setDiceRolled(false)
        setDiceValues([null, null])
        setChatMessages([])
        if (data.opponentName) {
          setOpponentName(data.opponentName)
        }
        break
      case 'opponentNameChanged':
        setOpponentName(data.opponentName)
        break
      case 'diceRolled':
        setDiceValues(data.diceValues)
        // 只有当是自己投掷骰子时才更新本地状态
        if (data.player === player) {
          setDiceRolled(true)
        }
        break
      case 'diceTie':
        setDiceRolled(false)
        setDiceValues([null, null])
        setShowUndoNotification(data.message)
        setTimeout(() => setShowUndoNotification(null), 3000)
        break
      case 'diceComplete':
        setDicePhase(false)
        setCurrentTurn(data.firstPlayer - 1)
        break
      case 'init':
        setCurrentTurn(data.currentTurn)
        break
      case 'move':
        setBoard(prev => {
          const newBoard = prev.map(row => [...row])
          newBoard[data.row][data.col] = data.player
          return newBoard
        })
        setCurrentTurn(data.currentTurn)
        setLastMove({ row: data.row, col: data.col })
        break
      case 'gameOver':
        setWinner(data.winner)
        setGameState('gameOver')
        setUndoRequest(null)
        break
      case 'restartGame':
        setBoard(Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(0)))
        setCurrentTurn(0)
        setWinner(null)
        setGameState('playing')
        setUndoRequest(null)
        setDicePhase(true) // 重新进入骰子阶段
        setDiceRolled(false)
        setDiceValues([null, null])
        setChatMessages([])
        break
      case 'opponentLeft':
        setError('Opponent left the game')
        setGameState('menu')
        setUndoRequest(null)
        break
      case 'error':
        setError(data.message)
        break
      case 'undoRequested':
        setUndoRequest({ requester: data.requester })
        break
      case 'undoAccepted':
        setBoard(data.board)
        setCurrentTurn(data.currentTurn)
        setWinner(null)
        setUndoRequest(null)
        setShowUndoNotification('悔棋成功！')
        setTimeout(() => setShowUndoNotification(null), 2000)
        break
      case 'undoRejected':
        setUndoRequest(null)
        setShowUndoNotification('对方拒绝了悔棋请求')
        setTimeout(() => setShowUndoNotification(null), 2000)
        break
      case 'waitingRoomsList':
        setWaitingRooms(data.rooms || [])
        break
      case 'chatMessage':
        setChatMessages(prev => [...prev, {
          type: data.messageType, // 'text' 或 'emoji'
          content: data.content,
          from: data.from,
          timestamp: Date.now()
        }])
        break
    }
  }

  const findMatch = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'findMatch' }))
    } else {
      connect()
      setTimeout(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'findMatch' }))
        }
      }, 500)
    }
  }

  const cancelMatch = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'cancelMatch' }))
    }
    setGameState('menu')
  }

  const createRoom = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'createRoom' }))
    } else {
      connect()
      setTimeout(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'createRoom' }))
        }
      }, 500)
    }
  }

  const joinRoom = () => {
    if (roomInput && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'joinRoom', roomId: roomInput, playerName: playerName }))
    } else {
      connect()
      setTimeout(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'joinRoom', roomId: roomInput, playerName: playerName }))
        }
      }, 500)
    }
  }
  
  const rollDice = () => {
    if (!dicePhase || diceRolled) return
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'rollDice' }))
    }
  }
  
  const sendChatMessage = (messageType, content) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'chatMessage',
        messageType,
        content
      }))
      // 本地显示自己的消息
      setChatMessages(prev => [...prev, {
        type: messageType,
        content,
        from: 'me',
        timestamp: Date.now()
      }])
    }
  }
  
  const submitPlayerName = () => {
    if (playerName.trim() && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'setPlayerName',
        playerName: playerName.trim()
      }))
    }
  }

  const refreshRooms = () => {
    // 刷新房间列表，向服务器请求最新的等待房间
    if (ws && ws.readyState === WebSocket.OPEN) {
      // 服务器会在新连接时自动发送等待房间列表
      // 这里我们主动断开并重连来刷新列表
      ws.close()
    }
    connect()
  }

  const joinWaitingRoom = (roomId) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'joinRoom', roomId: roomId, playerName: playerName }))
    } else {
      connect()
      setTimeout(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'joinRoom', roomId: roomId, playerName: playerName }))
        }
      }, 500)
    }
  }

  const handleIntersectionClick = (row, col) => {
    if (gameState !== 'playing' || winner) return
    if (board[row][col] !== 0) return
    if (undoRequest) return // 有悔棋请求时不能落子
    
    // 简单直接的判断：黑方是1，白方是2，currentTurn从0开始
    // 如果是黑方(player=1)，轮到0时可以下
    // 如果是白方(player=2)，轮到1时可以下
    if (currentTurn + 1 !== player) return

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'move', row, col }))
    }
  }

  const requestUndo = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN || undoRequest) return
    ws.send(JSON.stringify({ type: 'requestUndo' }))
    setShowUndoNotification('已发送悔棋请求，等待对方同意...')
    setTimeout(() => {
      if (showUndoNotification && showUndoNotification.includes('等待')) {
        setShowUndoNotification(null)
      }
    }, 3000)
  }

  const acceptUndo = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'acceptUndo' }))
  }

  const rejectUndo = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'rejectUndo' }))
  }

  const restartGame = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'restart' }))
  }

  const backToMenu = () => {
    if (ws) {
      ws.send(JSON.stringify({ type: 'leaveRoom' }))
    }
    setGameState('menu')
    setRoomId(null)
    setPlayer(null)
    setWinner(null)
    setError(null)
    setBoard(Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(0)))
  }

  const boardWidth = (BOARD_SIZE - 1) * CELL_SIZE
  const boardHeight = (BOARD_SIZE - 1) * CELL_SIZE

  return (
    <div className="app">
      <div className="container">
        <h1 className="title">五子棋</h1>

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        {gameState === 'menu' && (
          <div className="menu">
            <div className="name-input-container">
              <input
                type="text"
                placeholder="输入昵称"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value.slice(0, 10))}
                maxLength={10}
                className="name-input"
              />
              <button className="btn btn-small" onClick={submitPlayerName} disabled={!playerName.trim()}>
                ✓
              </button>
            </div>
            <button className="btn btn-primary" onClick={findMatch}>
              快速匹配
            </button>
            <div className="divider">
              <span>或</span>
            </div>
            <button className="btn btn-secondary" onClick={createRoom}>
              创建房间
            </button>
            <div className="room-join">
              <input
                type="text"
                placeholder=""
                value={roomInput}
                onChange={(e) => setRoomInput(e.target.value.replace(/\D/g, '').slice(0, 2))}
                maxLength={2}
              />
              <button className="btn btn-small" onClick={joinRoom}>
                加入
              </button>
              <button className="btn btn-small" onClick={refreshRooms} title="刷新房间列表">
                🔄
              </button>
            </div>
            {waitingRooms.length > 0 && (
              <div className="waiting-rooms-list">
                <h3>等待中的房间</h3>
                <div className="waiting-rooms">
                  {waitingRooms.map((room) => (
                    <button
                      key={room}
                      className="btn btn-small waiting-room-btn"
                      onClick={() => joinWaitingRoom(room)}
                    >
                      房间 {room}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {gameState === 'matching' && (
          <div className="matching">
            <div className="spinner"></div>
            <p>匹配中...</p>
            <button className="btn btn-secondary" onClick={cancelMatch}>
              取消
            </button>
          </div>
        )}

        {gameState === 'waitingRoom' && (
          <div className="waiting-room">
            <div className="room-id-display">
              <div className="room-id-label">房间号</div>
              <div className="room-id">{roomId}</div>
            </div>
            <p className="waiting-text">等待对手加入...</p>
            <button className="btn btn-secondary" onClick={backToMenu}>
              返回
            </button>
          </div>
        )}

        {(gameState === 'playing' || gameState === 'gameOver') && (
          <div className="game">
            <div className="game-info">
              <div className={`player-info ${player === 1 ? 'active' : ''}`}>
                <div className="piece black"></div>
                <span>黑方 {player === 1 ? playerName || '(你)' : opponentName}</span>
              </div>
              <div className="vs">VS</div>
              <div className={`player-info ${player === 2 ? 'active' : ''}`}>
                <div className="piece white"></div>
                <span>白方 {player === 2 ? playerName || '(你)' : opponentName}</span>
              </div>
            </div>

            <div className="turn-indicator">
              {winner ? (
                winner === player ? '🎉 你赢了!' : '😢 你输了!'
              ) : dicePhase ? (
                '投掷骰子决定先手'
              ) : (
                currentTurn + 1 === player ? '轮到你了' : '等待对手'
              )}
            </div>
            
            {dicePhase && !winner && (
              <div className="dice-phase">
                <div className="dice-container">
                  <div className="dice-info">
                    <div className={`dice ${diceValues[0] !== null ? 'rolled' : ''}`}>
                      {diceValues[0] !== null ? diceValues[0] : '?'}
                    </div>
                    <span>你的点数</span>
                  </div>
                  <div className="dice-info">
                    <div className={`dice ${diceValues[1] !== null ? 'rolled' : ''}`}>
                      {diceValues[1] !== null ? diceValues[1] : '?'}
                    </div>
                    <span>对手点数</span>
                  </div>
                </div>
                <button 
                  className="btn btn-primary roll-dice-btn" 
                  onClick={rollDice}
                  disabled={diceRolled}
                >
                  {diceRolled ? '等待对手...' : '投掷骰子 🎲'}
                </button>
              </div>
            )}

            {!dicePhase && gameState === 'playing' && !winner && (
              <div className="chat-container">
                <div className="chat-messages">
                  {chatMessages.map((msg, idx) => (
                    <div key={idx} className={`chat-message ${msg.from === 'me' ? 'mine' : 'theirs'}`}>
                      {msg.type === 'emoji' ? (
                        <span className="emoji-message">{msg.content}</span>
                      ) : (
                        <span className="text-message">{msg.content}</span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="chat-input-container">
                  <input
                    type="text"
                    placeholder="发送消息..."
                    className="chat-input"
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && e.target.value.trim()) {
                        sendChatMessage('text', e.target.value.trim())
                        e.target.value = ''
                      }
                    }}
                  />
                  <div className="emoji-buttons">
                    {['👍', '🎉', '😅', '🤔', '👋', '😊'].map(emoji => (
                      <button
                        key={emoji}
                        className="emoji-btn"
                        onClick={() => sendChatMessage('emoji', emoji)}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="board-container">
              <div 
                className="board"
                style={{
                  width: `${boardWidth}px`,
                  height: `${boardHeight}px`
                }}
              >
                {Array.from({ length: BOARD_SIZE }).map((_, i) => (
                  <div
                    key={`h-line-${i}`}
                    className="grid-line horizontal"
                    style={{
                      top: `${i * CELL_SIZE}px`,
                      left: '0px',
                      width: `${boardWidth}px`
                    }}
                  ></div>
                ))}
                {Array.from({ length: BOARD_SIZE }).map((_, i) => (
                  <div
                    key={`v-line-${i}`}
                    className="grid-line vertical"
                    style={{
                      left: `${i * CELL_SIZE}px`,
                      top: '0px',
                      height: `${boardHeight}px`
                    }}
                  ></div>
                ))}
                
                {board.map((row, rowIndex) => (
                  row.map((cell, colIndex) => {
                    const isLastMove = lastMove && lastMove.row === rowIndex && lastMove.col === colIndex
                    return (
                      <div
                        key={`${rowIndex}-${colIndex}`}
                        className="intersection"
                        style={{
                          left: `${colIndex * CELL_SIZE}px`,
                          top: `${rowIndex * CELL_SIZE}px`
                        }}
                        onClick={() => handleIntersectionClick(rowIndex, colIndex)}
                      >
                        {cell !== 0 && (
                          <div className={`piece ${cell === 1 ? 'black' : 'white'} ${isLastMove ? 'last-move' : ''}`}>
                            {isLastMove && (
                              <div className="last-move-marker"></div>
                            )}
                          </div>
                        )}
                        {cell === 0 && (
                          <div className="hover-indicator"></div>
                        )}
                      </div>
                    )
                  })
                ))}
                {[[3,3], [3,11], [7,7], [11,3], [11,11]].map(([row, col]) => (
                  <div
                    key={`star-${row}-${col}`}
                    className="star-point"
                    style={{
                      left: `${col * CELL_SIZE}px`,
                      top: `${row * CELL_SIZE}px`
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="room-info">
              房间号: {roomId}
            </div>

            {gameState === 'playing' && !winner && (
              <div className="undo-button-container">
                <button 
                  className="btn btn-secondary btn-small" 
                  onClick={requestUndo}
                  disabled={undoRequest !== null}
                >
                  悔棋
                </button>
              </div>
            )}

            {showUndoNotification && (
              <div className="undo-notification">
                {showUndoNotification}
              </div>
            )}

            {undoRequest && undoRequest.requester !== player && (
              <div className="undo-request-overlay">
                <div className="undo-request-dialog">
                  <div className="undo-request-title">
                    对方请求悔棋
                  </div>
                  <div className="undo-request-buttons">
                    <button className="btn btn-primary" onClick={acceptUndo}>
                      同意
                    </button>
                    <button className="btn btn-secondary" onClick={rejectUndo}>
                      拒绝
                    </button>
                  </div>
                </div>
              </div>
            )}

            {winner && !hideGameOverOverlay && (
              <div className="game-over-overlay">
                <div className="game-over-dialog">
                  <div className="game-over-title">
                    {winner === player ? '🎉 你赢了！' : '😢 你输了！'}
                  </div>
                  <div className="game-over-subtitle">
                    {winner === player ? '恭喜你获得胜利！' : '再接再厉，下次一定！'}
                  </div>
                  <div className="game-over-buttons">
                    <button className="btn btn-primary" onClick={restartGame}>
                      再来一局
                    </button>
                    <button className="btn btn-secondary" onClick={backToMenu}>
                      返回主菜单
                    </button>
                    <button className="btn btn-secondary btn-small" onClick={() => setHideGameOverOverlay(true)}>
                      查看棋盘
                    </button>
                  </div>
                </div>
              </div>
            )}
            {winner && hideGameOverOverlay && (
              <button 
                className="btn btn-secondary btn-small view-board-button" 
                onClick={() => setHideGameOverOverlay(false)}
              >
                返回结果
              </button>
            )}

            {!winner && (
              <button className="btn btn-secondary" onClick={backToMenu}>
                退出房间
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default App