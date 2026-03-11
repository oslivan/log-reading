const fs = require('fs');
const path = require('path');

class BookmarkStore {
  constructor(baseDir) {
    this.filePath = path.join(baseDir, 'bookmarks.json');
    this.data = {};
    this.loaded = false;
  }

  ensureLoaded() {
    if (this.loaded) {
      return;
    }

    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        this.data = raw ? JSON.parse(raw) : {};
      }
    } catch {
      this.data = {};
    }

    this.loaded = true;
  }

  save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  get(fileKey) {
    this.ensureLoaded();
    return this.data[fileKey] || null;
  }

  set(fileKey, value) {
    this.ensureLoaded();
    this.data[fileKey] = {
      ...value,
      savedAt: new Date().toISOString()
    };
    this.save();
  }
}

module.exports = { BookmarkStore };
