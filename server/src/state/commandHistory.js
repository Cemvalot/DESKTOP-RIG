'use strict';

/** In-memory ring buffer of the last N executed commands. */

class CommandHistory {
  constructor(maxSize = 50) {
    this.maxSize = maxSize;
    this.items = [];
  }

  push(entry) {
    this.items.push(entry);
    if (this.items.length > this.maxSize) {
      this.items.shift();
    }
  }

  list() {
    return [...this.items].reverse(); // most recent first
  }

  clear() {
    const cleared = this.items.length;
    this.items.length = 0;
    return cleared;
  }
}

module.exports = { CommandHistory };
