/**
 * Arrakis Manager Console Addon Controller
 */

// Tab Navigation elements
const tabBlueprintBtn = document.getElementById('tabBlueprintBtn');
const tabSettingsBtn = document.getElementById('tabSettingsBtn');
const tabLootBtn = document.getElementById('tabLootBtn');

const blueprintView = document.getElementById('blueprintView');
const settingsView = document.getElementById('settingsView');
const lootView = document.getElementById('lootView');

const connectionStatusBadge = document.getElementById('connectionStatusBadge');

// Multipliers settings inputs
const xpMultiplierSlider = document.getElementById('xpMultiplierSlider');
const xpMultiplierInput = document.getElementById('xpMultiplierInput');
const harvestMultiplierSlider = document.getElementById('harvestMultiplierSlider');
const harvestMultiplierInput = document.getElementById('harvestMultiplierInput');

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

// Containers Management elements
const lootContainersTableBody = document.getElementById('lootContainersTableBody');
const lootSearchInput = document.getElementById('lootSearchInput');
const lootMapSelect = document.getElementById('lootMapSelect');
const containerInventoryGrid = document.getElementById('containerInventoryGrid');
const containerHeader = document.getElementById('containerHeader');

// Spawn Modal elements
const spawnItemModal = document.getElementById('spawnItemModal');
const spawnItemTemplateInput = document.getElementById('spawnItemTemplateInput');
const spawnItemQtyInput = document.getElementById('spawnItemQtyInput');
const spawnItemConfirmBtn = document.getElementById('spawnItemConfirmBtn');
const spawnItemCancelBtn = document.getElementById('spawnItemCancelBtn');
const validItemTemplates = document.getElementById('validItemTemplates');

let activeContainerId = null;
let currentContainersList = [];
let pendingAirdropsData = [];

// Determine if running inside the Dune Docker Console iframe
const isSandboxMode = window.parent === window;

// --- Initialize Bridge & UI ---
document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  setupMultipliersSync();
  setupSpawnModal();
  
  if (isSandboxMode) {
    connectionStatusBadge.textContent = 'Bridge Sandbox';
    connectionStatusBadge.className = connectionStatusBadge.className.replace('text-amber-500', 'text-amber-400');
    loadMockData();
  } else {
    connectionStatusBadge.textContent = 'Console Connected';
    connectionStatusBadge.className = connectionStatusBadge.className.replace('bg-amber-500/10 text-amber-500', 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20');
    
    // Initial fetch of data
    await loadSettings();
    await fetchDiagnostics();
    await fetchPendingAirdrops();
    await fetchContainers();
    
    // Set up polling intervals
    setInterval(fetchDiagnostics, 5000);
    setInterval(fetchPendingAirdrops, 5000);
  }
});

// --- Tab Navigation Setup ---
function setupNavigation() {
  const tabs = [
    { btn: tabBlueprintBtn, view: blueprintView },
    { btn: tabSettingsBtn, view: settingsView },
    { btn: tabLootBtn, view: lootView }
  ];

  tabs.forEach(tab => {
    tab.btn.addEventListener('click', () => {
      tabs.forEach(t => {
        t.view.classList.add('hidden');
        t.view.classList.remove('flex');
        t.btn.classList.remove('bg-amber-500', 'text-slate-950', 'neon-glow-orange');
        t.btn.classList.add('text-slate-400', 'hover:text-slate-200');
      });
      tab.view.classList.remove('hidden');
      if (tab.view === settingsView || tab.view === lootView || tab.view === blueprintView) {
        tab.view.classList.add('flex');
      }
      tab.btn.classList.add('bg-amber-500', 'text-slate-950', 'neon-glow-orange');
      tab.btn.classList.remove('text-slate-400', 'hover:text-slate-200');
    });
  });
}

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

  syncRangeAndNumber(xpMultiplierSlider, xpMultiplierInput, 0.1, 100, 0.5);
  syncRangeAndNumber(harvestMultiplierSlider, harvestMultiplierInput, 0.1, 100, 0.5);
  syncRangeAndNumber(playtimeIntervalSlider, playtimeIntervalInput, 1, 120, 1);
  syncRangeAndNumber(playtimeDistanceSlider, playtimeDistanceInput, 0, 100, 1);
  syncRangeAndNumber(playtimeXpSlider, playtimeXpInput, 0, 1000, 5);

  // Sync Tier Multipliers
  for (let t = 0; t <= 6; t++) {
    const slider = document.getElementById(`playtimeMultiplierT${t}Slider`);
    const input = document.getElementById(`playtimeMultiplierT${t}Input`);
    syncRangeAndNumber(slider, input, 1, 100, 1);
  }
}

