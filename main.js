const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, dialog, screen, Menu } = require('electron');
const { readPage, readLastPage, countLines, getFileMeta } = require('./src/logService');
const { BookmarkStore } = require('./src/bookmarkStore');

let mainWindow;
let tailSession = null;
const TAIL_MAX_READ_BYTES = 512 * 1024;
const TAIL_MAX_LINES_PER_TICK = 400;
const TAIL_INITIAL_LINES = 5;

async function readLastLines(filePath, limit = TAIL_INITIAL_LINES) {
  const stats = await fs.promises.stat(filePath);
  if (stats.size === 0 || limit <= 0) {
    return [];
  }

  const fd = await fs.promises.open(filePath, 'r');
  const chunkSize = 64 * 1024;
  const maxScanBytes = 2 * 1024 * 1024;
  let position = stats.size;
  let scannedBytes = 0;
  let newlineCount = 0;
  const chunks = [];

  try {
    while (position > 0 && scannedBytes < maxScanBytes && newlineCount <= limit) {
      const readLength = Math.min(chunkSize, position);
      position -= readLength;
      const buffer = Buffer.alloc(readLength);
      await fd.read(buffer, 0, readLength, position);
      chunks.unshift(buffer);
      scannedBytes += readLength;

      for (let index = 0; index < readLength; index += 1) {
        if (buffer[index] === 10) {
          newlineCount += 1;
        }
      }
    }
  } finally {
    await fd.close();
  }

  const text = Buffer.concat(chunks).toString('utf8');
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines.slice(-limit);
}

function createWindow() {
  const { workAreaSize } = screen.getPrimaryDisplay();
  const initialHeight = Math.max(820, Math.floor(workAreaSize.height * 0.92));

  mainWindow = new BrowserWindow({
    width: 1200,
    height: initialHeight,
    minWidth: 980,
    minHeight: 700,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  Menu.setApplicationMenu(null);

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));
}

const bookmarkStore = new BookmarkStore(app.getPath('userData'));

async function pollTail() {
  if (!tailSession) {
    return;
  }

  const { filePath } = tailSession;
  try {
    const stats = await fs.promises.stat(filePath);
    if (stats.size < tailSession.position) {
      tailSession.position = 0;
      tailSession.leftover = '';
    }

    if (stats.size === tailSession.position) {
      return;
    }

    const readLength = Math.min(stats.size - tailSession.position, TAIL_MAX_READ_BYTES);
    const fd = await fs.promises.open(filePath, 'r');
    const buf = Buffer.alloc(readLength);

    try {
      await fd.read(buf, 0, readLength, tailSession.position);
    } finally {
      await fd.close();
    }

    tailSession.position += readLength;

    const text = tailSession.leftover + buf.toString('utf8');
    const parts = text.split(/\r?\n/);
    tailSession.leftover = parts.pop() || '';

    if (parts.length > 0) {
      const lines = parts.slice(-TAIL_MAX_LINES_PER_TICK);
      mainWindow.webContents.send('tail-lines', {
        filePath,
        lines,
        position: tailSession.position
      });
    }
  } catch (error) {
    mainWindow.webContents.send('tail-error', {
      message: error.message
    });
  }
}

function stopTailInternal() {
  if (tailSession?.timer) {
    clearInterval(tailSession.timer);
  }
  tailSession = null;
}

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle('select-log-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose Log File',
      properties: ['openFile'],
      filters: [
        { name: 'Log Files', extensions: ['log', 'txt', '*'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const selected = result.filePaths[0];
    const meta = await getFileMeta(selected);
    return meta;
  });

  ipcMain.handle('read-log-page', async (_, payload) => {
    const { filePath, page, pageSize } = payload;
    return readPage(filePath, page, pageSize);
  });

  ipcMain.handle('read-log-last-page', async (_, payload) => {
    const { filePath, pageSize } = payload;
    return readLastPage(filePath, pageSize);
  });

  ipcMain.handle('get-log-line-count', async (_, payload) => {
    const { filePath, forceRefresh = false } = payload;
    const lineCount = await countLines(filePath, forceRefresh);
    return { lineCount };
  });

  ipcMain.handle('load-bookmark', async (_, payload) => {
    const { fileKey } = payload;
    return bookmarkStore.get(fileKey);
  });

  ipcMain.handle('save-bookmark', async (_, payload) => {
    const { fileKey, bookmark } = payload;
    bookmarkStore.set(fileKey, bookmark);
    return { ok: true };
  });

  ipcMain.handle('start-tail', async (_, payload) => {
    const { filePath, startPosition = null } = payload;
    stopTailInternal();

    const stats = await fs.promises.stat(filePath);
    const initialPosition = startPosition == null
      ? stats.size
      : Math.max(0, Math.min(startPosition, stats.size));

    tailSession = {
      filePath,
      position: initialPosition,
      leftover: '',
      timer: setInterval(pollTail, 700)
    };

    const initialLines = startPosition == null
      ? await readLastLines(filePath, TAIL_INITIAL_LINES)
      : [];

    return {
      ok: true,
      position: tailSession.position,
      initialLines
    };
  });

  ipcMain.handle('stop-tail', async () => {
    stopTailInternal();
    return { ok: true };
  });

  ipcMain.handle('get-tail-position', async () => {
    return {
      position: tailSession?.position ?? 0
    };
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopTailInternal();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
