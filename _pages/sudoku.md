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
      <button id="easy-btn" class="diff-btn active">Easy</button>
      <button id="medium-btn" class="diff-btn">Medium</button>
      <button id="hard-btn" class="diff-btn">Hard</button>
    </div>
  </div>
  <div id="sudoku-board">
    <!-- Board will be created here -->
  </div>
  <div id="game-status"></div>
</div>

<style>
#sudoku-container {
  max-width: 600px;
  margin: 20px auto;
  text-align: center;
  font-family: Arial, sans-serif;
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

#game-info button, .diff-btn {
  margin: 0 5px;
  padding: 10px 20px;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.3s;
}

#new-game-btn {
  background: #4CAF50;
  color: white;
}

#solve-btn {
  background: #2196F3;
  color: white;
}

#clear-btn {
  background: #f44336;
  color: white;
}

.diff-btn {
  background: #ddd;
  color: #333;
}

.diff-btn.active {
  background: #FF9800;
  color: white;
}

#sudoku-board {
  display: inline-block;
  border: 4px solid #000;
  background: #000;
  margin: 20px 0;
}

.sudoku-row {
  display: block;
  margin: 0;
  padding: 0;
  height: 45px;
}

.sudoku-cell {
  display: inline-block;
  width: 45px;
  height: 45px;
  border: 1px solid #666;
  background: white;
  text-align: center;
  font-size: 20px;
  font-weight: bold;
  line-height: 45px;
  margin: 0;
  padding: 0;
  cursor: pointer;
  box-sizing: border-box;
  vertical-align: top;
}

.sudoku-cell input {
  width: 100%;
  height: 100%;
  border: none;
  background: transparent;
  text-align: center;
  font-size: 20px;
  font-weight: bold;
  outline: none;
}

.sudoku-cell.given {
  background-color: #e8e8e8;
  color: #000;
}

.sudoku-cell.given input {
  color: #000;
  font-weight: bold;
}

.sudoku-cell.error {
  background-color: #ffcccb;
}

.sudoku-cell.highlight {
  background-color: #ffffcc;
}

/* Thick borders for 3x3 blocks */
.sudoku-cell:nth-child(3),
.sudoku-cell:nth-child(6) {
  border-right: 4px solid #000;
}

