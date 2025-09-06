---
layout: single
title: "Sudoku"
permalink: /sudoku/
author_profile: true
---

<div id="sudoku-container">
  <div id="game-controls">
    <div id="game-info">
      <button id="new-game-btn">New Game</button>
      <button id="solve-btn">Solve</button>
      <button id="clear-btn">Clear</button>
    </div>
    <div id="difficulty-controls">
      <button onclick="setDifficulty('easy')" class="diff-btn active">Easy</button>
      <button onclick="setDifficulty('medium')" class="diff-btn">Medium</button>
      <button onclick="setDifficulty('hard')" class="diff-btn">Hard</button>
    </div>
  </div>
  <div id="sudoku-board"></div>
  <div id="game-status"></div>
</div>

<style>
#sudoku-container {
  max-width: 600px;
  margin: 20px auto;
  text-align: center;
  font-family: 'Arial', sans-serif;
}

#game-controls {
  margin-bottom: 20px;
  padding: 15px;
  background: #f5f5f5;
  border-radius: 8px;
}

#game-info {
  margin-bottom: 15px;
}

#game-info button {
  margin: 0 5px;
  padding: 10px 20px;
  background: #4CAF50;
  color: white;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.3s;
}

#game-info button:hover {
  background: #45a049;
}

#solve-btn {
  background: #2196F3 !important;
}

#solve-btn:hover {
  background: #1976D2 !important;
}

#clear-btn {
  background: #f44336 !important;
}

#clear-btn:hover {
  background: #d32f2f !important;
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
  background: #FF9800;
  color: white;
}

#sudoku-board {
  display: inline-block;
  border: 3px solid #333;
  background: #333;
  margin: 20px 0;
}

.sudoku-row {
  display: flex;
}

.sudoku-cell {
  width: 50px;
  height: 50px;
  border: 1px solid #666;
  background: white;
  text-align: center;
  font-size: 20px;
  font-weight: bold;
  line-height: 50px;
  cursor: text;
  transition: background-color 0.2s;
}

.sudoku-cell:focus {
  outline: 2px solid #4CAF50;
  background-color: #e8f5e8;
}

.sudoku-cell.given {
  background-color: #f0f0f0;
  color: #333;
  font-weight: bold;
  cursor: default;
}

.sudoku-cell.error {
  background-color: #ffebee;
  color: #d32f2f;
}

.sudoku-cell.highlight {
  background-color: #fff3e0;
}

/* 3x3 block borders */
.sudoku-cell:nth-child(3), .sudoku-cell:nth-child(6) {
  border-right: 3px solid #333;
}

.sudoku-row:nth-child(3), .sudoku-row:nth-child(6) {
  border-bottom: 3px solid #333;
}

#game-status {
  font-size: 18px;
  font-weight: bold;
  margin-top: 10px;
  min-height: 25px;
}

.success {
  color: #4CAF50;
}

.error-message {
  color: #f44336;
}
</style>

<script>
class Sudoku {
  constructor() {
    this.board = Array(9).fill().map(() => Array(9).fill(0));
    this.solution = Array(9).fill().map(() => Array(9).fill(0));
    this.given = Array(9).fill().map(() => Array(9).fill(false));
    this.difficulty = 'easy';
    this.difficulties = {
      easy: 40,   // cells to remove
      medium: 50,
      hard: 60
    };
    
    this.boardElement = document.getElementById('sudoku-board');
    this.statusElement = document.getElementById('game-status');
    
    document.getElementById('new-game-btn').onclick = () => this.newGame();
    document.getElementById('solve-btn').onclick = () => this.showSolution();
    document.getElementById('clear-btn').onclick = () => this.clearUserInput();
    
    this.createBoard();
    this.newGame();
  }
  
