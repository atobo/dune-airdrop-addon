/**
 * Arrakis Manager Console Addon Controller
 */

// Tab Navigation elements
const tabSettingsBtn = document.getElementById('tabSettingsBtn');
const settingsView = document.getElementById('settingsView');
const connectionStatusBadge = document.getElementById('connectionStatusBadge');

// Multipliers settings inputs

const playtimeIntervalSlider = document.getElementById('playtimeIntervalSlider');
const playtimeIntervalInput = document.getElementById('playtimeIntervalInput');
const playtimeDistanceSlider = document.getElementById('playtimeDistanceSlider');
const playtimeDistanceInput = document.getElementById('playtimeDistanceInput');
const playtimeXpSlider = document.getElementById('playtimeXpSlider');
const playtimeXpInput = document.getElementById('playtimeXpInput');

// Online Diagnostics and Pending Queue
const diagnosticsTableBody = document.getElementById('diagnosticsTableBody');
const pendingAirdropsTableBody = document.getElementById('pendingAirdropsTableBody');
const airdropPlayerSelect = document.getElementById('airdropPlayerSelect');

let pendingAirdropsData = [];

// Determine if running inside the Dune Docker Console iframe
const isSandboxMode = window.parent === window || !window.DuneAddon;

// --- Initialize Bridge & UI ---
document.addEventListener('DOMContentLoaded', async () => {
  setupMultipliersSync();
  
  if (isSandboxMode) {
    connectionStatusBadge.textContent = 'Bridge Sandbox';
    connectionStatusBadge.className = connectionStatusBadge.className.replace('text-amber-500', 'text-amber-400');
    loadMockData();
  } else {
    connectionStatusBadge.textContent = 'Console Connected';
    connectionStatusBadge.className = connectionStatusBadge.className.replace('bg-amber-500/10 text-amber-500', 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20');
    
    // Initial fetch of data wrapped in safe handlers to prevent page loading stalls
    try {
      await loadSettings();
    } catch (e) {
      console.error("Failed loading settings:", e);
    }
    
    try {
      await fetchDiagnostics();
    } catch (e) {
      console.error("Failed loading diagnostics:", e);
    }

    try {
      await fetchPendingAirdrops();
    } catch (e) {
      console.error("Failed loading pending queue:", e);
    }
    
    // Set up polling intervals
    setInterval(async () => {
      try {
        await fetchDiagnostics();
      } catch (e) {
        console.error("Error polling diagnostics:", e);
      }
    }, 5000);

    setInterval(async () => {
      try {
        await fetchPendingAirdrops();
      } catch (e) {
        console.error("Error polling pending deliveries:", e);
      }
    }, 5000);
  }
});

// --- Multipliers Sync Bindings ---
function setupMultipliersSync() {
  const syncRangeAndNumber = (slider, input, min, max, step) => {
    if (!slider || !input) return;
    slider.addEventListener('input', () => {
      input.value = slider.value;
    });
    input.addEventListener('input', () => {
      let val = parseFloat(input.value) || min;
      val = Math.max(min, Math.min(max, val));
      slider.value = val;
    });
  };

  syncRangeAndNumber(playtimeIntervalSlider, playtimeIntervalInput, 1, 120, 1);
  syncRangeAndNumber(playtimeDistanceSlider, playtimeDistanceInput, 0, 100, 1);
  syncRangeAndNumber(playtimeXpSlider, playtimeXpInput, 0, 1000, 5);

  // Sync Daily and Weekly sliders
  syncRangeAndNumber(document.getElementById('dailyStepSlider'), document.getElementById('dailyStepInput'), 0.1, 10, 0.1);
  syncRangeAndNumber(document.getElementById('dailyMaxStreakSlider'), document.getElementById('dailyMaxStreakInput'), 1, 30, 1);
  syncRangeAndNumber(document.getElementById('weeklyDaysRequiredSlider'), document.getElementById('weeklyDaysRequiredInput'), 1, 7, 1);
  syncRangeAndNumber(document.getElementById('weeklyMultiplierSlider'), document.getElementById('weeklyMultiplierInput'), 1, 100, 0.5);

  // Sync Tier Multipliers
  for (let t = 0; t <= 6; t++) {
    const slider = document.getElementById(`playtimeMultiplierT${t}Slider`);
    const input = document.getElementById(`playtimeMultiplierT${t}Input`);
    syncRangeAndNumber(slider, input, 1, 100, 1);
  }
}

// --- Database Operations ---
async function loadSettings() {
  try {
    const res = await window.DuneAddon.request("database.query", {
      query: "SELECT config_value FROM dune.discord_bot_config WHERE config_key = 'airdrop_multipliers' LIMIT 1"
    });
    
    let mults = { 
      playtime_enabled: true, 
      playtime_interval: 60, 
      playtime_distance: 10, 
      playtime_xp: 1,
      daily_enabled: true,
      daily_multiplier_step: 0.5,
      daily_max_streak: 7,
      weekly_enabled: true,
      weekly_days_required: 5,
      weekly_multiplier: 5.0
    };
    if (res && res.length > 0 && res[0].config_value) {
      mults = { ...mults, ...res[0].config_value };
    }
    
    // Load playtime inputs
    document.getElementById('playtimeEnabledToggle').checked = mults.playtime_enabled !== undefined ? mults.playtime_enabled : true;
    playtimeIntervalInput.value = mults.playtime_interval || 60;
    playtimeIntervalSlider.value = mults.playtime_interval || 60;
    playtimeDistanceInput.value = mults.playtime_distance !== undefined ? mults.playtime_distance : 10.0;
    playtimeDistanceSlider.value = mults.playtime_distance !== undefined ? mults.playtime_distance : 10.0;
    playtimeXpInput.value = mults.playtime_xp !== undefined ? mults.playtime_xp : 1;
    playtimeXpSlider.value = mults.playtime_xp !== undefined ? mults.playtime_xp : 1;

    // Load Daily inputs
    document.getElementById('dailyEnabledToggle').checked = mults.daily_enabled !== undefined ? mults.daily_enabled : true;
    document.getElementById('dailyStepInput').value = mults.daily_multiplier_step !== undefined ? mults.daily_multiplier_step : 0.5;
    document.getElementById('dailyStepSlider').value = mults.daily_multiplier_step !== undefined ? mults.daily_multiplier_step : 0.5;
    document.getElementById('dailyMaxStreakInput').value = mults.daily_max_streak !== undefined ? mults.daily_max_streak : 7;
    document.getElementById('dailyMaxStreakSlider').value = mults.daily_max_streak !== undefined ? mults.daily_max_streak : 7;

    // Load Weekly inputs
    document.getElementById('weeklyEnabledToggle').checked = mults.weekly_enabled !== undefined ? mults.weekly_enabled : true;
    document.getElementById('weeklyDaysRequiredInput').value = mults.weekly_days_required !== undefined ? mults.weekly_days_required : 5;
    document.getElementById('weeklyDaysRequiredSlider').value = mults.weekly_days_required !== undefined ? mults.weekly_days_required : 5;
    document.getElementById('weeklyMultiplierInput').value = mults.weekly_multiplier !== undefined ? mults.weekly_multiplier : 5.0;
    document.getElementById('weeklyMultiplierSlider').value = mults.weekly_multiplier !== undefined ? mults.weekly_multiplier : 5.0;

    for (let t = 0; t <= 6; t++) {
      const input = document.getElementById(`playtimeMultiplierT${t}Input`);
      const slider = document.getElementById(`playtimeMultiplierT${t}Slider`);
      if (input && slider) {
        const val = mults[`playtime_multiplier_t${t}`] !== undefined ? mults[`playtime_multiplier_t${t}`] : (mults.playtime_multiplier || 1);
        input.value = val;
        slider.value = Math.min(50, val);
      }
    }

  } catch (err) {
    showToast(`Failed to load settings: ${err.message}`, 'error');
  }
}

async function handleSaveAllSettings() {
  if (isSandboxMode) {
    showToast('Mock: Settings saved successfully!', 'success');
    return;
  }

  try {
    const payload = {
      playtime_enabled: document.getElementById('playtimeEnabledToggle').checked,
      playtime_interval: parseInt(playtimeIntervalInput.value) || 60,
      playtime_distance: parseFloat(playtimeDistanceInput.value) || 10.0,
      playtime_xp: parseInt(playtimeXpInput.value) || 1,
      daily_enabled: document.getElementById('dailyEnabledToggle').checked,
      daily_multiplier_step: parseFloat(document.getElementById('dailyStepInput').value) || 0.5,
      daily_max_streak: parseInt(document.getElementById('dailyMaxStreakInput').value) || 7,
      weekly_enabled: document.getElementById('weeklyEnabledToggle').checked,
      weekly_days_required: parseInt(document.getElementById('weeklyDaysRequiredInput').value) || 5,
      weekly_multiplier: parseFloat(document.getElementById('weeklyMultiplierInput').value) || 5.0
    };

    for (let t = 0; t <= 6; t++) {
      const input = document.getElementById(`playtimeMultiplierT${t}Input`);
      payload[`playtime_multiplier_t${t}`] = input ? parseInt(input.value) || 1 : 1;
    }
    payload.playtime_multiplier = payload.playtime_multiplier_t6;

    // 1. Save Airdrops Config
    await window.DuneAddon.request("database.execute", {
      query: `INSERT INTO dune.discord_bot_config (config_key, config_value) 
              VALUES ('airdrop_multipliers', json_build_object(
                'playtime_enabled', ${payload.playtime_enabled}::boolean,
                'playtime_interval', ${payload.playtime_interval}::int,
                'playtime_distance', ${payload.playtime_distance}::numeric,
                'playtime_xp', ${payload.playtime_xp}::int,
                'daily_enabled', ${payload.daily_enabled}::boolean,
                'daily_multiplier_step', ${payload.daily_multiplier_step}::numeric,
                'daily_max_streak', ${payload.daily_max_streak}::int,
                'weekly_enabled', ${payload.weekly_enabled}::boolean,
                'weekly_days_required', ${payload.weekly_days_required}::int,
                'weekly_multiplier', ${payload.weekly_multiplier}::numeric,
                'playtime_multiplier_t0', ${payload.playtime_multiplier_t0}::int,
                'playtime_multiplier_t1', ${payload.playtime_multiplier_t1}::int,
                'playtime_multiplier_t2', ${payload.playtime_multiplier_t2}::int,
                'playtime_multiplier_t3', ${payload.playtime_multiplier_t3}::int,
                'playtime_multiplier_t4', ${payload.playtime_multiplier_t4}::int,
                'playtime_multiplier_t5', ${payload.playtime_multiplier_t5}::int,
                'playtime_multiplier_t6', ${payload.playtime_multiplier_t6}::int,
                'playtime_multiplier', ${payload.playtime_multiplier}::int
              )) 
              ON CONFLICT (config_key) 
              DO UPDATE SET config_value = EXCLUDED.config_value`
    });

    showToast('All multipliers and settings saved successfully!', 'success');
  } catch (err) {
    showToast(`Failed to save settings: ${err.message}`, 'error');
  }
}

async function fetchDiagnostics() {
  if (isSandboxMode) return;

  try {
    const result = await window.DuneAddon.request("leadership.players.list");
    const players = result.players || result || [];

    // Filter to only online players
    const onlinePlayers = players.filter(p => p.status === 'Online');

    if (!onlinePlayers || onlinePlayers.length === 0) {
      diagnosticsTableBody.innerHTML = `
        <tr>
          <td colspan="4" class="py-4 text-center italic text-slate-500">No online players detected.</td>
        </tr>
      `;
      return;
    }

    // Try to get playtime details from active_playtime table to match nextMin playtime tracking
    let activeMap = {};
    try {
      const activeData = await window.DuneAddon.request("database.query", {
        query: `SELECT character_id, active_seconds FROM dune.bot_active_playtime`
      });
      if (activeData && activeData.length > 0) {
        activeData.forEach(row => {
          activeMap[row.character_id] = row.active_seconds;
        });
      }
    } catch (dbErr) {
      console.warn("Could not fetch active playtime seconds:", dbErr);
    }

    diagnosticsTableBody.innerHTML = onlinePlayers.map(p => {
      // Find matching player by character_id or matching character name to show correct time left
      const pName = p.name || p.characterName || 'Unknown';
      const pId = p.characterId || p.id || pName;
      const activeSeconds = activeMap[pId] || activeMap[pName] || 0;
      
      const activeMin = Math.floor(activeSeconds / 60);
      const limitMin = parseInt(playtimeIntervalInput.value) || 60;
      const nextMin = Math.max(0, limitMin - activeMin);

      return `
        <tr class="border-b border-slate-900/40 hover:bg-slate-900/20 font-mono">
          <td class="py-2 text-slate-300">${pName}</td>
          <td class="py-2 text-slate-400">${activeMin}m / ${limitMin}m</td>
          <td class="py-2 text-slate-400">${nextMin}m left</td>
          <td class="py-2 text-right text-slate-500">${p.map || 'Unknown'}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Diagnostics failed:', err);
  }
}

async function fetchPendingAirdrops() {
  if (isSandboxMode) return;

  try {
    const list = await window.DuneAddon.request("database.query", {
      query: `SELECT bpd.id, COALESCE(ps.character_name, 'Unknown') as character_name, bpd.template_id, bpd.stack_size
              FROM dune.bot_pending_deliveries bpd
              LEFT JOIN dune.player_state ps ON bpd.account_id = ps.account_id
              WHERE bpd.is_applied = false
              ORDER BY bpd.created_at DESC`
    });

    pendingAirdropsData = list || [];
    renderPendingAirdrops();

    // Populate filter dropdown
    const selected = airdropPlayerSelect.value;
    const names = [...new Set(pendingAirdropsData.map(d => d.character_name))].sort();
    airdropPlayerSelect.innerHTML = '<option value="all">All Characters</option>' + 
      names.map(n => `<option value="${n}">${n}</option>`).join('');
    if (names.includes(selected) || selected === 'all') {
      airdropPlayerSelect.value = selected;
    }
  } catch (err) {
    console.error('Failed to load pending queue:', err);
  }
}

function renderPendingAirdrops() {
  const filter = airdropPlayerSelect.value;
  const filtered = filter === 'all' 
    ? pendingAirdropsData 
    : pendingAirdropsData.filter(d => d.character_name === filter);

  if (filtered.length === 0) {
    pendingAirdropsTableBody.innerHTML = `
      <tr>
        <td colspan="3" class="py-2 text-center italic text-slate-500">No pending airdrops.</td>
      </tr>
    `;
    return;
  }

  pendingAirdropsTableBody.innerHTML = filtered.map(d => `
    <tr class="border-b border-slate-900/40 hover:bg-slate-900/20 font-mono text-xs">
      <td class="py-1.5 text-slate-300">${d.character_name}</td>
      <td class="py-1.5 text-amber-500 font-bold">${d.template_id}</td>
      <td class="py-1.5 text-right text-slate-300 font-bold">${d.stack_size}</td>
    </tr>
  `).join('');
}

// --- UI Toasts ---
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `pointer-events-auto flex items-center gap-2 px-4 py-3 rounded-lg border font-mono text-xs shadow-lg transition-all duration-300 transform translate-y-2 opacity-0`;
  
  if (type === 'success') {
    toast.className += ' bg-slate-900 border-emerald-500/30 text-emerald-400';
  } else if (type === 'error') {
    toast.className += ' bg-slate-900 border-rose-500/30 text-rose-400';
  } else {
    toast.className += ' bg-slate-900 border-amber-500/30 text-amber-400';
  }
  
  const icon = type === 'success' ? '✅' : (type === 'error' ? '❌' : '⚠️');
  toast.innerHTML = `<span>${icon}</span> <span class="flex-1">${message}</span>`;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  }, 10);
  
  setTimeout(() => {
    toast.classList.add('translate-y-2', 'opacity-0');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 4000);
}

// --- Mock Sandbox Loader ---
function loadMockData() {
  diagnosticsTableBody.innerHTML = `
    <tr class="border-b border-slate-900/40 font-mono text-xs">
      <td class="py-2 text-slate-300">PlayerOne</td>
      <td class="py-2 text-slate-400">42m / 60m</td>
      <td class="py-2 text-slate-400">18m left</td>
      <td class="py-2 text-right text-green-500 font-bold">COMPLETED</td>
    </tr>
    <tr class="border-b border-slate-900/40 font-mono text-xs">
      <td class="py-2 text-slate-300">Nalita</td>
      <td class="py-2 text-slate-400">59m / 60m</td>
      <td class="py-2 text-slate-400">1m left</td>
      <td class="py-2 text-right text-slate-600">PENDING</td>
    </tr>
  `;
  
  pendingAirdropsTableBody.innerHTML = `
    <tr class="border-b border-slate-900/40 font-mono text-xs">
      <td class="py-1.5 text-slate-300">PlayerOne</td>
      <td class="py-1.5 text-amber-500 font-bold">StandardSword</td>
      <td class="py-1.5 text-right text-slate-300 font-bold">1</td>
    </tr>
  `;
}

// Globals exports
window.handleSaveAllSettings = handleSaveAllSettings;
window.showToast = showToast;
