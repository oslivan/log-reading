const state = {
  file: null,
  page: 1,
  pageSize: 15,
  pagingModeLastLine: 0,
  tailRunning: false,
  tailPosition: 0,
  tailPositionKnown: false,
  autoScroll: true,
  pageAutoRefresh: false,
  logFontSize: 14,
  totalLines: 0,
  totalPages: 1,
  currentView: 'page',
  offTailListener: null,
  offTailErrorListener: null
};

const el = {
  chooseFileBtn: document.getElementById('chooseFileBtn'),
  fileName: document.getElementById('fileName'),
  showPageViewBtn: document.getElementById('showPageViewBtn'),
  showTailViewBtn: document.getElementById('showTailViewBtn'),
  pageView: document.getElementById('pageView'),
  tailView: document.getElementById('tailView'),
  fontSizeInput: document.getElementById('fontSizeInput'),
  pageSizeInput: document.getElementById('pageSizeInput'),
  refreshPageBtn: document.getElementById('refreshPageBtn'),
  pageAutoRefreshToggle: document.getElementById('pageAutoRefreshToggle'),
  resumeProgressBtn: document.getElementById('resumeProgressBtn'),
  saveProgressBtn: document.getElementById('saveProgressBtn'),
  prevPageBtn: document.getElementById('prevPageBtn'),
  nextPageBtn: document.getElementById('nextPageBtn'),
  jumpPageInput: document.getElementById('jumpPageInput'),
  jumpPageBtn: document.getElementById('jumpPageBtn'),
  pageInfo: document.getElementById('pageInfo'),
  pageList: document.getElementById('pageList'),
  tailList: document.getElementById('tailList'),
  startTailBtn: document.getElementById('startTailBtn'),
  stopTailBtn: document.getElementById('stopTailBtn'),
  autoScrollToggle: document.getElementById('autoScrollToggle'),
  statusBar: document.getElementById('statusBar'),
  errorModal: document.getElementById('errorModal'),
  errorModalMessage: document.getElementById('errorModalMessage'),
  errorModalConfirmBtn: document.getElementById('errorModalConfirmBtn')
};

const PAGE_AUTO_REFRESH_MS = 10_000;
const UI_SETTINGS_KEY = 'logReader.uiSettings.v1';
let pageAutoRefreshTimer = null;

function setStatus(text) {
  el.statusBar.textContent = text;
}

function loadUiSettings() {
  try {
    const raw = window.localStorage.getItem(UI_SETTINGS_KEY);
    if (!raw) {
      return;
    }

    const settings = JSON.parse(raw);
    if (settings && typeof settings === 'object') {
      if (typeof settings.logFontSize === 'number') {
        state.logFontSize = settings.logFontSize;
      }
      if (typeof settings.pageSize === 'number') {
        state.pageSize = settings.pageSize;
      }
      if (typeof settings.pageAutoRefresh === 'boolean') {
        state.pageAutoRefresh = settings.pageAutoRefresh;
      }
    }
  } catch {
    // ignore invalid local settings
  }
}

function persistUiSettings() {
  const settings = {
    logFontSize: state.logFontSize,
    pageSize: state.pageSize,
    pageAutoRefresh: state.pageAutoRefresh
  };
  window.localStorage.setItem(UI_SETTINGS_KEY, JSON.stringify(settings));
}

function showErrorPopup(message) {
  setStatus(message);
  el.errorModalMessage.textContent = message;
  el.errorModal.classList.remove('hidden');
  el.errorModalConfirmBtn.focus();
}

function hideErrorPopup() {
  el.errorModal.classList.add('hidden');
}

function notifyNeedFile() {
  showErrorPopup('请先选择日志文件');
}

function applyLogFontSize(size) {
  const nextSize = Math.max(11, Math.min(30, Number(size) || 14));
  state.logFontSize = nextSize;
  el.fontSizeInput.value = String(nextSize);
  document.documentElement.style.setProperty('--log-font-size', `${nextSize}px`);
  persistUiSettings();
}

function applyPageSize(size) {
  const nextSize = Math.max(1, Math.min(5000, Number(size) || 15));
  state.pageSize = nextSize;
  el.pageSizeInput.value = String(nextSize);
  persistUiSettings();
}

function updatePageInfo(page) {
  el.pageInfo.textContent = `第 ${page} / ${state.totalPages} 页`;
}