  setDifficulty(diff) {
    this.difficulty = diff;
    document.querySelectorAll('.diff-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    this.newGame();
  }
  
  createBoard() {
    this.boardElement.innerHTML = '';
    for (let row = 0; row < 9; row++) {
      const rowDiv = document.createElement('div');
      rowDiv.className = 'sudoku-row';
      
      for (let col = 0; col < 9; col++) {
        const cell = document.createElement('input');
        cell.type = 'text';
        cell.className = 'sudoku-cell';
        cell.maxLength = 1;
        cell.dataset.row = row;
        cell.dataset.col = col;
        
        cell.oninput = (e) => this.handleInput(e, row, col);
        cell.onfocus = () => this.highlightRelated(row, col);
        cell.onblur = () => this.clearHighlights();
        
        rowDiv.appendChild(cell);
      }
      this.boardElement.appendChild(rowDiv);
    }
  }
  
  handleInput(e, row, col) {
    const value = e.target.value;
    
    // Only allow numbers 1-9
    if (value && (!/^[1-9]$/.test(value))) {
      e.target.value = '';
      return;
    }
    
    this.board[row][col] = value ? parseInt(value) : 0;
    this.validateBoard();
    this.checkCompletion();
  }
  
  highlightRelated(row, col) {
    this.clearHighlights();
    
    // Highlight row, column, and 3x3 box
    const cells = document.querySelectorAll('.sudoku-cell');
    cells.forEach((cell, index) => {
      const cellRow = Math.floor(index / 9);
      const cellCol = index % 9;
      const boxRow = Math.floor(cellRow / 3);
      const boxCol = Math.floor(cellCol / 3);
      const targetBoxRow = Math.floor(row / 3);
      const targetBoxCol = Math.floor(col / 3);
      
      if (cellRow === row || cellCol === col || 
          (boxRow === targetBoxRow && boxCol === targetBoxCol)) {
        cell.classList.add('highlight');
      }
    });
  }
  
  clearHighlights() {
    document.querySelectorAll('.sudoku-cell').forEach(cell => {
      cell.classList.remove('highlight');
    });
  }
  
  validateBoard() {
    const cells = document.querySelectorAll('.sudoku-cell');
    cells.forEach(cell => cell.classList.remove('error'));
    
    // Check for duplicates in rows, columns, and boxes
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        if (this.board[row][col] !== 0 && !this.isValidMove(row, col, this.board[row][col])) {
          const cell = cells[row * 9 + col];
          cell.classList.add('error');
        }
      }
    }
  }
  
  isValidMove(row, col, num) {
    // Store original value and temporarily remove it
    const original = this.board[row][col];
    this.board[row][col] = 0;
    
    // Check row
    for (let c = 0; c < 9; c++) {
      if (this.board[row][c] === num) {
        this.board[row][col] = original;
        return false;
      }
    }
    
    // Check column
    for (let r = 0; r < 9; r++) {
      if (this.board[r][col] === num) {
        this.board[row][col] = original;
        return false;
      }
    }
    
    // Check 3x3 box
    const boxRow = Math.floor(row / 3) * 3;
    const boxCol = Math.floor(col / 3) * 3;
    for (let r = boxRow; r < boxRow + 3; r++) {
      for (let c = boxCol; c < boxCol + 3; c++) {
        if (this.board[r][c] === num) {
          this.board[row][col] = original;
          return false;
        }
      }
    }
    
    this.board[row][col] = original;
    return true;
  }
  
  checkCompletion() {
    // Check if board is completely filled
    let filled = true;
    let hasErrors = false;
    
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        if (this.board[row][col] === 0) {
          filled = false;
        }
      }
    }
    
    // Check for errors
    hasErrors = document.querySelectorAll('.sudoku-cell.error').length > 0;
    
    if (filled && !hasErrors) {
      this.statusElement.innerHTML = '<span class="success">🎉 Congratulations! Puzzle solved! 🎉</span>';
    } else if (hasErrors) {
      this.statusElement.innerHTML = '<span class="error-message">⚠️ There are errors in your solution</span>';
    } else {
      this.statusElement.innerHTML = '';
    }
  }
  
  generateSolution() {
    // Reset board
    this.solution = Array(9).fill().map(() => Array(9).fill(0));
    
    // Fill the board using backtracking
    this.solveSudoku(this.solution);
  }
  
  solveSudoku(board) {
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        if (board[row][col] === 0) {
          // Try numbers 1-9 in random order
          const numbers = [1,2,3,4,5,6,7,8,9].sort(() => Math.random() - 0.5);
          
          for (let num of numbers) {
            if (this.isValidSolutionMove(board, row, col, num)) {
              board[row][col] = num;
              
              if (this.solveSudoku(board)) {
                return true;
              }
              
              board[row][col] = 0;
            }
          }
          return false;
        }
      }
    }
    return true;
  }
  
  isValidSolutionMove(board, row, col, num) {
    // Check row
    for (let c = 0; c < 9; c++) {
      if (board[row][c] === num) return false;
    }
    
    // Check column
    for (let r = 0; r < 9; r++) {
      if (board[r][col] === num) return false;
    }
    
    // Check 3x3 box
    const boxRow = Math.floor(row / 3) * 3;
    const boxCol = Math.floor(col / 3) * 3;
    for (let r = boxRow; r < boxRow + 3; r++) {
      for (let c = boxCol; c < boxCol + 3; c++) {
        if (board[r][c] === num) return false;
      }
    }
    
    return true;
  }
  
  newGame() {
    this.statusElement.innerHTML = '';
    
    // Generate a complete solution
    this.generateSolution();
    
    // Copy solution to current board
    this.board = this.solution.map(row => [...row]);
    
    // Remove cells based on difficulty
    const cellsToRemove = this.difficulties[this.difficulty];
    const positions = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        positions.push([r, c]);
      }
    }
    
    // Shuffle positions and remove cells
    positions.sort(() => Math.random() - 0.5);
    for (let i = 0; i < cellsToRemove; i++) {
      const [row, col] = positions[i];
      this.board[row][col] = 0;
    }
    
    // Mark given cells
    this.given = Array(9).fill().map(() => Array(9).fill(false));
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        this.given[row][col] = this.board[row][col] !== 0;
      }
    }
    
    this.updateDisplay();
  }
  
  updateDisplay() {
    const cells = document.querySelectorAll('.sudoku-cell');
    cells.forEach((cell, index) => {
      const row = Math.floor(index / 9);
      const col = index % 9;
      
      cell.value = this.board[row][col] || '';
      cell.classList.remove('given', 'error');
      
      if (this.given[row][col]) {
        cell.classList.add('given');
        cell.readOnly = true;
      } else {
        cell.readOnly = false;
      }
    });
  }
  
  showSolution() {
    this.board = this.solution.map(row => [...row]);
    this.updateDisplay();
    this.statusElement.innerHTML = '<span class="success">✅ Solution revealed!</span>';
  }
  
  clearUserInput() {
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        if (!this.given[row][col]) {
          this.board[row][col] = 0;
        }
      }
    }
    this.updateDisplay();
    this.statusElement.innerHTML = '';
  }
}

