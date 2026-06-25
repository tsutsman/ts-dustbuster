#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const { clean } = require('./cleaner');
const { t } = require('./src/i18n');

const indexPath = path.join(__dirname, 'public', 'index.html');
const indexHtml = fs.readFileSync(indexPath);

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': 'http://localhost:3000'
};

function writeJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, { ...jsonHeaders, ...extraHeaders });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/clean') {
    const logs = [];
    const metrics = { files: 0, dirs: 0, bytes: 0, skipped: 0, errors: 0 };
    const origLog = console.log;
    const origError = console.error;

    console.log = (msg) => {
      logs.push(msg);
      origLog(msg);
    };
    console.error = (msg) => {
      logs.push(`[ERROR] ${msg}`);
      origError(msg);
    };

    try {
      const result = await clean();
      Object.assign(metrics, result);
      console.log = origLog;
      console.error = origError;

      writeJson(
        res,
        200,
        { success: true, metrics, logs },
        { 'Access-Control-Allow-Credentials': 'true' }
      );
    } catch (err) {
      console.log = origLog;
      console.error = origError;
      logs.push(`[FATAL] ${err.message}`);

      writeJson(res, 500, { success: false, error: err.message, logs });
    }
  } else if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(indexHtml);
  } else if (req.method === 'GET' && req.url === '/locales') {
    const locales = {
      uk: require('./src/locales/uk.json'),
      en: require('./src/locales/en.json')
    };
    writeJson(res, 200, locales);
  } else {
    res.writeHead(404);
    res.end();
  }
});

const port = 3000;
server.listen(port, () => {
  console.log(t('gui.listening', { port }));
});
