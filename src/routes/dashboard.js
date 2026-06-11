const express = require('express');
const path    = require('path');
const pkg     = require('../../package.json');

const config  = require('../config');
const { dashboardAuth, createToken, setCookie, clearCookie } = require('../middleware/dashboardAuth');
const { getRequests, getSystem, clearRequests, clearSystem, addSystem } = require('../store/logStore');
const { getQoderModels, getModelMapping, messagesToPrompt, extractTextContent, newId, buildStreamChunk, buildDoneChunk } = require('../helpers/format');
const { checkQoderCli, runQoderRequest } = require('../helpers/spawn');
const { loadConfig, saveConfig } = require('../store/configStore');

const router     = express.Router();
const PUBLIC_DIR = path.join(__dirname, '..', 'dashboard', 'public');

// ... [rest of the file remains similar but uses dynamic data] ...

// ── API — config ─────────────────────────────────────────────────────────────
router.get('/api/config', (req, res) => {
  const publicBaseUrl = config.PUBLIC_BASE_URL ||
    `${req.protocol}://${req.get('host')}`;
  res.json({
    publicBaseUrl,
    proxyApiKey:  config.API_KEY  || null,
    authEnabled:  !!config.API_KEY,
    version:      pkg.version,
  });
});

// ── API — settings (new) ─────────────────────────────────────────────────────
router.get('/api/settings', (req, res) => {
  const settings = loadConfig();
  // Mask token for safety (e.g., sk-...last4)
  const maskedToken = settings.token ? 
    (settings.token.length > 8 ? `${settings.token.slice(0, 6)}...${settings.token.slice(-4)}` : '******') : '';
  
  res.json({
    backend: settings.backend,
    token: maskedToken,
    hasToken: !!settings.token,
    models: settings.models
  });
});

router.post('/api/settings', express.json(), (req, res) => {
  const { backend, token, models } = req.body;
  const current = loadConfig();
  
  const next = {
    backend: backend || current.backend,
    // If token is just asterisks or same as masked, don't update it
    token: (token && !token.includes('...')) ? token : current.token,
    models: Array.isArray(models) ? models : current.models
  };

  saveConfig(next);
  addSystem('Configuration updated via UI', 'info', 'dashboard');
  res.json({ ok: true });
});

// ── API — status ─────────────────────────────────────────────────────────────
// ... existing status handler ...

// ── API — models ─────────────────────────────────────────────────────────────
router.get('/api/models', (_req, res) => res.json({ models: getQoderModels() }));


// ── API — playground chat (SSE) ──────────────────────────────────────────────
router.post('/api/chat', (req, res) => {
  const { messages, model: requestedModel = 'auto' } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages is required and must be a non-empty array' });
  }
  const model  = getModelMapping(requestedModel);
  const prompt = messagesToPrompt(messages);
  const id     = newId('chatcmpl');

  res.setHeader('Content-Type',    'text/event-stream');
  res.setHeader('Cache-Control',   'no-cache');
  res.setHeader('Connection',      'keep-alive');
  res.setHeader('X-Accel-Buffering','no');

  // Send initial SSE headers to establish connection
  res.write('data: {"type":"connection","status":"connected"}\n\n');

  let lastFinishReason = 'stop';
  let emittedTextChunks = 0;
  let emittedAnyChars = 0;
  let lastStderr = '';

  const child = runQoderRequest({
    prompt, model, flags: config.QODER_MAX_OUTPUT_TOKENS ? ['--max-output-tokens', config.QODER_MAX_OUTPUT_TOKENS] : [],
    timeoutMs: config.QODER_TIMEOUT_MS,
    onChunk: (data) => {
      const content = extractTextContent(data.message);
      if (data.message?.stop_reason) lastFinishReason = data.message.stop_reason;
      if (content) {
        emittedTextChunks += 1;
        emittedAnyChars += content.length;
        res.write(`data: ${JSON.stringify(buildStreamChunk(content, model, id))}\n\n`);
      }
    },
    onDone: (code, stderr) => {
      lastStderr = stderr || '';

      // Cross-platform safety net:
      // Some runtime variants may complete successfully without emitting
      // parseable message chunks. Never silently return an empty assistant.
      if (emittedTextChunks === 0 && emittedAnyChars === 0) {
        const fallback =
          code !== 0
            ? `qodercli exited with code ${code}${lastStderr ? `: ${lastStderr.slice(0, 180)}` : ''}`
            : 'No response text was emitted by qodercli stream (empty output).';
        res.write(`data: ${JSON.stringify(buildStreamChunk(fallback, model, id))}\n\n`);
        lastFinishReason = code !== 0 ? 'error' : 'stop';
      }
      res.write(`data: ${JSON.stringify(buildDoneChunk(model, id, lastFinishReason))}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    },
    onError: (err) => {
      res.write(`data: ${JSON.stringify({ error: { message: err.message } })}\n\n`);
      res.end();
    },
  });
});

// ── API — request logs ───────────────────────────────────────────────────────
router.get('/api/logs',    (_req, res)  => res.json({ logs: getRequests() }));
router.delete('/api/logs', (_req, res)  => { clearRequests(); addSystem('Request logs cleared', 'info', 'dashboard'); res.json({ ok: true }); });

// ── API — system logs ────────────────────────────────────────────────────────
router.get('/api/logs/system',    (_req, res) => res.json({ logs: getSystem() }));
router.delete('/api/logs/system', (_req, res) => { clearSystem(); res.json({ ok: true }); });

module.exports = router;
