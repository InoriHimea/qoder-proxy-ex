const fs = require('fs');
const path = require('path');

const CONFIG_PATH = process.env.CONFIG_FILE_PATH || path.join(process.cwd(), 'data', 'config.json');

const DEFAULT_MODELS = [
  { id: "auto", label: "Auto (Smart Select)", tier: "paid", description: "Paid tier — automatically selects the best model per task (default for paid plans)." },
  { id: "ultimate", label: "Ultimate (Best Quality)", tier: "paid", description: "Paid tier — top-tier model, maximum quality." },
  { id: "performance", label: "Performance", tier: "paid", description: "Paid tier — high-performance model for demanding tasks." },
  { id: "qmodel_latest", label: "Qwen3.7-Max", tier: "new", description: "New model — Qwen 3.7 Max (Alibaba)." },
  { id: "qmodel", label: "Qwen 3.6 Plus", tier: "new", description: "New model — Qwen 3.6 Plus (Alibaba)." },
  { id: "kmodel", label: "Kimi-K2.6", tier: "new", description: "New model — Kimi-K2.6 (Moonshot AI)." },
  { id: "mmodel", label: "MiniMax-M2.7", tier: "new", description: "New model — MiniMax-M2.7." },
  { id: "dmodel", label: "DeepSeek-V4-Pro", tier: "new", description: "New model — DeepSeek V4 Pro, reasoning-capable." },
  { id: "dfmodel", label: "DeepSeek-V4-Flash", tier: "new", description: "New model — DeepSeek V4 Flash, fast and lightweight." },
  { id: "gm51model", label: "GLM-5.1", tier: "new", description: "New model — GLM-5.1 series (Zhipu AI), reasoning-capable." },
];

let cachedConfig = null;

function ensureDataDir() {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadConfig() {
  if (cachedConfig) return cachedConfig;

  ensureDataDir();

  if (!fs.existsSync(CONFIG_PATH)) {
    // Initialize with environment variables or defaults
    const initialConfig = {
      backend: (process.env.CLI_BACKEND || 'global').toLowerCase(),
      token: process.env.QODERCN_PERSONAL_ACCESS_TOKEN || process.env.QODER_PERSONAL_ACCESS_TOKEN || process.env.QODER_API_KEY || "",
      models: DEFAULT_MODELS
    };
    saveConfig(initialConfig);
    cachedConfig = initialConfig;
    return initialConfig;
  }

  try {
    const data = fs.readFileSync(CONFIG_PATH, 'utf8');
    cachedConfig = JSON.parse(data);
    return cachedConfig;
  } catch (err) {
    console.error('[configStore] Failed to load config, falling back to defaults:', err.message);
    return {
      backend: 'global',
      token: '',
      models: DEFAULT_MODELS
    };
  }
}

function saveConfig(config) {
  ensureDataDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  cachedConfig = config;
}

module.exports = {
  loadConfig,
  saveConfig,
  DEFAULT_MODELS
};