async function refreshPageTotals(forceRefresh = false) {
  if (!state.file) {
    return;
  }

  const result = await window.logApi.getLogLineCount({
    filePath: state.file.filePath,
    forceRefresh
  });

  state.totalLines = result.lineCount;
  state.totalPages = Math.max(1, Math.ceil(state.totalLines / state.pageSize));
}

function applyViewState() {
  const isPageView = state.currentView === 'page';
  el.pageView.classList.toggle('hidden', !isPageView);
  el.tailView.classList.toggle('hidden', isPageView);
  el.showPageViewBtn.classList.toggle('active', isPageView);
  el.showTailViewBtn.classList.toggle('active', !isPageView);
}

async function switchView(view) {
  if (view !== 'page' && view !== 'tail') {
    return;
  }

  if (state.currentView === view) {
    return;
  }

  if (view === 'page' && state.tailRunning) {
    await stopTail();
  }

  state.currentView = view;
  applyViewState();
  syncPageAutoRefreshTimer();

  if (!state.file) {
    notifyNeedFile();
    return;
  }

  setStatus(view === 'page' ? '已切换到分页阅读' : '已切换到实时阅读');
}

function stopPageAutoRefresh() {
  if (pageAutoRefreshTimer) {
    clearInterval(pageAutoRefreshTimer);
    pageAutoRefreshTimer = null;
  }
}

function syncPageAutoRefreshTimer() {
  stopPageAutoRefresh();

  if (!state.pageAutoRefresh || !state.file || state.currentView !== 'page') {
    return;
  }

  pageAutoRefreshTimer = setInterval(() => {
    autoRefreshCurrentPage().catch((error) => setStatus(`自动刷新失败：${error.message}`));
  }, PAGE_AUTO_REFRESH_MS);
}

function clearList(node, emptyText) {
  node.innerHTML = '';
  const p = document.createElement('div');
  p.className = 'log-item';
  p.textContent = normalizeLogText(emptyText);
  node.appendChild(p);
}

function normalizeLogText(text) {
  return String(text ?? '').replace(/<br\s*\/?>/gi, '\n');
}

function renderPageLines(lines) {
  el.pageList.innerHTML = '';
  if (!lines.length) {
    clearList(el.pageList, '当前页没有日志');
    state.pagingModeLastLine = (state.page - 1) * state.pageSize;
    return;
  }

  for (const line of lines) {
    const row = document.createElement('div');
    row.className = 'log-item';

    const text = document.createElement('span');
    text.textContent = normalizeLogText(line.text || ' ');

    row.appendChild(text);
    el.pageList.appendChild(row);
  }

  state.pagingModeLastLine = lines[lines.length - 1].no;
}

function appendTailLines(lines) {
  if (!lines.length) {
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const textLine of lines) {
    const row = document.createElement('div');
    row.className = 'log-item';
    row.textContent = normalizeLogText(textLine || ' ');
    fragment.appendChild(row);
  }

  el.tailList.appendChild(fragment);

  while (el.tailList.childElementCount > 1500) {
    el.tailList.removeChild(el.tailList.firstChild);
  }

  if (state.autoScroll) {
    el.tailList.scrollTop = el.tailList.scrollHeight;
  }
}

async function loadPage() {
  if (!state.file) {
    return;
  }

  applyPageSize(el.pageSizeInput.value);

  setStatus(`正在读取第 ${state.page} 页...`);
  const result = await window.logApi.readLogPage({
    filePath: state.file.filePath,
    page: state.page,
    pageSize: state.pageSize
  });

  renderPageLines(result.lines);
  el.prevPageBtn.disabled = !result.hasPrevPage;
  el.nextPageBtn.disabled = !result.hasNextPage;
  updatePageInfo(result.page);
  el.jumpPageInput.value = String(result.page);

  setStatus(`分页读取完成：第 ${result.page} 页，${result.lines.length} 行`);
}

