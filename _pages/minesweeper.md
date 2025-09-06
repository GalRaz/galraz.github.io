---
layout: single
title: "Minesweeper"
permalink: /minesweeper/
author_profile: true
---

<div id="minesweeper-container">
  <div id="game-controls">
    <div id="game-info">
      <span id="mine-count">💣 10</span>
      <button id="reset-btn">🙂</button>
      <span id="timer">⏰ 000</span>
    </div>
    <div id="difficulty-controls">
      <button onclick="setDifficulty('easy')" class="diff-btn active">Easy (9x9)</button>
      <button onclick="setDifficulty('medium')" class="diff-btn">Medium (16x16)</button>
      <button onclick="setDifficulty('hard')" class="diff-btn">Hard (16x30)</button>
    </div>
  </div>
  <div id="game-board"></div>
</div>

<style>
#minesweeper-container {
  max-width: 800px;
  margin: 20px auto;
  text-align: center;
  font-family: 'Courier New', monospace;
}

#game-controls {
  margin-bottom: 20px;
  padding: 15px;
  background: #f5f5f5;
  border-radius: 8px;
}

#game-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  max-width: 300px;
  margin: 0 auto 15px auto;
  padding: 10px;
  background: #333;
  color: #fff;
  border-radius: 5px;
  font-weight: bold;
}

#reset-btn {
  background: none;
  border: 2px solid #fff;
  color: #fff;
  font-size: 20px;
  padding: 5px 10px;
  border-radius: 5px;
  cursor: pointer;
}

#reset-btn:hover {
  background: #fff;
  color: #333;
}

#difficulty-controls {
  margin-top: 10px;
}

.diff-btn {
  margin: 0 5px;
  padding: 8px 15px;
  background: #ddd;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.2s;
}

.diff-btn:hover {
  background: #ccc;
}

.diff-btn.active {
  background: #4CAF50;
  color: white;
}

#game-board {
  display: inline-block;
  border: 3px solid #999;
  background: #999;
  padding: 3px;
}

.cell {
  display: inline-block;
  width: 25px;
  height: 25px;
  border: 2px outset #ccc;
  background: #ccc;
  text-align: center;
  line-height: 21px;
  font-weight: bold;
  font-size: 14px;
  cursor: pointer;
  user-select: none;
  vertical-align: top;
}

.cell:hover {
  background: #ddd;
}

.cell.revealed {
  border: 1px solid #999;
  background: #fff;
}

.cell.mine {
  background: #ff4444;
}

.cell.flagged {
  background: #ffeb3b;
}

.cell.flagged::before {
  content: '🚩';
}

.cell.mine.revealed::before {
  content: '💣';
}