.sudoku-row:nth-child(3),
.sudoku-row:nth-child(6) {
  border-bottom: 4px solid #000;
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
(function() {
  let sudoku = {
    board: [],
    solution: [],
    given: [],
    difficulty: 'easy',
    
    difficulties: {
      easy: 35,
      medium: 45,
      hard: 55
    },
    
    init: function() {
      this.createEmptyArrays();
      this.createBoard();
      this.bindEvents();
      this.newGame();
    },
    
    createEmptyArrays: function() {
      this.board = [];
      this.solution = [];
      this.given = [];
      for (let i = 0; i < 9; i++) {
        this.board[i] = new Array(9).fill(0);
        this.solution[i] = new Array(9).fill(0);
        this.given[i] = new Array(9).fill(false);
      }
    },
    
    createBoard: function() {
      const boardElement = document.getElementById('sudoku-board');
      boardElement.innerHTML = '';
      
      for (let row = 0; row < 9; row++) {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'sudoku-row';
        
        for (let col = 0; col < 9; col++) {
          const cellDiv = document.createElement('div');
          cellDiv.className = 'sudoku-cell';
          cellDiv.dataset.row = row;
          cellDiv.dataset.col = col;
          
          const input = document.createElement('input');
          input.type = 'text';
          input.maxLength = 1;
          
          cellDiv.appendChild(input);
          rowDiv.appendChild(cellDiv);
        }
        boardElement.appendChild(rowDiv);
      }
    },
    
    bindEvents: function() {
      const self = this;
      
      document.getElementById('new-game-btn').onclick = function() {
        self.newGame();
      };
      
      document.getElementById('solve-btn').onclick = function() {
        self.showSolution();
      };
      
      document.getElementById('clear-btn').onclick = function() {
        self.clearUserInput();
      };
      
      document.getElementById('easy-btn').onclick = function() {
        self.setDifficulty('easy', this);
      };
      
      document.getElementById('medium-btn').onclick = function() {
        self.setDifficulty('medium', this);
      };
      
      document.getElementById('hard-btn').onclick = function() {
        self.setDifficulty('hard', this);
      };
      
      // Add input events to all cells
      document.getElementById('sudoku-board').addEventListener('input', function(e) {
        if (e.target.tagName === 'INPUT') {
          const cell = e.target.parentNode;
          const row = parseInt(cell.dataset.row);
          const col = parseInt(cell.dataset.col);
          self.handleInput(e, row, col);
        }
      });
      
      document.getElementById('sudoku-board').addEventListener('focus', function(e) {
        if (e.target.tagName === 'INPUT') {
          const cell = e.target.parentNode;
          const row = parseInt(cell.dataset.row);
          const col = parseInt(cell.dataset.col);
          self.highlightRelated(row, col);
        }
      }, true);
      
      document.getElementById('sudoku-board').addEventListener('blur', function(e) {
        if (e.target.tagName === 'INPUT') {
          self.clearHighlights();
        }
      }, true);
    },
    
    setDifficulty: function(diff, button) {
      this.difficulty = diff;
      document.querySelectorAll('.diff-btn').forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      this.newGame();
    },
    
    handleInput: function(e, row, col) {
      const value = e.target.value;
      
      if (value && (!/^[1-9]$/.test(value))) {
        e.target.value = '';
        return;
      }
      
      this.board[row][col] = value ? parseInt(value) : 0;
      this.validateBoard();
      this.checkCompletion();
    },
    
    highlightRelated: function(row, col) {
      this.clearHighlights();
      
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
    },
    
    clearHighlights: function() {
      document.querySelectorAll('.sudoku-cell').forEach(cell => {
        cell.classList.remove('highlight');
      });
    },
    
    validateBoard: function() {
      const cells = document.querySelectorAll('.sudoku-cell');
      cells.forEach(cell => cell.classList.remove('error'));
      
      for (let row = 0; row < 9; row++) {
        for (let col = 0; col < 9; col++) {
          if (this.board[row][col] !== 0 && !this.isValidMove(row, col, this.board[row][col])) {
            const cell = cells[row * 9 + col];
            cell.classList.add('error');
          }
        }
      }
    },
    
    isValidMove: function(row, col, num) {
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
    },
    
    checkCompletion: function() {
      let filled = true;
      let hasErrors = false;
      
      for (let row = 0; row < 9; row++) {
        for (let col = 0; col < 9; col++) {
          if (this.board[row][col] === 0) {
            filled = false;
          }
        }
      }
      
      hasErrors = document.querySelectorAll('.sudoku-cell.error').length > 0;
      
      const statusElement = document.getElementById('game-status');
      if (filled && !hasErrors) {
        statusElement.innerHTML = '<span class="success">🎉 Congratulations! Puzzle solved! 🎉</span>';
      } else if (hasErrors) {
        statusElement.innerHTML = '<span class="error-message">⚠️ There are errors in your solution</span>';
      } else {
        statusElement.innerHTML = '';
      }
    },
    
    generateSolution: function() {
      // Use a pre-made valid Sudoku solution as base
      const baseSolution = [
        [5,3,4,6,7,8,9,1,2],
        [6,7,2,1,9,5,3,4,8],
        [1,9,8,3,4,2,5,6,7],
        [8,5,9,7,6,1,4,2,3],
        [4,2,6,8,5,3,7,9,1],
        [7,1,3,9,2,4,8,5,6],
        [9,6,1,5,3,7,2,8,4],
        [2,8,7,4,1,9,6,3,5],
        [3,4,5,2,8,6,1,7,9]
      ];
      
      // Copy to solution array
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          this.solution[r][c] = baseSolution[r][c];
        }
      }
    },
    
    newGame: function() {
      document.getElementById('game-status').innerHTML = '';
      
      this.generateSolution();
      
      // Copy solution to board
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          this.board[r][c] = this.solution[r][c];
        }
      }
      
      // Remove cells based on difficulty
      const cellsToRemove = this.difficulties[this.difficulty];
      const positions = [];
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          positions.push([r, c]);
        }
      }
      
      // Shuffle and remove
      for (let i = positions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [positions[i], positions[j]] = [positions[j], positions[i]];
      }
      
      for (let i = 0; i < cellsToRemove; i++) {
        const [row, col] = positions[i];
        this.board[row][col] = 0;
      }
      
      // Mark given cells
      for (let row = 0; row < 9; row++) {
        for (let col = 0; col < 9; col++) {
          this.given[row][col] = this.board[row][col] !== 0;
        }
      }
      
      this.updateDisplay();
    },
    
    updateDisplay: function() {
      const cells = document.querySelectorAll('.sudoku-cell');
      cells.forEach((cell, index) => {
        const row = Math.floor(index / 9);
        const col = index % 9;
        const input = cell.querySelector('input');
        
        input.value = this.board[row][col] || '';
        cell.classList.remove('given', 'error');
        
        if (this.given[row][col]) {
          cell.classList.add('given');
          input.readOnly = true;
        } else {
          input.readOnly = false;
        }
      });
    },
    
    showSolution: function() {
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          this.board[r][c] = this.solution[r][c];
        }
      }
      this.updateDisplay();
      document.getElementById('game-status').innerHTML = '<span class="success">✅ Solution revealed!</span>';
    },
    
    clearUserInput: function() {
      for (let row = 0; row < 9; row++) {
        for (let col = 0; col < 9; col++) {
          if (!this.given[row][col]) {
            this.board[row][col] = 0;
          }
        }
      }
      this.updateDisplay();
      document.getElementById('game-status').innerHTML = '';
    }
  };
  
  // Initialize when page loads
  document.addEventListener('DOMContentLoaded', function() {
    sudoku.init();
  });
  
  // Also try immediate initialization if DOM is already loaded
  if (document.readyState === 'loading') {
    // Wait for DOMContentLoaded
  } else {
    // DOM is already loaded
    sudoku.init();
  }
})();
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