// Global function for difficulty buttons
function setDifficulty(diff) {
  if (window.sudoku) {
    window.sudoku.setDifficulty(diff);
  }
}

// Initialize game when page loads
document.addEventListener('DOMContentLoaded', function() {
  window.sudoku = new Sudoku();
});
</script>

<div style="margin-top: 20px; padding: 15px; background: #f9f9f9; border-radius: 5px;">
  <h3>How to Play</h3>
  <ul style="text-align: left; max-width: 500px; margin: 0 auto;">
    <li><strong>Goal:</strong> Fill the 9×9 grid so that every row, column, and 3×3 box contains the digits 1-9</li>
    <li><strong>Input:</strong> Click on a cell and type a number (1-9)</li>
    <li><strong>Validation:</strong> Invalid entries will be highlighted in red</li>
    <li><strong>Hints:</strong> Related cells (same row/column/box) are highlighted when you focus on a cell</li>
    <li><strong>Controls:</strong></li>
    <ul>
      <li><strong>New Game:</strong> Generate a fresh puzzle</li>
      <li><strong>Solve:</strong> Show the complete solution</li>
      <li><strong>Clear:</strong> Remove all your entries (keeps the given numbers)</li>
    </ul>
    <li><strong>Difficulty:</strong> Choose between Easy, Medium, or Hard puzzles</li>
  </ul>
</div>
