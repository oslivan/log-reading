const fs = require('fs');
const fsp = fs.promises;
const readline = require('readline');
const lineCountCache = new Map();

async function countLines(filePath, forceRefresh = false) {
  const stats = await fsp.stat(filePath);
  const cacheKey = filePath;
  const cached = lineCountCache.get(cacheKey);

  if (!forceRefresh && cached && cached.size === stats.size && cached.mtimeMs === stats.mtimeMs) {
    return cached.lineCount;
  }

  const input = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input,
    crlfDelay: Infinity
  });

  let lineCount = 0;
  try {
    for await (const _line of rl) {
      lineCount += 1;
    }
  } finally {
    rl.close();
    input.destroy();
  }

  lineCountCache.set(cacheKey, {
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    lineCount
  });

  return lineCount;
}

async function getFileMeta(filePath) {
  const stats = await fsp.stat(filePath);
  return {
    filePath,
    fileKey: `${filePath}::${stats.ino}`,
    size: stats.size,
    mtimeMs: stats.mtimeMs
  };
}

async function readPage(filePath, page, pageSize) {
  const currentPage = Math.max(1, Number(page) || 1);
  const currentPageSize = Math.max(1, Math.min(5000, Number(pageSize) || 200));
  const startLine = (currentPage - 1) * currentPageSize;
  const endLineExclusive = startLine + currentPageSize;

  const input = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input,
    crlfDelay: Infinity
  });

  const lines = [];
  let lineNo = 0;
  let hasNextPage = false;

  try {
    for await (const line of rl) {
      if (lineNo >= startLine && lineNo < endLineExclusive) {
        lines.push({
          no: lineNo + 1,
          text: line
        });
      }

      lineNo += 1;

      if (lineNo >= endLineExclusive) {
        hasNextPage = true;
        break;
      }
    }
  } finally {
    rl.close();
    input.destroy();
  }

  const loadedLineCount = lines.length;
  if (loadedLineCount < currentPageSize) {
    hasNextPage = false;
  }

  return {
    page: currentPage,
    pageSize: currentPageSize,
    lines,
    hasPrevPage: currentPage > 1,
    hasNextPage
  };
}

async function readLastPage(filePath, pageSize) {
  const currentPageSize = Math.max(1, Math.min(5000, Number(pageSize) || 15));

  const input = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input,
    crlfDelay: Infinity
  });

  const lines = [];
  let totalLines = 0;

  try {
    for await (const line of rl) {
      totalLines += 1;
      lines.push({
        no: totalLines,
        text: line
      });

      if (lines.length > currentPageSize) {
        lines.shift();
      }
    }
  } finally {
    rl.close();
    input.destroy();
  }

  const page = Math.max(1, Math.ceil(totalLines / currentPageSize));
  const totalPages = page;

  const stats = await fsp.stat(filePath);
  lineCountCache.set(filePath, {
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    lineCount: totalLines
  });

  return {
    page,
    pageSize: currentPageSize,
    totalLines,
    totalPages,
    lines,
    hasPrevPage: page > 1,
    hasNextPage: false
  };
}

module.exports = {
  getFileMeta,
  readPage,
  readLastPage,
  countLines
};