.number-1 { color: #0000ff; }
.number-2 { color: #008000; }
.number-3 { color: #ff0000; }
.number-4 { color: #000080; }
.number-5 { color: #800000; }
.number-6 { color: #008080; }
.number-7 { color: #000000; }
.number-8 { color: #808080; }
</style>

<script>
class Minesweeper {
  constructor() {
    this.difficulties = {
      easy: { rows: 9, cols: 9, mines: 10 },
      medium: { rows: 16, cols: 16, mines: 40 },
      hard: { rows: 16, cols: 30, mines: 99 }
    };
    this.currentDiff = 'easy';
    this.board = [];
    this.gameState = 'ready'; // ready, playing, won, lost
    this.mineCount = 0;
    this.flagCount = 0;
    this.revealedCount = 0;
    this.timer = 0;
    this.timerInterval = null;
    
    this.gameBoard = document.getElementById('game-board');
    this.mineCountDisplay = document.getElementById('mine-count');
    this.timerDisplay = document.getElementById('timer');
    this.resetBtn = document.getElementById('reset-btn');
    
    this.resetBtn.onclick = () => this.resetGame();
    
    this.initGame();
  }
  
  setDifficulty(diff) {
    this.currentDiff = diff;
    document.querySelectorAll('.diff-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    this.resetGame();
  }
  
  initGame() {
    const config = this.difficulties[this.currentDiff];
    this.rows = config.rows;
    this.cols = config.cols;
    this.mineCount = config.mines;
    this.flagCount = 0;
    this.revealedCount = 0;
    this.timer = 0;
    this.gameState = 'ready';
    
    this.updateDisplay();
    this.createBoard();
    this.renderBoard();
  }
  
  createBoard() {
    this.board = [];
    for (let r = 0; r < this.rows; r++) {
      this.board[r] = [];
      for (let c = 0; c < this.cols; c++) {
        this.board[r][c] = {
          isMine: false,
          isRevealed: false,
          isFlagged: false,
          neighborMines: 0
        };
      }
    }
  }
  
  placeMines(firstClickRow, firstClickCol) {
    let minesPlaced = 0;
    while (minesPlaced < this.mineCount) {
      const r = Math.floor(Math.random() * this.rows);
      const c = Math.floor(Math.random() * this.cols);
      
      if (!this.board[r][c].isMine && !(r === firstClickRow && c === firstClickCol)) {
        this.board[r][c].isMine = true;
        minesPlaced++;
      }
    }
    
    this.calculateNeighborMines();
  }
  
  calculateNeighborMines() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (!this.board[r][c].isMine) {
          let count = 0;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const nr = r + dr;
              const nc = c + dc;
              if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) {
                if (this.board[nr][nc].isMine) count++;
              }
            }
          }
          this.board[r][c].neighborMines = count;
        }
      }
    }
  }
  
  renderBoard() {
    this.gameBoard.innerHTML = '';
    this.gameBoard.style.width = `${this.cols * 29}px`;
    
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.row = r;
        cell.dataset.col = c;
        
        cell.onclick = (e) => this.handleCellClick(e, r, c);
        cell.oncontextmenu = (e) => {
          e.preventDefault();
          this.handleRightClick(r, c);
        };
        
        this.updateCellDisplay(cell, r, c);
        this.gameBoard.appendChild(cell);
      }
      this.gameBoard.appendChild(document.createElement('br'));
    }
  }
  
  updateCellDisplay(cellElement, r, c) {
    const cell = this.board[r][c];
    cellElement.className = 'cell';
    cellElement.textContent = '';
    
    if (cell.isFlagged) {
      cellElement.classList.add('flagged');
    } else if (cell.isRevealed) {
      cellElement.classList.add('revealed');
      if (cell.isMine) {
        cellElement.classList.add('mine');
      } else if (cell.neighborMines > 0) {
        cellElement.textContent = cell.neighborMines;
        cellElement.classList.add(`number-${cell.neighborMines}`);
      }
    }
  }
  
  handleCellClick(e, r, c) {
    if (this.gameState === 'won' || this.gameState === 'lost') return;
    if (this.board[r][c].isFlagged || this.board[r][c].isRevealed) return;
    
    if (this.gameState === 'ready') {
      this.gameState = 'playing';
      this.placeMines(r, c);
      this.startTimer();
    }
    
    this.revealCell(r, c);
    this.checkGameEnd();
    this.renderBoard();
  }
  
  handleRightClick(r, c) {
    if (this.gameState === 'won' || this.gameState === 'lost') return;
    if (this.board[r][c].isRevealed) return;
    
    this.board[r][c].isFlagged = !this.board[r][c].isFlagged;
    this.flagCount += this.board[r][c].isFlagged ? 1 : -1;
    this.updateDisplay();
    this.renderBoard();
  }
  
  revealCell(r, c) {
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return;
    if (this.board[r][c].isRevealed || this.board[r][c].isFlagged) return;
    
    this.board[r][c].isRevealed = true;
    this.revealedCount++;
    
    if (this.board[r][c].isMine) {
      this.gameState = 'lost';
      this.revealAllMines();
      return;
    }
    
    if (this.board[r][c].neighborMines === 0) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          this.revealCell(r + dr, c + dc);
        }
      }
    }
  }
  
  revealAllMines() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.board[r][c].isMine) {
          this.board[r][c].isRevealed = true;
        }
      }
    }
  }
  
  checkGameEnd() {
    if (this.gameState === 'lost') {
      this.stopTimer();
      this.resetBtn.textContent = '😵';
      return;
    }
    
    const totalCells = this.rows * this.cols;
    if (this.revealedCount === totalCells - this.mineCount) {
      this.gameState = 'won';
      this.stopTimer();
      this.resetBtn.textContent = '😎';
    }
  }
  
  startTimer() {
    this.timerInterval = setInterval(() => {
      this.timer++;
      this.updateDisplay();
    }, 1000);
  }
  
  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }
  
  updateDisplay() {
    this.mineCountDisplay.textContent = `💣 ${this.mineCount - this.flagCount}`;
    this.timerDisplay.textContent = `⏰ ${this.timer.toString().padStart(3, '0')}`;
  }
  
  resetGame() {
    this.stopTimer();
    this.resetBtn.textContent = '🙂';
    this.initGame();
  }
}

// Global function for difficulty buttons
function setDifficulty(diff) {
  if (window.minesweeper) {
    window.minesweeper.setDifficulty(diff);
  }
}

// Initialize game when page loads
document.addEventListener('DOMContentLoaded', function() {
  window.minesweeper = new Minesweeper();
});
</script>

<div style="margin-top: 20px; padding: 15px; background: #f9f9f9; border-radius: 5px;">
  <h3>How to Play</h3>
  <ul style="text-align: left; max-width: 500px; margin: 0 auto;">
    <li><strong>Left click</strong> to reveal a cell</li>
    <li><strong>Right click</strong> to flag/unflag a cell</li>
    <li>Numbers show how many mines are adjacent to that cell</li>
    <li>Flag all mines to win!</li>
    <li>Choose your difficulty level above the game board</li>
  </ul>
</div>