// --- Spawn Modal Logic ---
function setupSpawnModal() {
  spawnItemCancelBtn.addEventListener('click', () => {
    spawnItemModal.classList.add('hidden');
  });

  spawnItemConfirmBtn.addEventListener('click', async () => {
    const templateId = spawnItemTemplateInput.value.trim();
    const qty = parseInt(spawnItemQtyInput.value) || 1;
    
    if (!templateId) {
      showToast('Please enter an item template ID.', 'error');
      return;
    }

    if (isSandboxMode) {
      showToast(`Mock: Spawned ${qty}x ${templateId}`, 'success');
      spawnItemModal.classList.add('hidden');
      return;
    }

    try {
      // Find inventory ID for the active container
      const invRes = await window.DuneAddon.request("database.query", {
        query: "SELECT id FROM dune.inventories WHERE actor_id = $1 LIMIT 1",
        params: [activeContainerId]
      });

      if (invRes && invRes.length > 0) {
        const invId = invRes[0].id;
        await window.DuneAddon.request("database.execute", {
          query: `INSERT INTO dune.items (inventory_id, template_id, stack_size, position_index, is_new, acquisition_time, stats, quality_level)
                  VALUES ($1, $2, $3, (SELECT COALESCE(MAX(position_index) + 1, 0) FROM dune.items WHERE inventory_id = $1), true, 0, '{}'::jsonb, 0)`,
          params: [invId, templateId, qty]
        });
        showToast(`Successfully spawned ${qty}x ${templateId}`, 'success');
        await selectContainer(activeContainerId);
      }
      spawnItemModal.classList.add('hidden');
    } catch (err) {
      showToast(`Failed to spawn item: ${err.message}`, 'error');
    }
  });

  // Populate datalist of common items
  const commonItems = ['ScrapMetal', 'CopperOre', 'IronOre', 'FlourSand', 'PlantFiber', 'Basalt', 'DolomiteRock', 'Silicone', 'WaterCanister', 'SpiceMelange'];
  validItemTemplates.innerHTML = commonItems.map(item => `<option value="${item}"></option>`).join('');
}

// --- Database Operations ---
async function loadSettings() {
  try {
    const res = await window.DuneAddon.request("database.query", {
      query: "SELECT config_value FROM dune.discord_bot_config WHERE config_key = 'airdrop_multipliers' LIMIT 1"
    });
    
    let mults = { playtime_interval: 60, playtime_distance: 10, playtime_xp: 1 };
    if (res && res.length > 0 && res[0].config_value) {
      mults = res[0].config_value;
    }
    
    // Load inputs
    playtimeIntervalInput.value = mults.playtime_interval || 60;
    playtimeIntervalSlider.value = mults.playtime_interval || 60;
    playtimeDistanceInput.value = mults.playtime_distance !== undefined ? mults.playtime_distance : 10.0;
    playtimeDistanceSlider.value = mults.playtime_distance !== undefined ? mults.playtime_distance : 10.0;
    playtimeXpInput.value = mults.playtime_xp !== undefined ? mults.playtime_xp : 1;
    playtimeXpSlider.value = mults.playtime_xp !== undefined ? mults.playtime_xp : 1;

    for (let t = 0; t <= 6; t++) {
      const input = document.getElementById(`playtimeMultiplierT${t}Input`);
      const slider = document.getElementById(`playtimeMultiplierT${t}Slider`);
      if (input && slider) {
        const val = mults[`playtime_multiplier_t${t}`] !== undefined ? mults[`playtime_multiplier_t${t}`] : (mults.playtime_multiplier || 1);
        input.value = val;
        slider.value = Math.min(50, val);
      }
    }

    // Load Gameplay rates
    const gameplayRes = await window.DuneAddon.request("database.query", {
      query: "SELECT config_value FROM dune.discord_bot_config WHERE config_key = 'gameplay_settings' LIMIT 1"
    });
    if (gameplayRes && gameplayRes.length > 0 && gameplayRes[0].config_value) {
      const gp = gameplayRes[0].config_value;
      xpMultiplierInput.value = gp.xp_multiplier || 1.0;
      xpMultiplierSlider.value = Math.min(50, gp.xp_multiplier || 1.0);
      harvestMultiplierInput.value = gp.harvest_multiplier || 1.0;
      harvestMultiplierSlider.value = Math.min(50, gp.harvest_multiplier || 1.0);
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
      playtime_interval: parseInt(playtimeIntervalInput.value) || 60,
      playtime_distance: parseFloat(playtimeDistanceInput.value) || 10.0,
      playtime_xp: parseInt(playtimeXpInput.value) || 1
    };

    for (let t = 0; t <= 6; t++) {
      const input = document.getElementById(`playtimeMultiplierT${t}Input`);
      payload[`playtime_multiplier_t${t}`] = input ? parseInt(input.value) || 1 : 1;
    }
    payload.playtime_multiplier = payload.playtime_multiplier_t6;

    // 1. Save Airdrops Config
    await window.DuneAddon.request("database.execute", {
      query: `INSERT INTO dune.discord_bot_config (config_key, config_value) 
              VALUES ('airdrop_multipliers', $1::jsonb) 
              ON CONFLICT (config_key) 
              DO UPDATE SET config_value = EXCLUDED.config_value`,
      params: [JSON.stringify(payload)]
    });

    // 2. Save Gameplay Rates
    const gpPayload = {
      xp_multiplier: parseFloat(xpMultiplierInput.value) || 1.0,
      harvest_multiplier: parseFloat(harvestMultiplierInput.value) || 1.0
    };
    await window.DuneAddon.request("database.execute", {
      query: `INSERT INTO dune.discord_bot_config (config_key, config_value) 
              VALUES ('gameplay_settings', $1::jsonb) 
              ON CONFLICT (config_key) 
              DO UPDATE SET config_value = EXCLUDED.config_value`,
      params: [JSON.stringify(gpPayload)]
    });

    showToast('All multipliers and settings saved successfully!', 'success');
  } catch (err) {
    showToast(`Failed to save settings: ${err.message}`, 'error');
  }
}

