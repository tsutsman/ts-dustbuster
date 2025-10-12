#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const { clean } = require('./cleaner');

const indexPath = path.join(__dirname, 'public', 'index.html');
const indexHtml = fs.readFileSync(indexPath);

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/clean') {
    const logs = [];
    const origLog = console.log;
    console.log = (msg) => {
      logs.push(msg);
      origLog(msg);
    };
    await clean();
    console.log = origLog;
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(logs.join('\n'));
  } else if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(indexHtml);
  } else {
    res.writeHead(404);
    res.end();
  }
});

const port = 3000;
server.listen(port, () => {
  console.log(`GUI доступний на http://localhost:${port}`);
});
