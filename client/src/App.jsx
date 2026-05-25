import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'

const BOARD_SIZE = 15
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
        break
      case 'roomCreated':
        setRoomId(data.roomId)
        setGameState('waitingRoom')
        break
      case 'opponentJoined':
        setPlayer(data.player)
        setGameState('playing')
        setBoard(Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(0)))
        setCurrentTurn(0)
        setWinner(null)
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
        break
      case 'gameOver':
        setWinner(data.winner)
        setGameState('gameOver')
        break
      case 'opponentLeft':
        setError('Opponent left the game')
        setGameState('menu')
        break
      case 'error':
        setError(data.message)
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
      ws.send(JSON.stringify({ type: 'joinRoom', roomId: roomInput.toUpperCase() }))
    } else {
      connect()
      setTimeout(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'joinRoom', roomId: roomInput.toUpperCase() }))
        }
      }, 500)
    }
  }

  const handleCellClick = (row, col) => {
    if (gameState !== 'playing' || winner) return
    if (player !== currentTurn + 1) return
    if (board[row][col] !== 0) return

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'move', row, col }))
    }
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

  return (
    <div className="app">
      <div className="background">
        <div className="orb orb-1"></div>
        <div className="orb orb-2"></div>
        <div className="orb orb-3"></div>
      </div>

      <div className="container">
        <h1 className="title">五子棋</h1>

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        {gameState === 'menu' && (
          <div className="menu">
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
                placeholder="输入房间号"
                value={roomInput}
                onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
                maxLength={6}
              />
              <button className="btn btn-small" onClick={joinRoom}>
                加入
              </button>
            </div>
          </div>
        )}

        {gameState === 'matching' && (
          <div className="matching">
            <div className="spinner"></div>
            <p>匹配中...</p>
          </div>
        )}

        {gameState === 'waitingRoom' && (
          <div className="waiting-room">
            <div className="room-code">
              <span>房间号</span>
              <strong>{roomId}</strong>
            </div>
            <p>等待对手加入...</p>
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
                <span>黑方 {player === 1 ? '(你)' : ''}</span>
              </div>
              <div className="vs">VS</div>
              <div className={`player-info ${player === 2 ? 'active' : ''}`}>
                <div className="piece white"></div>
                <span>白方 {player === 2 ? '(你)' : ''}</span>
              </div>
            </div>

            <div className="turn-indicator">
              {winner ? (
                winner === player ? '你赢了!' : '你输了!'
              ) : (
                currentTurn + 1 === player ? '轮到你了' : '等待对手'
              )}
            </div>

            <div className="board-container">
              <div className="board">
                {board.map((row, rowIndex) => (
                  <div key={rowIndex} className="row">
                    {row.map((cell, colIndex) => (
                      <div
                        key={colIndex}
                        className="cell"
                        onClick={() => handleCellClick(rowIndex, colIndex)}
                      >
                        {cell !== 0 && (
                          <div className={`piece ${cell === 1 ? 'black' : 'white'}`}>
                            {cell === 1 && <div className="piece-inner black-inner"></div>}
                            {cell === 2 && <div className="piece-inner white-inner"></div>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div className="room-info">
              房间号: {roomId}
            </div>

            <button className="btn btn-secondary" onClick={backToMenu}>
              {winner ? '返回主菜单' : '退出房间'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default App