async function loadLastPage() {
  if (!state.file) {
    return;
  }

  applyPageSize(el.pageSizeInput.value);

  setStatus('正在读取最后一页...');
  const result = await window.logApi.readLastLogPage({
    filePath: state.file.filePath,
    pageSize: state.pageSize
  });

  state.totalLines = result.totalLines;
  state.totalPages = result.totalPages;
  state.page = result.page;
  renderPageLines(result.lines);
  el.prevPageBtn.disabled = !result.hasPrevPage;
  el.nextPageBtn.disabled = !result.hasNextPage;
  updatePageInfo(result.page);
  el.jumpPageInput.value = String(result.page);

  const lastPageLines = typeof result.lastPageLineCount === 'number'
    ? result.lastPageLineCount
    : result.lines.length;
  setStatus(`已定位最后一页：第 ${result.page} 页，${lastPageLines} 行`);
}

async function refreshLatestPage() {
  if (!state.file) {
    notifyNeedFile();
    return;
  }

  await loadLastPage();
}

async function autoRefreshCurrentPage() {
  if (!state.file) {
    return;
  }

  await refreshPageTotals(true);
  state.page = Math.max(1, Math.min(state.page, state.totalPages));
  await loadPage();
}

function getDefaultBookmark() {
  return {
    page: state.page,
    pageSize: state.pageSize,
    lineNo: state.pagingModeLastLine,
    tailPosition: state.tailPosition
  };
}

async function saveProgress() {
  if (!state.file) {
    notifyNeedFile();
    return;
  }

  if (state.tailRunning) {
    const tailInfo = await window.logApi.getTailPosition();
    state.tailPosition = tailInfo.position;
    state.tailPositionKnown = true;
  }

  await window.logApi.saveBookmark({
    fileKey: state.file.fileKey,
    bookmark: getDefaultBookmark()
  });

  setStatus(`已保存进度：第 ${state.page} / ${state.totalPages} 页`);
}

async function resumeProgress() {
  if (!state.file) {
    notifyNeedFile();
    return;
  }

  const bookmark = await window.logApi.loadBookmark({ fileKey: state.file.fileKey });
  if (!bookmark) {
    setStatus('当前文件没有已保存进度');
    return;
  }

  state.page = bookmark.page || 1;
  state.pageSize = bookmark.pageSize || state.pageSize;
  await refreshPageTotals(true);
  state.page = Math.max(1, Math.min(state.page, state.totalPages));
  state.tailPosition = bookmark.tailPosition || 0;
  state.tailPositionKnown = true;
  el.pageSizeInput.value = String(state.pageSize);

  await loadPage();
  setStatus(`已回到上次进度：第 ${state.page} / ${state.totalPages} 页`);
}

async function stopTail() {
  if (!state.tailRunning) {
    return;
  }

  await window.logApi.stopTail();

  if (state.offTailListener) {
    state.offTailListener();
    state.offTailListener = null;
  }

  if (state.offTailErrorListener) {
    state.offTailErrorListener();
    state.offTailErrorListener = null;
  }

  state.tailRunning = false;
  el.startTailBtn.disabled = false;
  el.stopTailBtn.disabled = true;
  setStatus('实时阅读已停止');
}

async function startTail() {
  if (!state.file) {
    notifyNeedFile();
    return;
  }

  await stopTail();

  const tailStartPosition = null;
  const result = await window.logApi.startTail({
    filePath: state.file.filePath,
    startPosition: tailStartPosition
  });

  el.tailList.innerHTML = '';
  if (Array.isArray(result.initialLines) && result.initialLines.length > 0) {
    appendTailLines(result.initialLines);
  } else {
    clearList(el.tailList, '实时日志会在这里逐行显示');
  }

  state.tailPosition = result.position;
  state.tailPositionKnown = true;
  state.tailRunning = true;

  state.offTailListener = window.logApi.onTailLines((data) => {
    state.tailPosition = data.position;
    state.tailPositionKnown = true;
    appendTailLines(data.lines);
  });

  state.offTailErrorListener = window.logApi.onTailError((err) => {
    setStatus(`实时读取异常：${err.message}`);
  });

  el.startTailBtn.disabled = true;
  el.stopTailBtn.disabled = false;
  setStatus(`实时阅读已开始，已加载最近 ${Array.isArray(result.initialLines) ? result.initialLines.length : 0} 条`);
}

async function chooseFile() {
  const selected = await window.logApi.selectLogFile();
  if (!selected) {
    return;
  }

  await stopTail();

  state.file = selected;
  state.page = 1;
  state.tailPosition = 0;
  state.tailPositionKnown = false;
  state.totalLines = 0;
  state.totalPages = 1;
  state.currentView = 'page';

  el.fileName.textContent = selected.filePath;
  el.tailList.innerHTML = '';
  clearList(el.tailList, '实时日志会在这里逐行显示');
  applyViewState();
  syncPageAutoRefreshTimer();

  await loadLastPage();
  setStatus(`已选择文件：${selected.filePath}`);
}