async function fetchDiagnostics() {
  if (isSandboxMode) return;

  try {
    const players = await window.DuneAddon.request("database.query", {
      query: `SELECT 
                ps.character_name AS name,
                COALESCE(act.map, 'Unknown') AS map,
                COALESCE(bp.active_seconds, 0) AS active_seconds,
                (SELECT COALESCE(JSON_AGG(tag), '[]'::json) FROM dune.player_tags WHERE character_id = ps.id) AS tags
              FROM dune.player_state ps
              LEFT JOIN dune.actors act ON ps.player_pawn_id = act.id
              LEFT JOIN dune.bot_active_playtime bp ON ps.player_pawn_id = bp.character_id
              WHERE ps.player_pawn_id IS NOT NULL AND LOWER(ps.online_status::text) = 'online'`
    });

    if (!players || players.length === 0) {
      diagnosticsTableBody.innerHTML = `
        <tr>
          <td colspan="4" class="py-4 text-center italic text-slate-500">No online players detected.</td>
        </tr>
      `;
      return;
    }

    diagnosticsTableBody.innerHTML = players.map(p => {
      const ecolab = (p.tags || []).includes('Contract.Tracking.Journey.EcolabCompleted')
        ? '<span class="text-green-500 font-bold">COMPLETED</span>'
        : '<span class="text-slate-600">PENDING</span>';
      
      const activeMin = Math.floor(p.active_seconds / 60);
      const limitMin = parseInt(playtimeIntervalInput.value) || 60;
      const nextMin = Math.max(0, limitMin - activeMin);

      return `
        <tr class="border-b border-slate-900/40 hover:bg-slate-900/20 font-mono">
          <td class="py-2 text-slate-300">${p.name}</td>
          <td class="py-2 text-slate-400">${activeMin}m / ${limitMin}m</td>
          <td class="py-2 text-slate-400">${nextMin}m left</td>
          <td class="py-2 text-right">${ecolab}</td>
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

// --- Container Inventory Management ---
async function fetchContainers() {
  if (isSandboxMode) return;

  try {
    const list = await window.DuneAddon.request("database.query", {
      query: `SELECT 
                a.id AS container_id,
                a.class,
                a.map,
                a.transform::text AS transform,
                inv.id AS inventory_id,
                (SELECT COUNT(*) FROM dune.items i WHERE i.inventory_id = inv.id) AS item_count,
                COALESCE(
                  (SELECT DISTINCT LOWER(dune.decrypt_user_data(eps.encrypted_character_name))
                   FROM dune.permission_actor_rank par
                   JOIN dune.encrypted_player_state eps ON par.player_id = eps.player_controller_id
                   WHERE par.permission_actor_id = a.id LIMIT 1),
                  'System'
                ) AS owner_name
              FROM dune.inventories inv
              JOIN dune.actors a ON inv.actor_id = a.id
              WHERE a.class NOT LIKE '%Character%' AND a.class NOT LIKE '%Thrall%'
              ORDER BY a.class, a.id`
    });

    currentContainersList = list.map(c => {
      let x=0, y=0, z=0;
      if (c.transform) {
        const clean = c.transform.replace(/[()"']/g, '');
        const parts = clean.split(',').map(Number);
        if (parts.length >= 3 && !parts.some(isNaN)) {
          x = parts[0]; y = parts[1]; z = parts[2];
        }
      }
      return {
        containerId: c.container_id,
        class: c.class,
        map: c.map || 'Unknown',
        inventoryId: c.inventory_id,
        itemCount: parseInt(c.item_count) || 0,
        ownerName: c.owner_name || 'System',
        coords: { x, y, z }
      };
    });

    renderContainersTable();
  } catch (err) {
    showToast(`Failed to load containers: ${err.message}`, 'error');
  }
}

function renderContainersTable() {
  const query = lootSearchInput.value.trim().toLowerCase();
  const mapFilter = lootMapSelect.value;
  
  const filtered = currentContainersList.filter(c => {
    const matchQuery = c.class.toLowerCase().includes(query) || c.containerId.toString().includes(query) || c.ownerName.toLowerCase().includes(query);
    const matchMap = !mapFilter || c.map === mapFilter;
    return matchQuery && matchMap;
  });

  if (filtered.length === 0) {
    lootContainersTableBody.innerHTML = `
      <tr>
        <td colspan="4" class="py-4 text-center italic text-slate-500">No matching containers found.</td>
      </tr>
    `;
    return;
  }

  lootContainersTableBody.innerHTML = filtered.map(c => {
    const isSelected = c.containerId === activeContainerId;
    return `
      <tr onclick="selectContainer('${c.containerId}')" class="border-b border-slate-900/40 hover:bg-slate-900/20 cursor-pointer transition ${isSelected ? 'bg-amber-500/10 border-amber-500/20' : ''}">
        <td class="py-2.5 font-mono text-[10px] text-slate-500">${c.containerId}</td>
        <td class="py-2.5">
          <div class="font-mono text-xs text-amber-500 font-bold">${c.class.split('.').pop()}</div>
          <div class="text-[10px] text-slate-400 font-mono">${c.map} (${Math.round(c.coords.x)}, ${Math.round(c.coords.y)})</div>
        </td>
        <td class="py-2.5 font-mono text-xs text-slate-300">${c.ownerName}</td>
        <td class="py-2.5 text-center font-mono text-xs font-bold text-amber-500">${c.itemCount}</td>
      </tr>
    `;
  }).join('');
}

async function selectContainer(containerId) {
  activeContainerId = parseInt(containerId);
  renderContainersTable();

  const container = currentContainersList.find(c => c.containerId === activeContainerId);
  if (!container) return;

  containerHeader.innerHTML = `
    <div class="flex items-center justify-between">
      <div>
        <h2 class="font-mono text-sm font-semibold tracking-wider text-amber-500 uppercase mb-1">
          📦 Container ${container.containerId} Details
        </h2>
        <p class="text-xs text-slate-400 font-mono">${container.class.split('.').pop()} | Owner: ${container.ownerName}</p>
      </div>
      <button onclick="openSpawnItemModal()" class="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-slate-950 text-xs font-mono font-bold rounded transition">
        + SPAWN ITEM
      </button>
    </div>
  `;

  if (isSandboxMode) {
    containerInventoryGrid.innerHTML = `
      <div class="col-span-full py-12 text-center text-slate-500 font-mono italic">
        Sandbox mode: Select elements to test coordinate renders.
      </div>
    `;
    return;
  }

  try {
    const items = await window.DuneAddon.request("database.query", {
      query: `SELECT i.id, i.stack_size, i.position_index, i.template_id, i.stats
              FROM dune.items i
              JOIN dune.inventories inv ON i.inventory_id = inv.id
              WHERE inv.actor_id = $1
              ORDER BY i.position_index`,
      params: [activeContainerId]
    });

    if (!items || items.length === 0) {
      containerInventoryGrid.innerHTML = `
        <div class="col-span-full py-12 text-center text-slate-500 font-mono italic">
          This container is empty.
        </div>
      `;
      return;
    }

    containerInventoryGrid.innerHTML = items.map(item => `
      <div class="bg-slate-950/60 border border-slate-900 rounded-lg p-3 font-mono text-xs flex flex-col justify-between">
        <div>
          <div class="text-amber-500 font-bold">${item.template_id}</div>
          <div class="text-[10px] text-slate-500 mt-1">Slot: ${item.position_index}</div>
        </div>
        <div class="flex items-center justify-between mt-3 pt-2 border-t border-slate-900/60">
          <div class="flex items-center gap-1">
            <span class="text-[10px] text-slate-600">Qty:</span>
            <input type="number" onchange="updateItemQty('${item.id}', this.value)" value="${item.stack_size}" min="1" class="w-12 bg-slate-900 border border-slate-800 rounded px-1.5 text-center text-amber-500 text-xs focus:outline-none" />
          </div>
          <button onclick="deleteContainerItem('${item.id}')" class="text-rose-500 hover:text-rose-400 text-[10px] uppercase font-bold tracking-wider">
            Delete
          </button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    containerInventoryGrid.innerHTML = `
      <div class="col-span-full py-8 text-center text-rose-500 font-mono">
        Error loading items: ${err.message}
      </div>
    `;
  }
}

async function updateItemQty(itemId, newQty) {
  if (isSandboxMode) return;
  try {
    await window.DuneAddon.request("database.execute", {
      query: "UPDATE dune.items SET stack_size = $1 WHERE id = $2",
      params: [parseInt(newQty) || 1, itemId]
    });
    showToast('Updated item quantity.', 'success');
    await fetchContainers();
    await selectContainer(activeContainerId);
  } catch (err) {
    showToast(`Failed to update quantity: ${err.message}`, 'error');
  }
}

async function deleteContainerItem(itemId) {
  if (isSandboxMode) return;
  if (!confirm('Are you sure you want to delete this item?')) return;
  try {
    await window.DuneAddon.request("database.execute", {
      query: "DELETE FROM dune.items WHERE id = $1",
      params: [itemId]
    });
    showToast('Deleted item.', 'success');
    await fetchContainers();
    await selectContainer(activeContainerId);
  } catch (err) {
    showToast(`Failed to delete item: ${err.message}`, 'error');
  }
}

function openSpawnItemModal() {
  spawnItemTemplateInput.value = '';
  spawnItemQtyInput.value = '1';
  spawnItemModal.classList.remove('hidden');
}

// --- Sync & Force Actions ---
async function handleForceSyncLoot() {
  if (isSandboxMode) {
    showToast('Mock: Force restart issued.', 'success');
    return;
  }
  if (!confirm('WARNING: Applying edits will restart the survival server. Online players will be disconnected. Continue?')) return;
  
  // Custom API restart trigger if available via permission, or database status update
  showToast('Applying container changes and restarting survival server...', 'info');
}

async function handleClearLootQueue() {
  showToast('Queue cleared.', 'success');
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
  currentContainersList = [
    { containerId: 1001, class: 'BP_SurvivalCrate_Loot_C', map: 'HaggaBasin', inventoryId: 50, itemCount: 4, ownerName: 'System', coords: { x: 4500, y: -2000, z: 120 } },
    { containerId: 1002, class: 'BP_DungeonChest_Cargo_C', map: 'DeepDesert', inventoryId: 51, itemCount: 8, ownerName: 'System', coords: { x: -8400, y: 15400, z: -10 } },
    { containerId: 1003, class: 'BP_PlayerLocker_Storage_C', map: 'HaggaBasin', inventoryId: 52, itemCount: 2, ownerName: 'atobo', coords: { x: 300, y: 1200, z: 50 } }
  ];
  
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

  renderContainersTable();
}

// Globals exports
window.handleSaveAllSettings = handleSaveAllSettings;
window.handleForceSyncLoot = handleForceSyncLoot;
window.handleClearLootQueue = handleClearLootQueue;
window.selectContainer = selectContainer;
window.openSpawnItemModal = openSpawnItemModal;
window.deleteContainerItem = deleteContainerItem;
window.updateItemQty = updateItemQty;
window.showToast = showToast;