function jumpToPage() {
  if (!state.file) {
    notifyNeedFile();
    return;
  }

  const targetPage = Math.max(1, Number(el.jumpPageInput.value) || 1);
  state.page = Math.max(1, Math.min(targetPage, state.totalPages));
  el.jumpPageInput.value = String(state.page);
  loadPage().catch((error) => setStatus(`读取失败：${error.message}`));
}

el.chooseFileBtn.addEventListener('click', () => {
  chooseFile().catch((error) => setStatus(`选择文件失败：${error.message}`));
});

el.showPageViewBtn.addEventListener('click', () => {
  switchView('page').catch((error) => setStatus(`切换阅读模式失败：${error.message}`));
});

el.showTailViewBtn.addEventListener('click', () => {
  switchView('tail').catch((error) => setStatus(`切换阅读模式失败：${error.message}`));
});

el.prevPageBtn.addEventListener('click', () => {
  if (!state.file) {
    notifyNeedFile();
    return;
  }
  if (state.page <= 1) {
    return;
  }
  state.page -= 1;
  loadPage().catch((error) => setStatus(`读取失败：${error.message}`));
});

el.nextPageBtn.addEventListener('click', () => {
  if (!state.file) {
    notifyNeedFile();
    return;
  }
  if (state.page >= state.totalPages) {
    return;
  }
  state.page += 1;
  loadPage().catch((error) => setStatus(`读取失败：${error.message}`));
});

el.jumpPageBtn.addEventListener('click', () => {
  jumpToPage();
});

el.jumpPageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    jumpToPage();
  }
});

el.pageSizeInput.addEventListener('change', () => {
  applyPageSize(el.pageSizeInput.value);
  if (!state.file) {
    setStatus('已保存每页行数设置');
    return;
  }
  loadLastPage().catch((error) => setStatus(`读取失败：${error.message}`));
});

el.refreshPageBtn.addEventListener('click', () => {
  refreshLatestPage().catch((error) => setStatus(`刷新失败：${error.message}`));
});

el.pageAutoRefreshToggle.addEventListener('change', () => {
  state.pageAutoRefresh = el.pageAutoRefreshToggle.checked;
  persistUiSettings();
  syncPageAutoRefreshTimer();
  setStatus(state.pageAutoRefresh ? '已开启10秒自动刷新' : '已关闭10秒自动刷新');
});

el.fontSizeInput.addEventListener('change', () => {
  applyLogFontSize(el.fontSizeInput.value);
});

el.saveProgressBtn.addEventListener('click', () => {
  saveProgress().catch((error) => setStatus(`保存进度失败：${error.message}`));
});

el.resumeProgressBtn.addEventListener('click', () => {
  resumeProgress().catch((error) => setStatus(`回到进度失败：${error.message}`));
});

el.startTailBtn.addEventListener('click', () => {
  startTail().catch((error) => setStatus(`启动实时阅读失败：${error.message}`));
});

el.stopTailBtn.addEventListener('click', () => {
  stopTail().catch((error) => setStatus(`停止实时阅读失败：${error.message}`));
});

el.autoScrollToggle.addEventListener('change', () => {
  state.autoScroll = el.autoScrollToggle.checked;
  setStatus(state.autoScroll ? '已开启自动滚动' : '已关闭自动滚动');
});

el.errorModalConfirmBtn.addEventListener('click', () => {
  hideErrorPopup();
});

el.errorModal.addEventListener('click', (event) => {
  if (event.target === el.errorModal) {
    hideErrorPopup();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !el.errorModal.classList.contains('hidden')) {
    hideErrorPopup();
  }
});

clearList(el.pageList, '请选择日志文件后开始分页阅读');
clearList(el.tailList, '实时日志会在这里逐行显示');
loadUiSettings();
applyPageSize(state.pageSize);
el.pageAutoRefreshToggle.checked = state.pageAutoRefresh;
applyViewState();
updatePageInfo(1);
applyLogFontSize(state.logFontSize);
syncPageAutoRefreshTimer();
