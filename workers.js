// ==========================================
// 创世时间戳与网络参数 (Genesis Setup)
// ==========================================
const PROTOCOL_VERSION = 'v16_hardfork'; 
const EPOCH_START = 1780320600000; // 2026年6月1日北京时间21:30:00
const GENESIS_NODE = 'https://odd-art-043f.a68561918.workers.dev'; 
const DEFAULT_SEEDS = [
    GENESIS_NODE,
    'https://odd-art-043f.a68561918.workers.dev',
    'https://still-cell-000f.a6856191801.workers.dev'
]; 
const SLOT_TIME = 10000; // 10秒出块
const OFFLINE_THRESHOLD = 300000; // 5分钟离线判定
const FINALITY_DEPTH = 6; // 终局确认深度
const CHECKPOINT_INTERVAL = 500; // 每 500 块生成一个确定性检查点

// 🚀 核心：GitHub 静态资源寻址注册表
const REGISTRY_URL = 'https://raw.githubusercontent.com/a63414262/CF-Server-Monitor-Pro/main/main/templates/registry.json';

// 🚀 核心：边缘节点远程资源热重载引擎 (利用 Cloudflare 缓存防限流)
const fetchRemoteAsset = async (url, ctx, ttl = 300) => {
    if (!url) return '';
    const cache = caches.default;
    const cacheKey = new Request(url);
    let response = await cache.match(cacheKey);

    if (!response) {
        try {
            const fetchRes = await fetch(url, { signal: AbortSignal.timeout(5000) });
            if (fetchRes.ok) {
                const text = await fetchRes.text();
                response = new Response(text, {
                    headers: { 
                        'Content-Type': url.endsWith('.json') ? 'application/json' : 'text/plain;charset=UTF-8',
                        'Cache-Control': `public, max-age=${ttl}`
                    }
                });
                ctx.waitUntil(cache.put(cacheKey, response.clone()));
                return text;
            }
        } catch (e) {
            console.error(`Fetch asset failed: ${url}`, e);
        }
    } else {
        return await response.text();
    }
    return '';
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const host = url.origin;
    
    // ==========================================
    // 0. 热重载：拉取 GitHub 资源配置表
    // ==========================================
    let modules = {
        theme_css: 'https://raw.githubusercontent.com/a63414262/CF-Server-Monitor-Pro/main/main/templates/theme.css',
        install_sh: 'https://raw.githubusercontent.com/a63414262/CF-Server-Monitor-Pro/main/main/templates/install.sh',
        admin_html: 'https://raw.githubusercontent.com/a63414262/CF-Server-Monitor-Pro/main/main/templates/admin.html',
        index_html: 'https://raw.githubusercontent.com/a63414262/CF-Server-Monitor-Pro/main/main/templates/index.html',
        detail_html: 'https://raw.githubusercontent.com/a63414262/CF-Server-Monitor-Pro/main/main/templates/detail.html'
    };
    try {
        const regStr = await fetchRemoteAsset(REGISTRY_URL, ctx, 60);
        if (regStr) {
            const remoteModules = JSON.parse(regStr).modules;
            if (remoteModules) modules = { ...modules, ...remoteModules };
        }
    } catch(e) {}

    // ==========================================
    // 1. 数据库自动化热创建
    // ==========================================
    if (!globalThis.dbInitialized) {
      try {
        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`).run();
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS servers (
            id TEXT PRIMARY KEY, name TEXT, cpu TEXT, ram TEXT, disk TEXT, load_avg TEXT, uptime TEXT, last_updated INTEGER,
            ram_total TEXT, net_rx TEXT, net_tx TEXT, net_in_speed TEXT, net_out_speed TEXT, os TEXT, cpu_info TEXT, arch TEXT, boot_time TEXT, ram_used TEXT, swap_total TEXT, swap_used TEXT, disk_total TEXT, disk_used TEXT, processes TEXT, tcp_conn TEXT, udp_conn TEXT, country TEXT, ip_v4 TEXT, ip_v6 TEXT, server_group TEXT DEFAULT '默认分组', price TEXT DEFAULT '', expire_date TEXT DEFAULT '', bandwidth TEXT DEFAULT '', traffic_limit TEXT DEFAULT '', agent_os TEXT DEFAULT 'debian'
          )
        `).run();

        const { results: columns } = await env.DB.prepare(`PRAGMA table_info(servers)`).all();
        const existingCols = columns.map(c => c.name);
        const newCols = {
          ping_ct: "TEXT DEFAULT '0'", ping_cu: "TEXT DEFAULT '0'", ping_cm: "TEXT DEFAULT '0'", ping_bd: "TEXT DEFAULT '0'",
          monthly_rx: "TEXT DEFAULT '0'", monthly_tx: "TEXT DEFAULT '0'", last_rx: "TEXT DEFAULT '0'", last_tx: "TEXT DEFAULT '0'", reset_month: "TEXT DEFAULT ''", agent_os: "TEXT DEFAULT 'debian'", history: "TEXT DEFAULT '{}'", is_hidden: "TEXT DEFAULT 'false'", virt: "TEXT DEFAULT ''"
        };
        for (const [colName, colDef] of Object.entries(newCols)) {
          if (!existingCols.includes(colName)) await env.DB.prepare(`ALTER TABLE servers ADD COLUMN ${colName} ${colDef}`).run();
        }

        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS custom_themes (id TEXT PRIMARY KEY, name TEXT, css TEXT)`).run();
        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS blockchain_peers (domain TEXT PRIMARY KEY, is_beacon TEXT DEFAULT 'false', vps_count INTEGER DEFAULT 0, total_asset REAL DEFAULT 0, last_seen INTEGER, reputation_score INTEGER DEFAULT 100)`).run();
        try { await env.DB.prepare(`ALTER TABLE blockchain_peers ADD COLUMN time_offset INTEGER DEFAULT 0`).run(); } catch(e){}
        try { await env.DB.prepare(`ALTER TABLE blockchain_peers ADD COLUMN wallet_address TEXT DEFAULT ''`).run(); } catch(e){}

        const fixFlag9 = await env.DB.prepare("SELECT value FROM settings WHERE key='fix_asset_bug_v9'").first();
        if (!fixFlag9) {
            await env.DB.prepare("UPDATE blockchain_peers SET is_beacon = 'true'").run(); 
            await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('fix_asset_bug_v9', 'true')").run();
        }

        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS blockchain_ledger (slot_id INTEGER PRIMARY KEY, proposer_domain TEXT, block_hash TEXT, parent_hash TEXT, payload TEXT, timestamp INTEGER, total_difficulty INTEGER DEFAULT 0, status INTEGER DEFAULT 1)`).run();
        try { await env.DB.prepare(`ALTER TABLE blockchain_ledger ADD COLUMN parent_hash TEXT DEFAULT '0000000000000000000000000000000000000000'`).run(); } catch(e){}
        try { await env.DB.prepare(`ALTER TABLE blockchain_ledger ADD COLUMN total_difficulty INTEGER DEFAULT 0`).run(); } catch(e){}
        try { await env.DB.prepare(`ALTER TABLE blockchain_ledger ADD COLUMN status INTEGER DEFAULT 1`).run(); } catch(e){}

        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS checkpoints (slot_id INTEGER PRIMARY KEY, state_root TEXT, state_snapshot TEXT, block_hash TEXT, signature TEXT)`).run();
        try { await env.DB.prepare(`ALTER TABLE checkpoints ADD COLUMN state_snapshot TEXT`).run(); } catch(e){}
        try { await env.DB.prepare(`ALTER TABLE checkpoints ADD COLUMN block_hash TEXT`).run(); } catch(e){}
        try { await env.DB.prepare(`ALTER TABLE checkpoints ADD COLUMN signature TEXT`).run(); } catch(e){}

        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS blockchain_wallets (address TEXT PRIMARY KEY, balance REAL DEFAULT 0)`).run();
        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS mempool (tx_id TEXT PRIMARY KEY, payload TEXT, timestamp INTEGER)`).run();
        try { await env.DB.prepare(`DROP TABLE IF EXISTS executed_txs`).run(); } catch(e) {}

        const forceSync = await env.DB.prepare(`SELECT value FROM settings WHERE key='force_sync_${PROTOCOL_VERSION}'`).first();
        if (!forceSync) {
            await env.DB.prepare("DELETE FROM blockchain_ledger").run(); await env.DB.prepare("DELETE FROM blockchain_wallets").run(); await env.DB.prepare("DELETE FROM checkpoints").run(); await env.DB.prepare("DELETE FROM mempool").run();
            await env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('force_sync_${PROTOCOL_VERSION}', 'true')`).run();
            await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('rebuild_ledger', 'true')").run();
        }
        await env.DB.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('is_beacon', 'true')`).run();

        let initialPeers = [...DEFAULT_SEEDS]; let initialPingNodes = { ct: [], cu: [], cm: [] };
        try {
            const ghRes = await fetch('https://raw.githubusercontent.com/a63414262/CF-Server-Monitor-Pro/refs/heads/main/nodes.json', { signal: AbortSignal.timeout(5000) });
            if (ghRes.ok) {
                const ghData = await ghRes.json();
                if (ghData.peers && Array.isArray(ghData.peers)) ghData.peers.forEach(p => { if (!initialPeers.includes(p)) initialPeers.push(p); });
                if (ghData.ct) initialPingNodes.ct = ghData.ct; if (ghData.cu) initialPingNodes.cu = ghData.cu; if (ghData.cm) initialPingNodes.cm = ghData.cm;
            }
        } catch(e) {}

        let peerInsertStmts = [];
        for (const peer of initialPeers) { peerInsertStmts.push(env.DB.prepare(`INSERT OR IGNORE INTO blockchain_peers (domain, is_beacon, vps_count, total_asset, last_seen, reputation_score) VALUES (?, 'true', 0, 0, ?, 9999)`).bind(peer, Date.now())); }
        if (peerInsertStmts.length > 0) await env.DB.batch(peerInsertStmts);
        await env.DB.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('ping_nodes_list', ?)`).bind(JSON.stringify(initialPingNodes)).run();

        for (const seed of DEFAULT_SEEDS) {
            if (host !== seed) ctx.waitUntil(fetch(`${seed}/api/consensus/register`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ domain: host, is_beacon: 'true', vps_count: 0, total_asset: 0 }) }).catch(()=>{}));
        }
        globalThis.dbInitialized = true;
      } catch (e) {}
    }

    let sys = {
      site_title: '⚡ Server Monitor Pro', admin_title: '⚙️ 探针管理后台', theme: 'theme1', custom_bg: '', custom_css: '', custom_head: '', custom_script: '', is_public: 'true', show_price: 'true', show_expire: 'true', show_bw: 'true', show_tf: 'true', show_asset: 'false', asset_currency: '元', is_beacon: 'true', enable_ranking: 'false', ranking_api: '', tg_notify: 'false', tg_bot_token: '', tg_chat_id: '', auto_reset_traffic: 'false', report_interval: '40', ping_node_ct: 'default', ping_node_cu: 'default', ping_node_cm: 'default', miner_wallet: '', ping_nodes_list: ''
    };

    try {
      const { results } = await env.DB.prepare('SELECT * FROM settings').all();
      if (results && results.length > 0) results.forEach(r => sys[r.key] = r.value);
    } catch (e) {}

    if (request.method === 'GET' && url.pathname === '/config.json') {
      const cache = caches.default; let response = await cache.match(request);
      if (!response) {
        let configData = JSON.stringify({ INTERVAL: parseInt(sys.report_interval || '5'), CT: sys.ping_node_ct, CU: sys.ping_node_cu, CM: sys.ping_node_cm });
        response = new Response(configData, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=5, s-maxage=15' } });
        ctx.waitUntil(cache.put(request, response.clone()));
      }
      return response;
    }

    // ==========================================
    // Core Functions
    // ==========================================
    const updateNetworkTimeOffset = async () => {
        try {
            const { results } = await env.DB.prepare('SELECT time_offset FROM blockchain_peers WHERE time_offset != 0 AND last_seen > ?').bind(Date.now() - 3600000).all();
            if (results && results.length > 0) {
                const offsets = results.map(r => r.time_offset).sort((a, b) => a - b);
                globalThis.medianTimeOffset = offsets[Math.floor(offsets.length / 2)];
            } else { globalThis.medianTimeOffset = 0; }
        } catch (e) { globalThis.medianTimeOffset = 0; }
    };

    const getNetworkTime = () => (globalThis.medianTimeOffset || 0) + Date.now();
    const consensusResponse = (body, status = 200) => {
        const headers = new Headers(); headers.set('Access-Control-Allow-Origin', '*'); headers.set('X-Network-Time', getNetworkTime().toString());
        if (typeof body === 'object') { headers.set('Content-Type', 'application/json'); return new Response(JSON.stringify(body), { status, headers }); }
        return new Response(body, { status, headers });
    };

    const fetchWithTimeSync = async (url, opts = {}, peerDomain = null) => {
        if (!opts.signal) opts.signal = AbortSignal.timeout(3000);
        try {
            const tStart = Date.now(); const res = await fetch(url, opts); const tEnd = Date.now();
            const peerTimeStr = res.headers.get('X-Network-Time');
            if (peerTimeStr && peerDomain) {
                const peerTime = parseInt(peerTimeStr); const offset = peerTime - (tStart + Math.floor((tEnd - tStart) / 2));
                if (Math.abs(offset) < 86400000) ctx.waitUntil(env.DB.prepare('UPDATE blockchain_peers SET time_offset = ? WHERE domain = ?').bind(offset, peerDomain).run().catch(()=>{}));
            }
            return res;
        } catch(e) { return new Response(null, { status: 504 }); }
    };

    const executeBatchWithRetry = async (batchStmts, maxRetries = 3) => {
        if (!batchStmts || batchStmts.length === 0) return true;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try { await env.DB.batch(batchStmts); return true; } 
            catch (e) { if (attempt === maxRetries - 1) throw e; await new Promise(r => setTimeout(r, 100 * Math.pow(2, attempt) + Math.random() * 50)); }
        }
        return false;
    };

    const formatBytes = (bytes) => {
      const b = parseInt(bytes); if (isNaN(b) || b === 0) return '0 B';
      const k = 1024; const sizes = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.floor(Math.log(b) / Math.log(k));
      return parseFloat((b / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const miniHash = async (str) => {
      const hashBuffer = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
      return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    };

    const calcServerAsset = (server, nowMs) => {
        let amount = 0; let remValue = 0;
        try {
            if (server.price && typeof server.price === 'string' && server.price.match(/[\d.]+/)) {
                let rawAmount = parseFloat(server.price.match(/[\d.]+/)[0]) || 0; rawAmount = Math.min(rawAmount, 10000); 
                let rate = 1; const pUpper = server.price.toUpperCase();
                if (pUpper.includes('USD') || pUpper.includes('$')) rate = 7.23; else if (pUpper.includes('EUR') || pUpper.includes('€')) rate = 7.85; else if (pUpper.includes('GBP') || pUpper.includes('£')) rate = 9.12; else if (pUpper.includes('HKD')) rate = 0.92; else if (pUpper.includes('JPY')) rate = 0.048;
                amount = isNaN(rawAmount * rate) ? 0 : rawAmount * rate;
                let cycleDays = 365; const priceStr = server.price.toLowerCase();
                if (priceStr.includes('月') || priceStr.includes('mo')) cycleDays = 30; else if (priceStr.includes('季') || priceStr.includes('qu')) cycleDays = 90; else if (priceStr.includes('半年') || priceStr.includes('half')) cycleDays = 180;
                let expDays = -1;
                if (server.expire_date) { const diff = new Date(server.expire_date).getTime() - nowMs; expDays = diff > 0 ? Math.ceil(diff / 86400000) : 0; }
                remValue = expDays === -1 ? amount : (amount / cycleDays) * expDays;
            }
        } catch(e) {}
        return { amount: amount || 0, remValue: remValue || 0 };
    };

    const getBootstrapPeers = async () => {
        const { results } = await env.DB.prepare(`SELECT domain FROM blockchain_peers WHERE is_beacon IN ('true', '1') ORDER BY last_seen DESC LIMIT 50`).all();
        let peers = results.map(r => r.domain); DEFAULT_SEEDS.forEach(seed => { if (!peers.includes(seed) && seed !== host) peers.push(seed); });
        return peers;
    };

    const getValidLeadersForSlot = async (slotId) => {
        let leaderPool = [...DEFAULT_SEEDS];
        try {
            const { results: recentBlocks } = await env.DB.prepare('SELECT payload FROM blockchain_ledger WHERE status = 1 ORDER BY slot_id DESC LIMIT 5').all();
            for (const b of recentBlocks) {
                if (!b || !b.payload) continue;
                const pl = JSON.parse(b.payload);
                if (pl.active_nodes && Array.isArray(pl.active_nodes) && pl.active_nodes.length > 0) pl.active_nodes.forEach(n => { if (!leaderPool.includes(n)) leaderPool.push(n); });
            }
        } catch(e) {}
        leaderPool = [...new Set(leaderPool)].sort();
        const hashHex = await miniHash(slotId + "-deterministic-seed-" + PROTOCOL_VERSION);
        const pseudoRandom = parseInt(hashHex.substring(0, 8), 16);
        const leaders = []; for(let i=0; i<5; i++) { leaders.push(leaderPool[(pseudoRandom + i) % leaderPool.length]); }
        return leaders;
    };

    const evaluateTxs = async (txs) => {
        const { results: wallets } = await env.DB.prepare('SELECT address, balance FROM blockchain_wallets').all();
        let balances = new Map(); wallets.forEach(w => balances.set(w.address, w.balance));
        let validTxs = []; let stateDiff = new Map();
        for (const tx of txs) {
            if (!tx || !tx.id || tx.amount <= 0) continue;
            const amt = parseFloat(tx.amount);
            if (tx.type !== 'COINBASE' && tx.from) {
                const currentFrom = balances.get(tx.from) || 0; if (currentFrom < amt) continue; 
                balances.set(tx.from, currentFrom - amt); stateDiff.set(tx.from, (stateDiff.get(tx.from) || 0) - amt);
            }
            if (tx.to) { balances.set(tx.to, (balances.get(tx.to) || 0) + amt); stateDiff.set(tx.to, (stateDiff.get(tx.to) || 0) + amt); }
            validTxs.push(tx);
        }
        let finalWallets = Array.from(balances.entries()).filter(([addr, bal]) => bal > 0).map(([addr, bal]) => ({ address: addr, balance: bal })).sort((a, b) => a.address === b.address ? 0 : (a.address < b.address ? -1 : 1));
        const stateStr = finalWallets.map(w => `${w.address}:${w.balance.toFixed(6)}`).join('|');
        const state_root = await miniHash(stateStr);
        return { validTxs, stateDiff, state_root };
    };

    const getTxsStateStmts = (allTxs, stateDiffMap) => {
        let batchStmts = [];
        for (const tx of allTxs) if (tx && tx.id) batchStmts.push(env.DB.prepare(`DELETE FROM mempool WHERE tx_id = ?`).bind(tx.id));
        for (const [addr, diff] of stateDiffMap.entries()) if (diff !== 0) batchStmts.push(env.DB.prepare(`INSERT INTO blockchain_wallets (address, balance) VALUES (?, ?) ON CONFLICT(address) DO UPDATE SET balance = balance + excluded.balance`).bind(addr, diff));
        return batchStmts;
    };

    const rebuildBalances = async () => {
        try {
            const ck = await env.DB.prepare('SELECT slot_id, state_snapshot FROM checkpoints ORDER BY slot_id DESC LIMIT 1').first();
            let startSlot = 0; let newBalances = {};
            if (ck && ck.state_snapshot) { startSlot = ck.slot_id; try { newBalances = JSON.parse(ck.state_snapshot); } catch(e) {} }
            let executed = new Set(); let lastId = startSlot;
            while (true) {
                const { results: blocks } = await env.DB.prepare('SELECT slot_id, payload, block_hash FROM blockchain_ledger WHERE slot_id > ? AND status = 1 ORDER BY slot_id ASC LIMIT 1000').bind(lastId).all();
                if (!blocks || blocks.length === 0) break;
                for (const b of blocks) {
                    lastId = b.slot_id;
                    try {
                        const pl = JSON.parse(b.payload);
                        if (pl.txs && Array.isArray(pl.txs)) {
                            for (const tx of pl.txs) {
                                if (!tx || !tx.id || executed.has(tx.id)) continue;
                                const amount = parseFloat(tx.amount) || 0; if (amount <= 0) continue;
                                if (tx.type !== 'COINBASE' && tx.from) { const currentFromBal = newBalances[tx.from] || 0; if (currentFromBal < amount) continue; newBalances[tx.from] = currentFromBal - amount; }
                                if (tx.to) newBalances[tx.to] = (newBalances[tx.to] || 0) + amount;
                                executed.add(tx.id);
                            }
                        }
                    } catch(e) {}
                }
            }
            const { results: currentWallets } = await env.DB.prepare('SELECT address, balance FROM blockchain_wallets').all();
            let oldBalances = {}; for (const w of currentWallets) oldBalances[w.address] = w.balance;
            let batchStmts = [];
            for (const [addr, newBal] of Object.entries(newBalances)) {
                if (newBal > 0) {
                    if (oldBalances[addr] !== newBal) batchStmts.push(env.DB.prepare('INSERT INTO blockchain_wallets (address, balance) VALUES (?, ?) ON CONFLICT(address) DO UPDATE SET balance = ?').bind(addr, newBal, newBal));
                    delete oldBalances[addr]; 
                }
            }
            for (const addr of Object.keys(oldBalances)) batchStmts.push(env.DB.prepare('DELETE FROM blockchain_wallets WHERE address = ?').bind(addr));
            if (batchStmts.length > 0) for (let i = 0; i < batchStmts.length; i += 100) await executeBatchWithRetry(batchStmts.slice(i, i + 100));
        } catch(e) {}
    };

    const checkAndRebuildLedger = async () => {
        try {
            const flag = await env.DB.prepare("SELECT value FROM settings WHERE key='rebuild_ledger'").first();
            if (flag && flag.value === 'true') { await env.DB.prepare("UPDATE settings SET value='false' WHERE key='rebuild_ledger'").run(); await rebuildBalances(); }
        } catch (e) {}
    };
    ctx.waitUntil(checkAndRebuildLedger());

    const syncAndAlign = async (peerDomain) => {
        try {
            const localTop = await env.DB.prepare('SELECT slot_id, block_hash, total_difficulty FROM blockchain_ledger WHERE status = 1 ORDER BY slot_id DESC LIMIT 1').first();
            const localHeight = localTop ? localTop.slot_id : 0; const localDiff = localTop ? (localTop.total_difficulty || 0) : 0;
            if (localHeight === 0 || localHeight < (Math.max(1, Math.floor((getNetworkTime() - EPOCH_START) / SLOT_TIME)) - CHECKPOINT_INTERVAL)) {
                const snapRes = await fetchWithTimeSync(`${peerDomain}/api/consensus/snapshot`, {}, peerDomain);
                if (snapRes.ok) {
                    const snapData = await snapRes.json();
                    if (snapData.snapshot_slot && snapData.snapshot_slot > localHeight && snapData.state_snapshot) {
                        await env.DB.prepare('INSERT OR REPLACE INTO checkpoints (slot_id, state_root, state_snapshot, block_hash, signature) VALUES (?, ?, ?, ?, ?)').bind(snapData.snapshot_slot, snapData.state_root, snapData.state_snapshot, snapData.latest_hash, 'fast-sync').run();
                        await env.DB.prepare("UPDATE settings SET value='true' WHERE key='rebuild_ledger'").run();
                        return true; 
                    }
                }
            }
            const sinceSlot = Math.max(0, localHeight - 30);
            const syncRes = await fetchWithTimeSync(`${peerDomain}/api/consensus/sync?since_slot=${sinceSlot}`, {}, peerDomain);
            if (!syncRes.ok) return false;
            const syncData = await syncRes.json();
            if (syncData.peers && Array.isArray(syncData.peers)) {
                let peerStmts = [];
                for (const p of syncData.peers) {
                    if (p.domain !== host) peerStmts.push(env.DB.prepare(`INSERT INTO blockchain_peers (domain, is_beacon, vps_count, total_asset, last_seen, wallet_address) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(domain) DO UPDATE SET last_seen=MAX(last_seen, excluded.last_seen), wallet_address=CASE WHEN excluded.wallet_address != '' THEN excluded.wallet_address ELSE wallet_address END`).bind(p.domain, p.is_beacon || 'false', parseInt(p.vps_count)||0, parseFloat(p.total_asset)||0, p.last_seen || Date.now(), p.wallet_address || ''));
                }
                if (peerStmts.length > 0) ctx.waitUntil(executeBatchWithRetry(peerStmts));
            }
            if (!syncData.blocks || syncData.blocks.length === 0) return false;
            const peerTopBlock = syncData.blocks[syncData.blocks.length - 1];
            const peerDiff = parseInt(peerTopBlock.total_difficulty || 0);
            if (peerDiff < localDiff || (peerDiff === localDiff && peerTopBlock.block_hash >= (localTop ? localTop.block_hash : ''))) return false; 
            let splitSlot = -1; let blocksToApply = [];
            for (const b of syncData.blocks) {
                const expectedHash = await miniHash(`${PROTOCOL_VERSION}-${b.slot_id}-${b.parent_hash || ''}-${b.proposer_domain}-${b.payload}`);
                if (expectedHash !== b.block_hash) return false; 
                if (splitSlot === -1) { const exist = await env.DB.prepare('SELECT block_hash FROM blockchain_ledger WHERE slot_id = ?').bind(b.slot_id).first(); if (exist && exist.block_hash === b.block_hash) continue; splitSlot = b.slot_id; }
                blocksToApply.push(b); 
            }
            if (blocksToApply.length > 0) {
                let allStmts = [];
                if (splitSlot !== -1) allStmts.push(env.DB.prepare(`DELETE FROM blockchain_ledger WHERE slot_id >= ?`).bind(splitSlot));
                for (const b of blocksToApply) {
                    allStmts.push(env.DB.prepare(`INSERT INTO blockchain_ledger (slot_id, proposer_domain, block_hash, parent_hash, payload, timestamp, total_difficulty, status) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`).bind(b.slot_id, b.proposer_domain, b.block_hash, b.parent_hash || '', b.payload, b.timestamp || getNetworkTime(), b.total_difficulty || 0));
                    try {
                        const pl = JSON.parse(b.payload); const safeTotalAsset = Math.min(parseFloat(pl.total_asset)||0, 500000); let proposerWallet = ''; const cbTx = (pl.txs || []).find(t => t.type === 'COINBASE'); if (cbTx && cbTx.to) proposerWallet = cbTx.to;
                        allStmts.push(env.DB.prepare(`INSERT INTO blockchain_peers (domain, is_beacon, vps_count, total_asset, last_seen, wallet_address) VALUES (?, 'true', ?, ?, ?, ?) ON CONFLICT(domain) DO UPDATE SET is_beacon='true', vps_count=CASE WHEN excluded.last_seen > last_seen THEN excluded.vps_count ELSE vps_count END, total_asset=CASE WHEN excluded.last_seen > last_seen THEN excluded.total_asset ELSE total_asset END, last_seen=MAX(last_seen, excluded.last_seen), wallet_address=CASE WHEN excluded.wallet_address != '' THEN excluded.wallet_address ELSE wallet_address END`).bind(b.proposer_domain, parseInt(pl.vps_count)||0, safeTotalAsset, b.timestamp || getNetworkTime(), proposerWallet));
                    } catch(e){}
                }
                if (allStmts.length > 0) { for (let i = 0; i < allStmts.length; i += 100) await executeBatchWithRetry(allStmts.slice(i, i + 100)); await env.DB.prepare("UPDATE settings SET value='true' WHERE key='rebuild_ledger'").run(); await rebuildBalances(); return true; }
            }
        } catch(e) {}
        return false;
    };

    const checkAuth = (req) => {
      const authHeader = req.headers.get('Authorization'); if (!authHeader) return false; const [scheme, encoded] = authHeader.split(' '); if (scheme !== 'Basic' || !encoded) return false; const decoded = atob(encoded); const [username, password] = decoded.split(':'); return username === 'admin' && password === env.API_SECRET;
    };
    const authResponse = (realmTitle) => new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': `Basic realm="${realmTitle}"` } });

    if (request.method === 'GET' && url.searchParams.get('action') === 'balance') {
        const addr = url.searchParams.get('address') || '';
        try { const wallet = await env.DB.prepare('SELECT balance FROM blockchain_wallets WHERE address = ?').bind(addr).first(); return consensusResponse({ balance: wallet ? wallet.balance : 0 }); } catch(e) { return consensusResponse({ balance: 0 }); }
    }

    // ==========================================
    // Web3 / Consensus APIs
    // ==========================================
    globalThis.forkObservations = globalThis.forkObservations || new Map();
    if (url.pathname.startsWith('/api/consensus/')) {
        const route = url.pathname.replace('/api/consensus/', '');
        if (request.method === 'POST' && route === 'register') {
            try { const data = await request.json(); if (data.domain) { const isBeaconStr = data.is_beacon ? 'true' : 'false'; await env.DB.prepare(`INSERT INTO blockchain_peers (domain, is_beacon, vps_count, total_asset, last_seen, reputation_score) VALUES (?, ?, ?, ?, ?, 100) ON CONFLICT(domain) DO UPDATE SET is_beacon=excluded.is_beacon, vps_count=excluded.vps_count, total_asset=excluded.total_asset, last_seen=excluded.last_seen`).bind(data.domain, isBeaconStr, parseInt(data.vps_count)||0, parseFloat(data.total_asset)||0, Date.now()).run(); } return consensusResponse({ status: 'ok' }); } catch(e) { return consensusResponse('Error', 400); }
        }
        if (request.method === 'GET' && route === 'checkpoints') { const { results: checkpoints } = await env.DB.prepare('SELECT * FROM checkpoints ORDER BY slot_id DESC LIMIT 10').all(); return consensusResponse({ checkpoints }); }
        if (request.method === 'GET' && route === 'snapshot') { const ck = await env.DB.prepare('SELECT slot_id, state_root, state_snapshot, block_hash FROM checkpoints ORDER BY slot_id DESC LIMIT 1').first(); if (ck) { return consensusResponse({ snapshot_slot: ck.slot_id, state_root: ck.state_root, latest_hash: ck.block_hash, state_snapshot: ck.state_snapshot }); } return consensusResponse({ snapshot_slot: 0, state_root: '', latest_hash: '', state_snapshot: '{}' }); }
        if (request.method === 'GET' && route === 'sync') { const since = parseInt(url.searchParams.get('since_slot') || '0'); const { results: blocks } = await env.DB.prepare('SELECT * FROM blockchain_ledger WHERE slot_id > ? AND status = 1 ORDER BY slot_id ASC LIMIT 1000').bind(since).all(); const { results: peers } = await env.DB.prepare('SELECT * FROM blockchain_peers WHERE is_beacon IN ("true", "1") ORDER BY last_seen DESC LIMIT 500').all(); const { results: mempool } = await env.DB.prepare('SELECT * FROM mempool ORDER BY timestamp DESC LIMIT 20').all(); return consensusResponse({ blocks, peers, mempool }); }
        if (request.method === 'POST' && route === 'submit') {
            if (sys.is_beacon !== 'true') return consensusResponse('Not a beacon', 403);
            try {
                const block = await request.json(); const currentSlot = Math.max(1, Math.floor((getNetworkTime() - EPOCH_START) / SLOT_TIME)); if (parseInt(block.slot_id) > currentSlot + 3) return consensusResponse('Block from future rejected', 400);
                const expectedSig = await miniHash(`${PROTOCOL_VERSION}-${block.slot_id}-${block.proposer_domain}-${block.payload}`); if (block.signature !== expectedSig) return consensusResponse('Invalid Signature', 403);
                const expectedHash = await miniHash(`${PROTOCOL_VERSION}-${block.slot_id}-${block.parent_hash}-${block.proposer_domain}-${block.payload}`); if (expectedHash !== block.block_hash) return consensusResponse('Invalid Hash', 400);
                const pl = JSON.parse(block.payload); let evalResult = { validTxs: [], stateDiff: new Map() };
                if (pl.txs && pl.state_root) { evalResult = await evaluateTxs(pl.txs); if (evalResult.state_root !== pl.state_root) ctx.waitUntil(env.DB.prepare("UPDATE settings SET value='true' WHERE key='rebuild_ledger'").run().catch(()=>{})); }
                const localTip = await env.DB.prepare('SELECT slot_id, block_hash, parent_hash, total_difficulty FROM blockchain_ledger WHERE status = 1 ORDER BY slot_id DESC LIMIT 1').first(); const blockDifficulty = parseInt(block.total_difficulty || 0);
                if (localTip) {
                    const localHeight = localTip.slot_id; const localDifficulty = parseInt(localTip.total_difficulty || 0);
                    if (block.slot_id === localHeight) {
                        if (blockDifficulty > localDifficulty || (blockDifficulty === localDifficulty && block.block_hash < localTip.block_hash)) { if (block.parent_hash === localTip.parent_hash) { await env.DB.prepare('DELETE FROM blockchain_ledger WHERE slot_id = ?').bind(block.slot_id).run(); } else { ctx.waitUntil(syncAndAlign(block.proposer_domain)); return consensusResponse('Syncing deeper fork...', 202); } } else return consensusResponse('Weak tip rejected.', 403);
                    } else if (block.slot_id > localHeight) {
                        if (block.parent_hash !== localTip.block_hash && localHeight > 1) { ctx.waitUntil(syncAndAlign(block.proposer_domain)); return consensusResponse('Syncing missing blocks...', 202); }
                    } else {
                        if (blockDifficulty > localDifficulty) { ctx.waitUntil(syncAndAlign(block.proposer_domain)); return consensusResponse('Syncing heavy past fork...', 202); } return consensusResponse('Old block rejected.', 403);
                    }
                }
                const safeTotalAsset = Math.min(parseFloat(pl.total_asset)||0, 500000); let proposerWallet = ''; const cbTx = (pl.txs || []).find(t => t.type === 'COINBASE'); if (cbTx && cbTx.to) proposerWallet = cbTx.to;
                let allStmts = []; allStmts.push(env.DB.prepare(`INSERT OR IGNORE INTO blockchain_ledger (slot_id, proposer_domain, block_hash, parent_hash, payload, timestamp, total_difficulty, status) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`).bind(block.slot_id, block.proposer_domain, block.block_hash, block.parent_hash, block.payload, block.timestamp || getNetworkTime(), blockDifficulty));
                allStmts.push(env.DB.prepare(`INSERT INTO blockchain_peers (domain, is_beacon, vps_count, total_asset, last_seen, wallet_address) VALUES (?, 'true', ?, ?, ?, ?) ON CONFLICT(domain) DO UPDATE SET is_beacon='true', vps_count=excluded.vps_count, total_asset=excluded.total_asset, last_seen=MAX(last_seen, excluded.last_seen), wallet_address=CASE WHEN excluded.wallet_address != '' THEN excluded.wallet_address ELSE wallet_address END`).bind(block.proposer_domain, parseInt(pl.vps_count)||0, safeTotalAsset, Date.now(), proposerWallet));
                if (pl.txs && pl.txs.length > 0) allStmts.push(...getTxsStateStmts(pl.txs, evalResult.stateDiff));
                const batchSuccess = await executeBatchWithRetry(allStmts); if (!batchSuccess) return consensusResponse('Database Transaction Failed', 500);
                if (block.slot_id % CHECKPOINT_INTERVAL === 0 && pl.state_root) { const { results: wallets } = await env.DB.prepare('SELECT address, balance FROM blockchain_wallets WHERE balance > 0').all(); const snapMap = {}; wallets.forEach(w => snapMap[w.address] = w.balance); await env.DB.prepare('INSERT OR REPLACE INTO checkpoints (slot_id, state_root, state_snapshot, block_hash, signature) VALUES (?, ?, ?, ?, ?)').bind(block.slot_id, pl.state_root, JSON.stringify(snapMap), block.block_hash, block.signature).run(); }
                if (!globalThis.gossipCache) globalThis.gossipCache = new Set();
                if (!globalThis.gossipCache.has(block.block_hash)) {
                    globalThis.gossipCache.add(block.block_hash); if (globalThis.gossipCache.size > 500) globalThis.gossipCache.clear();
                    ctx.waitUntil((async () => { await new Promise(r => setTimeout(r, 200 + Math.random() * 500)); const tip = await env.DB.prepare('SELECT block_hash FROM blockchain_ledger WHERE status = 1 ORDER BY slot_id DESC LIMIT 1').first(); if (tip && tip.block_hash === block.block_hash) { const blockData = { slot_id: block.slot_id, proposer_domain: host, block_hash: block.block_hash, parent_hash: block.parent_hash, payload: block.payload, timestamp: block.timestamp, total_difficulty: blockDifficulty, signature: block.signature }; const { results: beacons } = await env.DB.prepare(`SELECT domain FROM blockchain_peers WHERE is_beacon IN ('true', '1') AND domain != ? ORDER BY last_seen DESC LIMIT 500`).bind(host).all(); for (const b of beacons) fetchWithTimeSync(`${b.domain}/api/consensus/submit`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(blockData) }, b.domain).catch(() => {}); } })());
                } return consensusResponse('Consensus Accepted', 200);
            } catch(e) { return consensusResponse('Block Reject', 400); }
        }
        if (request.method === 'POST' && route === 'tx') {
            try { const data = await request.json(); const tx = data.tx || data; if (!tx || !tx.from || !tx.to || !tx.amount || tx.amount <= 0) throw new Error("Invalid Tx Payload"); const wallet = await env.DB.prepare('SELECT balance FROM blockchain_wallets WHERE address = ?').bind(tx.from).first(); if (!wallet || wallet.balance < tx.amount) throw new Error("Insufficient balance"); await env.DB.prepare(`INSERT OR IGNORE INTO mempool (tx_id, payload, timestamp) VALUES (?, ?, ?)`).bind(tx.id, JSON.stringify(tx), tx.timestamp).run(); return consensusResponse('Tx Accepted', 202); } catch(e) { return consensusResponse('Tx Reject: ' + e.message, 400); }
        }
    }

    const mineAndGossip = async (localAsset, localVpsCount) => {
        try {
            await env.DB.prepare(`INSERT INTO blockchain_peers (domain, is_beacon, vps_count, total_asset, last_seen, reputation_score, wallet_address) VALUES (?, ?, ?, ?, ?, 9999, ?) ON CONFLICT(domain) DO UPDATE SET is_beacon=excluded.is_beacon, vps_count=excluded.vps_count, total_asset=excluded.total_asset, last_seen=MAX(last_seen, excluded.last_seen), wallet_address=CASE WHEN excluded.wallet_address != '' THEN excluded.wallet_address ELSE wallet_address END`).bind(host, sys.is_beacon === 'true' ? 'true' : 'false', localVpsCount, Math.max(0, localAsset), Date.now(), sys.miner_wallet || '').run().catch(()=>{});
            if (Math.random() < 0.2) await updateNetworkTimeOffset();
            const currentNetTime = getNetworkTime(); const currentSlot = Math.max(1, Math.floor((currentNetTime - EPOCH_START) / SLOT_TIME)); const slotStart = EPOCH_START + currentSlot * SLOT_TIME; const elapsedInSlot = currentNetTime - slotStart;
            let localTopRow = await env.DB.prepare('SELECT slot_id, timestamp FROM blockchain_ledger WHERE status = 1 ORDER BY slot_id DESC LIMIT 1').first();
            if (Math.random() < 0.3 || !localTopRow || currentSlot - localTopRow.slot_id > 2) { const bootstrapPeers = await getBootstrapPeers(); let targets = [GENESIS_NODE]; const randomPeer = bootstrapPeers[Math.floor(Math.random() * bootstrapPeers.length)]; if (randomPeer !== host && randomPeer !== GENESIS_NODE) targets.push(randomPeer); for (const target of targets) { if (target === host) continue; const synced = await syncAndAlign(target); if (synced) { localTopRow = await env.DB.prepare('SELECT slot_id, timestamp FROM blockchain_ledger WHERE status = 1 ORDER BY slot_id DESC LIMIT 1').first(); break; } } }
            if (host !== GENESIS_NODE && localTopRow) { const timeGap = currentNetTime - localTopRow.timestamp; if (currentSlot - localTopRow.slot_id > 10 && timeGap < 120000) return; }
            const timeSinceLastBlock = localTopRow ? (currentNetTime - localTopRow.timestamp) : 999999; const leaders = await getValidLeadersForSlot(currentSlot); let isMyTurn = false; let isRescueMint = false; 
            if (sys.is_beacon === 'true') { if (leaders[0] === host) isMyTurn = true; else if (leaders.length > 1 && leaders[1] === host && elapsedInSlot >= 2000) isMyTurn = true; else if (leaders.length > 2 && leaders[2] === host && elapsedInSlot >= 4000) isMyTurn = true; else if (leaders.length > 3 && leaders[3] === host && elapsedInSlot >= 6000) isMyTurn = true; else if (leaders.length > 4 && leaders[4] === host && elapsedInSlot >= 8000) isMyTurn = true; else if (elapsedInSlot >= 9000 && timeSinceLastBlock > 25000) { isMyTurn = true; isRescueMint = true; } }
            if (!isMyTurn) { if (Math.random() < 0.1) { const bootstrapPeers = await getBootstrapPeers(); let syncTargets = bootstrapPeers.filter(p => p !== host); if (syncTargets.length > 0) { const target = syncTargets[Math.floor(Math.random() * syncTargets.length)]; fetchWithTimeSync(`${target}/api/consensus/register`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ domain: host, is_beacon: sys.is_beacon === 'true' ? 'true' : 'false', vps_count: localVpsCount, total_asset: localAsset }) }, target).catch(()=>{}); } } return; }
            await new Promise(r => setTimeout(r, Math.random() * 400));
            const existCheck = await env.DB.prepare('SELECT slot_id FROM blockchain_ledger WHERE slot_id = ?').bind(currentSlot).first(); if (existCheck) return;
            const localPrevBlock = await env.DB.prepare('SELECT block_hash, total_difficulty FROM blockchain_ledger WHERE status = 1 ORDER BY slot_id DESC LIMIT 1').first(); const parentHash = localPrevBlock ? localPrevBlock.block_hash : '0000000000000000000000000000000000000000'; const parentDifficulty = localPrevBlock ? (localPrevBlock.total_difficulty || 0) : 0; const proposerAsset = Math.max(1, Math.floor(localAsset));
            let currentDifficulty = parentDifficulty + proposerAsset; if (isRescueMint) currentDifficulty += 100; 
            const { results: pendingTxs } = await env.DB.prepare('SELECT payload FROM mempool ORDER BY timestamp ASC, tx_id ASC LIMIT 20').all(); let blockTxs = pendingTxs.map(t => JSON.parse(t.payload)); blockTxs.sort((a, b) => a.timestamp !== b.timestamp ? a.timestamp - b.timestamp : (a.id < b.id ? -1 : 1));
            if (sys.miner_wallet) { const coinbaseId = 'cb-' + currentSlot + '-' + await miniHash(host); blockTxs.push({ id: coinbaseId, type: 'COINBASE', to: sys.miner_wallet, amount: 1, timestamp: currentNetTime }); }
            const activeThreshold = Date.now() - 86400000; const { results: topPeers } = await env.DB.prepare(`SELECT domain FROM blockchain_peers WHERE is_beacon IN ('true', '1') AND last_seen > ? ORDER BY total_asset DESC, last_seen DESC LIMIT 500`).bind(activeThreshold).all(); let active_nodes = topPeers.map(p => p.domain); if (!active_nodes.includes(host)) active_nodes.push(host); if (!active_nodes.includes(GENESIS_NODE)) active_nodes.push(GENESIS_NODE); active_nodes = [...new Set(active_nodes)].sort();
            const evalResult = await evaluateTxs(blockTxs); const state_root = evalResult.state_root; const payloadStr = JSON.stringify({ vps_count: localVpsCount, total_asset: localAsset, txs: blockTxs, state_root, active_nodes });
            const hash = await miniHash(`${PROTOCOL_VERSION}-${currentSlot}-${parentHash}-${host}-${payloadStr}`); const signature = await miniHash(`${PROTOCOL_VERSION}-${currentSlot}-${host}-${payloadStr}`);
            let allStmts = []; allStmts.push(env.DB.prepare(`INSERT OR IGNORE INTO blockchain_ledger (slot_id, proposer_domain, block_hash, parent_hash, payload, timestamp, total_difficulty, status) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`).bind(currentSlot, host, hash, parentHash, payloadStr, currentNetTime, currentDifficulty)); allStmts.push(...getTxsStateStmts(blockTxs, evalResult.stateDiff));
            const batchSuccess = await executeBatchWithRetry(allStmts);
            if (batchSuccess && currentSlot % CHECKPOINT_INTERVAL === 0) { const { results: wallets } = await env.DB.prepare('SELECT address, balance FROM blockchain_wallets WHERE balance > 0').all(); const snapMap = {}; wallets.forEach(w => snapMap[w.address] = w.balance); await env.DB.prepare('INSERT OR REPLACE INTO checkpoints (slot_id, state_root, state_snapshot, block_hash, signature) VALUES (?, ?, ?, ?, ?)').bind(currentSlot, state_root, JSON.stringify(snapMap), hash, signature).run(); }
            if (!globalThis.gossipCache) globalThis.gossipCache = new Set(); globalThis.gossipCache.add(hash);
            const blockData = { slot_id: currentSlot, proposer_domain: host, block_hash: hash, parent_hash: parentHash, payload: payloadStr, timestamp: currentNetTime, total_difficulty: currentDifficulty, signature: signature };
            const { results: beacons } = await env.DB.prepare(`SELECT domain FROM blockchain_peers WHERE is_beacon IN ('true', '1') AND domain != ? ORDER BY last_seen DESC LIMIT 500`).bind(host).all();
            for (const b of beacons) fetchWithTimeSync(`${b.domain}/api/consensus/submit`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(blockData) }, b.domain).catch(() => {});
        } catch(e) {}
    };

    const sendTelegram = async (msg) => {
      if (sys.tg_notify !== 'true' || !sys.tg_bot_token || !sys.tg_chat_id) return;
      try { await fetch(`https://api.telegram.org/bot${sys.tg_bot_token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: sys.tg_chat_id, text: msg, parse_mode: 'HTML' }), signal: AbortSignal.timeout(3000) }); } catch (e) {}
    };

    const checkOfflineNodes = async () => {
      if (sys.tg_notify !== 'true') return;
      try {
        const { results: allServers } = await env.DB.prepare('SELECT id, name, last_updated FROM servers').all(); let alertState = {}; const stateRes = await env.DB.prepare("SELECT value FROM settings WHERE key = 'alert_state'").first(); if (stateRes) alertState = JSON.parse(stateRes.value);
        let stateChanged = false; const now = Date.now();
        for (const s of allServers) {
          const isOffline = (now - s.last_updated) > OFFLINE_THRESHOLD; 
          if (isOffline && !alertState[s.id]) { await sendTelegram(`⚠️ <b>节点离线告警</b>\n\n<b>节点名称:</b> ${s.name}\n<b>状态:</b> 离线 (超过5分钟未上报)\n<b>时间:</b> ${new Date().toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'})}`); alertState[s.id] = true; stateChanged = true; } 
          else if (!isOffline && alertState[s.id]) { await sendTelegram(`✅ <b>节点恢复通知</b>\n\n<b>节点名称:</b> ${s.name}\n<b>状态:</b> 恢复在线\n<b>时间:</b> ${new Date().toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'})}`); delete alertState[s.id]; stateChanged = true; }
        }
        if (stateChanged) await env.DB.prepare('INSERT INTO settings (key, value) VALUES ("alert_state", ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(JSON.stringify(alertState)).run();
      } catch (e) {}
    };

    // ==========================================
    // 代理 Agent 上报 API (/update)
    // ==========================================
    if (request.method === 'POST' && url.pathname === '/update') {
      try {
        const data = await request.json(); const { id, secret, metrics, type } = data; if (secret !== env.API_SECRET) return new Response('Unauthorized', { status: 401 });
        if (type === 'ping') { await env.DB.prepare(`UPDATE servers SET last_updated = ? WHERE id = ?`).bind(Date.now(), id).run(); return new Response("Ping OK", { status: 200 }); }
        let countryCode = request.cf && request.cf.country ? request.cf.country : 'XX'; if (countryCode.toUpperCase() === 'TW') countryCode = 'CN';
        const serverExists = await env.DB.prepare('SELECT * FROM servers WHERE id = ?').bind(id).first(); if (!serverExists) return new Response('Server not found', { status: 404 });
        const localNow = new Date(Date.now() + 8 * 60 * 60000); const currentMonthStr = `${localNow.getFullYear()}-${localNow.getMonth() + 1}`;
        let monthly_rx = parseFloat(serverExists.monthly_rx || '0'); let monthly_tx = parseFloat(serverExists.monthly_tx || '0'); let last_rx = parseFloat(serverExists.last_rx || '0'); let last_tx = parseFloat(serverExists.last_tx || '0'); let reset_month = serverExists.reset_month || currentMonthStr;
        if (sys.auto_reset_traffic === 'true' && currentMonthStr !== reset_month) { monthly_rx = 0; monthly_tx = 0; reset_month = currentMonthStr; }
        const current_rx = parseFloat(metrics.net_rx || '0'); const current_tx = parseFloat(metrics.net_tx || '0');
        if (current_rx >= last_rx) monthly_rx += (current_rx - last_rx); else monthly_rx += current_rx; if (current_tx >= last_tx) monthly_tx += (current_tx - last_tx); else monthly_tx += current_tx;
        last_rx = current_rx; last_tx = current_tx;
        let history = {}; try { history = JSON.parse(serverExists.history || '{}'); } catch(e) {}
        const nowMs = Date.now();
        if (nowMs - (history.last_time || 0) >= 300000 || !history.time) {
            const maxPoints = 288; const updateArr = (arr, val) => { if (!Array.isArray(arr)) arr = []; arr.push(val); if (arr.length > maxPoints) arr.shift(); return arr; };
            const updateLabels = (arr) => { if (!Array.isArray(arr)) arr = []; const d = new Date(nowMs + 8 * 60 * 60000); const timeLabel = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0'); arr.push(timeLabel); if (arr.length > maxPoints) arr.shift(); return arr; };
            history.cpu = updateArr(history.cpu, parseFloat(metrics.cpu) || 0); history.ram = updateArr(history.ram, parseFloat(metrics.ram) || 0); history.proc = updateArr(history.proc, parseInt(metrics.processes) || 0); history.net_in = updateArr(history.net_in, parseFloat(metrics.net_in_speed) || 0); history.net_out = updateArr(history.net_out, parseFloat(metrics.net_out_speed) || 0); history.tcp = updateArr(history.tcp, parseInt(metrics.tcp_conn) || 0); history.udp = updateArr(history.udp, parseInt(metrics.udp_conn) || 0); history.ping_ct = updateArr(history.ping_ct, parseInt(metrics.ping_ct) || 0); history.ping_cu = updateArr(history.ping_cu, parseInt(metrics.ping_cu) || 0); history.ping_cm = updateArr(history.ping_cm, parseInt(metrics.ping_cm) || 0); history.ping_bd = updateArr(history.ping_bd, parseInt(metrics.ping_bd) || 0); history.time = updateLabels(history.time); history.last_time = nowMs;
        }
        await env.DB.prepare(`UPDATE servers SET cpu = ?, ram = ?, disk = ?, load_avg = ?, uptime = ?, last_updated = ?, ram_total = ?, net_rx = ?, net_tx = ?, net_in_speed = ?, net_out_speed = ?, os = ?, cpu_info = ?, arch = ?, boot_time = ?, ram_used = ?, swap_total = ?, swap_used = ?, disk_total = ?, disk_used = ?, processes = ?, tcp_conn = ?, udp_conn = ?, country = ?, ip_v4 = ?, ip_v6 = ?, ping_ct = ?, ping_cu = ?, ping_cm = ?, ping_bd = ?, monthly_rx = ?, monthly_tx = ?, last_rx = ?, last_tx = ?, reset_month = ?, history = ?, virt = ? WHERE id = ?`).bind(metrics.cpu, metrics.ram, metrics.disk, metrics.load, metrics.uptime, Date.now(), metrics.ram_total || '0', metrics.net_rx || '0', metrics.net_tx || '0', metrics.net_in_speed || '0', metrics.net_out_speed || '0', metrics.os || '', metrics.cpu_info || '', metrics.arch || '', metrics.boot_time || '', metrics.ram_used || '0', metrics.swap_total || '0', metrics.swap_used || '0', metrics.disk_total || '0', metrics.disk_used || '0', metrics.processes || '0', metrics.tcp_conn || '0', metrics.udp_conn || '0', countryCode, metrics.ip_v4 || '0', metrics.ip_v6 || '0', metrics.ping_ct || '0', metrics.ping_cu || '0', metrics.ping_cm || '0', metrics.ping_bd || '0', monthly_rx.toString(), monthly_tx.toString(), last_rx.toString(), last_tx.toString(), reset_month, JSON.stringify(history), metrics.virt || '', id).run();
        const nowMsForThrottle = Date.now();
        if (!globalThis.lastOfflineCheck || nowMsForThrottle - globalThis.lastOfflineCheck > 60000) { globalThis.lastOfflineCheck = nowMsForThrottle; ctx.waitUntil(checkOfflineNodes()); }
        if (!globalThis.lastMineAndGossipTime || nowMsForThrottle - globalThis.lastMineAndGossipTime > 5000) { globalThis.lastMineAndGossipTime = nowMsForThrottle; ctx.waitUntil((async () => { try { const { results: allS } = await env.DB.prepare('SELECT price, expire_date FROM servers WHERE is_hidden="false"').all(); let currentAsset = 0; for(const s of allS) { currentAsset += (calcServerAsset(s, nowMsForThrottle).amount || 0); } await mineAndGossip(Math.min(currentAsset, 100000000), allS.length); } catch(e) {} })()); }
        return new Response("OK", { status: 200 });
      } catch (e) { return new Response('Error', { status: 400 }); }
    }

    // ==========================================
    // 后台管理 API (/admin/api)
    // ==========================================
    if (request.method === 'POST' && url.pathname === '/admin/api') {
      if (!checkAuth(request)) return authResponse(sys.admin_title);
      try {
        const data = await request.json();
        if (data.action === 'save_settings') {
          for (const [k, v] of Object.entries(data.settings)) await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, v).run();
          globalThis.configCache = JSON.stringify({ INTERVAL: parseInt(data.settings.report_interval || '5'), CT: data.settings.ping_node_ct || 'default', CU: data.settings.ping_node_cu || 'default', CM: data.settings.ping_node_cm || 'default' }); 
          ctx.waitUntil(caches.default.delete(new Request(`${host}/config.json`)));
          return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        } 
        else if (data.action === 'add') {
          await env.DB.prepare(`INSERT INTO servers (id, name, cpu, ram, disk, load_avg, uptime, last_updated, ram_total, net_rx, net_tx, net_in_speed, net_out_speed, os, cpu_info, arch, boot_time, ram_used, swap_total, swap_used, disk_total, disk_used, processes, tcp_conn, udp_conn, country, ip_v4, ip_v6, server_group, price, expire_date, bandwidth, traffic_limit, ping_ct, ping_cu, ping_cm, ping_bd, monthly_rx, monthly_tx, last_rx, last_tx, reset_month, agent_os, history, is_hidden) VALUES (?, ?, '0', '0', '0', '0', '0', 0, '0', '0', '0', '0', '0', '', '', '', '', '0', '0', '0', '0', '0', '0', '0', '0', '', '0', '0', '默认分组', '免费', '', '', '', '0', '0', '0', '0', '0', '0', '0', '0', '', ?, '{}', 'false')`).bind(crypto.randomUUID(), data.name || 'New Server', data.agent_os || 'debian').run();
          return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        } 
        else if (data.action === 'delete') { await env.DB.prepare('DELETE FROM servers WHERE id = ?').bind(data.id).run(); return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } }); } 
        else if (data.action === 'edit') { await env.DB.prepare(`UPDATE servers SET name = ?, server_group = ?, price = ?, expire_date = ?, bandwidth = ?, traffic_limit = ?, agent_os = ?, is_hidden = ? WHERE id = ?`).bind(data.name || 'Unnamed', data.server_group || '默认分组', data.price || '', data.expire_date || '', data.bandwidth || '', data.traffic_limit || '', data.agent_os || 'debian', data.is_hidden || 'false', data.id).run(); return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } }); }
        else if (data.action === 'send_tx') {
          const amountNum = parseFloat(data.amount); if (!data.from || !data.to || !amountNum || amountNum <= 0) throw new Error("Invalid amount/params");
          const wallet = await env.DB.prepare('SELECT balance FROM blockchain_wallets WHERE address = ?').bind(data.from).first(); if (!wallet || wallet.balance < amountNum) throw new Error("Insufficient balance");
          const txData = { id: crypto.randomUUID(), type: 'TRANSFER', from: data.from, to: data.to, amount: amountNum, timestamp: getNetworkTime() };
          await env.DB.prepare(`INSERT OR IGNORE INTO mempool (tx_id, payload, timestamp) VALUES (?, ?, ?)`).bind(txData.id, JSON.stringify(txData), txData.timestamp).run();
          ctx.waitUntil((async () => { const { results: beacons } = await env.DB.prepare(`SELECT domain FROM blockchain_peers WHERE is_beacon IN ('true', '1') AND domain != ? ORDER BY reputation_score DESC LIMIT 4`).bind(host).all(); for (const b of beacons) fetchWithTimeSync(`${b.domain}/api/consensus/tx`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(txData) }, b.domain).catch(() => {}); })());
          return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        }
        else if (data.action === 'save_custom_theme') { const id = crypto.randomUUID(); await env.DB.prepare('INSERT INTO custom_themes (id, name, css) VALUES (?, ?, ?)').bind(id, data.name, data.css).run(); return new Response(JSON.stringify({ success: true, id }), { headers: { 'Content-Type': 'application/json' } }); }
        else if (data.action === 'delete_custom_theme') { await env.DB.prepare('DELETE FROM custom_themes WHERE id = ?').bind(data.id).run(); return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } }); }
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 400 }); }
    }

    if (request.method === 'GET' && url.pathname === '/api/server') {
      if (sys.is_public !== 'true' && !checkAuth(request)) return authResponse(sys.site_title);
      const server = await env.DB.prepare('SELECT * FROM servers WHERE id = ?').bind(url.searchParams.get('id')).first();
      if (!server || server.is_hidden === 'true') return new Response('Not Found', { status: 404 });
      return new Response(JSON.stringify(server), { headers: { 'Content-Type': 'application/json' } });
    }

    // ==========================================
    // UI 模板引擎 (渲染 GitHub 远程资源)
    // ==========================================
    const renderHtmlWithInjection = async (targetModule, dynamicData) => {
        let htmlTemplate = modules[targetModule] ? await fetchRemoteAsset(modules[targetModule], ctx, 300) : `<h2>Error: Failed to load remote template ${targetModule}</h2>`;
        const themeCss = modules.theme_css ? await fetchRemoteAsset(modules.theme_css, ctx, 300) : '';
        
        let finalHtml = htmlTemplate
            .replace(/\{\{SITE_TITLE\}\}/g, sys.site_title)
            .replace(/\{\{ADMIN_TITLE\}\}/g, sys.admin_title)
            .replace(/\{\{THEME_STYLES\}\}/g, themeCss + '\n' + (sys.theme === 'theme6' ? (sys.custom_css || '') : ''))
            .replace(/\{\{CUSTOM_HEAD\}\}/g, sys.custom_head || '')
            .replace(/\{\{THEME_CLASS\}\}/g, sys.theme || 'theme1');
            
        // 将复杂 HTML 块直接注入
        for (const [key, value] of Object.entries(dynamicData)) {
            finalHtml = finalHtml.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
        }
        return finalHtml;
    };

    // 1. 后台管理路由
    if (request.method === 'GET' && url.pathname === '/admin') {
      if (!checkAuth(request)) return authResponse(sys.admin_title);
      
      const { results } = await env.DB.prepare('SELECT id, name, last_updated, server_group, price, expire_date, bandwidth, traffic_limit, agent_os, is_hidden FROM servers').all();
      let customThemes = []; try { const { results: themes } = await env.DB.prepare('SELECT id, name, css FROM custom_themes').all(); customThemes = themes || []; } catch(e) {}
      let walletBalance = 0; if (sys.miner_wallet) { try { const w = await env.DB.prepare('SELECT balance FROM blockchain_wallets WHERE address = ?').bind(sys.miner_wallet).first(); if (w) walletBalance = w.balance; } catch(e) {} }

      let trs = ''; const now = Date.now();
      if (results && results.length > 0) {
        for (const s of results) {
          const status = (now - s.last_updated) < OFFLINE_THRESHOLD ? '<span style="color:green; font-weight:bold;">在线</span>' : '<span style="color:red; font-weight:bold;">离线</span>';
          const hiddenBadge = s.is_hidden === 'true' ? '<span style="background:#64748b; color:white; padding:2px 6px; border-radius:4px; font-size:12px; margin-left:5px;">已隐藏</span>' : '';
          const osType = s.agent_os === 'alpine' ? 'alpine' : 'debian';
          const cmd = `curl -sL ${host}/install.sh?os=${osType} | ${osType === 'alpine' ? 'sh' : 'bash'} -s ${s.id} ${env.API_SECRET}`;
          trs += `<tr><td>${s.name} ${hiddenBadge}</td><td>${s.server_group || '默认分组'}</td><td><span style="background:#e2e8f0; color:#475569; padding:2px 6px; border-radius:4px; font-size:12px;">${osType}</span></td><td>${status}</td><td><input type="text" readonly value="${cmd}" style="width:260px; padding:6px; margin-right:5px; border:1px solid #ccc; border-radius:4px;" id="cmd-${s.id}"><button onclick="copyCmd('${s.id}')" class="btn btn-green">复制命令</button><button onclick="openEditModal('${s.id}', '${s.name}', '${s.server_group||''}', '${s.price||''}', '${s.expire_date||''}', '${s.bandwidth||''}', '${s.traffic_limit||''}', '${osType}', '${s.is_hidden||'false'}')" class="btn btn-blue">✏️ 编辑</button><button onclick="deleteServer('${s.id}')" class="btn btn-red">🗑️ 删除</button></td></tr>`;
        }
      }

      const adminHtml = await renderHtmlWithInjection('admin_html', { 
          TABLE_ROWS: trs || '<tr><td colspan="5" style="text-align:center; padding: 30px; color:#666;">暂无服务器，请在上方添加</td></tr>',
          WALLET_BALANCE: walletBalance,
          INJECT_SYS_CONFIG: `<script>window.__SYS_CONFIG__ = ${JSON.stringify(sys)}; window.__CUSTOM_THEMES__ = ${JSON.stringify(customThemes)};</script>`
      });
      return new Response(adminHtml, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    }

    // 2. 前台大盘路由
    if (request.method === 'GET' && url.pathname === '/') {
      if (sys.is_public !== 'true' && !checkAuth(request)) return authResponse(sys.site_title);
      
      const viewId = url.searchParams.get('id');
      if (viewId) {
          const server = await env.DB.prepare('SELECT * FROM servers WHERE id = ?').bind(viewId).first();
          if (!server || server.is_hidden === 'true') return new Response('Server not found', { status: 404 });
          const detailHtml = await renderHtmlWithInjection('detail_html', { INJECT_SERVER_DATA: `<script>window.__SERVER_DATA__ = ${JSON.stringify(server)};</script>` });
          return new Response(detailHtml, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
      }

      // -- 统计与列表渲染 --
      let { results } = await env.DB.prepare('SELECT * FROM servers').all();
      results = results.filter(s => s.is_hidden !== 'true');
      const now = Date.now();

      let globalSpeedIn = 0; let globalSpeedOut = 0; let globalNetTx = 0; let globalNetRx = 0; let totalAsset = 0; let remAsset = 0;
      const groups = {}; const countryStats = {}; 
      const getColor = (ping) => { const p = parseInt(ping); if (p === 0 || isNaN(p)) return '#9ca3af'; if (p < 100) return '#10b981'; if (p < 200) return '#f59e0b'; return '#ef4444'; };

      if (results && results.length > 0) {
        for (const server of results) {
          if ((now - server.last_updated) < OFFLINE_THRESHOLD) { globalSpeedIn += parseFloat(server.net_in_speed) || 0; globalSpeedOut += parseFloat(server.net_out_speed) || 0; }
          const rx_val = sys.auto_reset_traffic === 'true' ? parseFloat(server.monthly_rx || 0) : parseFloat(server.net_rx || 0); const tx_val = sys.auto_reset_traffic === 'true' ? parseFloat(server.monthly_tx || 0) : parseFloat(server.net_tx || 0); globalNetTx += tx_val; globalNetRx += rx_val;
          const { amount, remValue } = calcServerAsset(server, now); totalAsset += amount; remAsset += remValue; server._remValue = remValue; server._amount = amount;
          const grpName = server.server_group || '默认分组'; if (!groups[grpName]) groups[grpName] = []; groups[grpName].push(server);
          let cCodeMap = (server.country || 'xx').toUpperCase(); if (cCodeMap === 'TW') cCodeMap = 'CN'; if (cCodeMap !== 'XX') countryStats[cCodeMap] = (countryStats[cCodeMap] || 0) + 1;
        }
      }

      let localRank = 1; let globalNetAsset = totalAsset; let globalProposer = '--'; let currentHeight = 0; let activeBeacons = 0; let globalNodes = 1; let pendingTxsCount = 0; let rankTableHtml = '';
      try {
          const activeThreshold = Date.now() - 86400000; 
          const { results: rankList } = await env.DB.prepare('SELECT domain, vps_count, total_asset, last_seen, wallet_address FROM blockchain_peers WHERE is_beacon IN ("true", "1") AND last_seen > ?').bind(activeThreshold).all();
          let higherCount = 0; let otherAssets = 0; let walletBalances = {}; try { const { results: wBals } = await env.DB.prepare('SELECT address, balance FROM blockchain_wallets').all(); wBals.forEach(w => walletBalances[w.address] = w.balance); } catch(e) {}
          let sortedPeers = [...rankList]; sortedPeers.sort((a, b) => { let aA = Math.min(parseFloat(a.total_asset)||0, 500000); let aB = Math.min(parseFloat(b.total_asset)||0, 500000); if (aB !== aA) return aB - aA; return a.domain > b.domain ? 1 : -1; });
          sortedPeers.forEach((p, idx) => {
              let pAsset = Math.min(parseFloat(p.total_asset)||0, 500000); let isMe = p.domain === host; let ls = new Date(p.last_seen + 8*3600000).toISOString().replace('T',' ').substring(5,16); 
              let dCycle = p.wallet_address && walletBalances[p.wallet_address] ? walletBalances[p.wallet_address].toFixed(2) : '0.00';
              let cycleHtml = p.wallet_address ? `<a href="javascript:void(0)" onclick="searchBalance('${p.wallet_address}'); document.getElementById('rankModal').style.display='none'; switchView('block');" style="color:#8b5cf6;text-decoration:none;">${dCycle}</a>` : `<span style="color:#9ca3af;">0.00</span>`;
              rankTableHtml += `<tr style="${isMe ? 'background: rgba(59, 130, 246, 0.1); font-weight: bold;' : ''}"><td>${idx + 1}</td><td style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${p.domain}">${p.domain}</td><td>${p.vps_count || 0}</td><td style="color:#10b981;font-weight:bold;">${pAsset.toFixed(2)}</td><td style="font-weight:bold;">${cycleHtml}</td><td>${ls}</td></tr>`;
          });
          for (const p of rankList) { if (p.domain !== host) { let pAsset = Math.min(parseFloat(p.total_asset) || 0, 500000); otherAssets += pAsset; if (pAsset > totalAsset + 0.001) higherCount++; else if (Math.abs(pAsset - totalAsset) <= 0.001) if (p.domain > host) higherCount++; } }
          localRank = higherCount + 1; globalNetAsset = totalAsset + otherAssets;
          const topBlock = await env.DB.prepare('SELECT slot_id FROM blockchain_ledger WHERE status = 1 ORDER BY slot_id DESC LIMIT 1').first();
          if (topBlock) { const finalizedBlock = await env.DB.prepare('SELECT slot_id, proposer_domain FROM blockchain_ledger WHERE slot_id <= ? AND status = 1 ORDER BY slot_id DESC LIMIT 1').bind(Math.max(1, topBlock.slot_id - FINALITY_DEPTH)).first(); if (finalizedBlock) { currentHeight = finalizedBlock.slot_id; globalProposer = finalizedBlock.proposer_domain.replace('https://', ''); } }
          const bCountRow = await env.DB.prepare('SELECT count(*) as c FROM blockchain_peers WHERE is_beacon IN ("true", "1") AND last_seen > ?').bind(activeThreshold).first(); activeBeacons = bCountRow ? bCountRow.c : 0;
          const nCountRow = await env.DB.prepare('SELECT count(*) as c FROM blockchain_peers WHERE last_seen > ?').bind(activeThreshold).first(); globalNodes = nCountRow && nCountRow.c > 0 ? nCountRow.c : 1;
          const mCount = await env.DB.prepare('SELECT count(*) as c FROM mempool').first(); pendingTxsCount = mCount ? mCount.c : 0;
      } catch(e) {}

      let filterTagsHtml = `<span class="filter-tag" data-code="all" onclick="setFilter('all')">全部 ${results.length}</span>`;
      for (const [code, count] of Object.entries(countryStats)) filterTagsHtml += `<span class="filter-tag" data-code="${code.toLowerCase()}" onclick="setFilter('${code.toLowerCase()}')"><img src="https://flagcdn.com/16x12/${code.toLowerCase()}.png" alt="${code}"> ${code} ${count}</span>`;

      let cardContentHtml = ''; let tableBodyHtml = '';
      if (Object.keys(groups).length === 0) { cardContentHtml = '<p style="text-align:center; width: 100%; color:#888;">暂无公开服务器</p>'; } 
      else {
        for (const [grpName, grpServers] of Object.entries(groups)) {
          cardContentHtml += `<div class="group-header">${grpName}</div><div class="grid-container">`;
          for (const server of grpServers) {
            const isOnline = (now - server.last_updated) < OFFLINE_THRESHOLD; const statusColor = isOnline ? '#10b981' : '#ef4444'; 
            const cpu = parseFloat(server.cpu || '0').toFixed(1); const ram = parseFloat(server.ram || '0').toFixed(1); const disk = parseFloat(server.disk || '0').toFixed(1);
            const cCode = (server.country || 'xx').toLowerCase(); const flagHtml = cCode !== 'xx' ? `<img src="https://flagcdn.com/24x18/${cCode}.png" alt="${cCode}" style="vertical-align: sub; margin-right: 5px; border-radius: 2px;">` : '🏳️';
            
            let metaHtml = '';
            if (sys.show_price === 'true') metaHtml += `<div class="card-meta" style="margin-top:8px;">价格: ${server.price || '免费'}${sys.show_asset === 'true' && server._amount > 0 ? ` <span style="color:#8b5cf6;font-weight:600;margin-left:8px;">剩余价值: ${server._remValue.toFixed(2)}${sys.asset_currency || '元'}</span>` : ''}</div>`;
            if (sys.show_expire === 'true') { let expireText = '永久'; if (server.expire_date) { const diff = new Date(server.expire_date).getTime() - now; expireText = diff > 0 ? Math.ceil(diff / 86400000) + ' 天' : '已过期'; } metaHtml += `<div class="card-meta" style="${sys.show_price !== 'true' ? 'margin-top:8px;' : ''}">剩余天数: ${expireText}</div>`; }
            metaHtml += `<div class="card-meta" style="${sys.show_price !== 'true' && sys.show_expire !== 'true' ? 'margin-top:8px;' : ''}">流量: <span style="color:#10b981">↓</span> ${formatBytes(sys.auto_reset_traffic === 'true' ? parseFloat(server.monthly_rx || 0) : parseFloat(server.net_rx || 0))} | <span style="color:#3b82f6">↑</span> ${formatBytes(sys.auto_reset_traffic === 'true' ? parseFloat(server.monthly_tx || 0) : parseFloat(server.net_tx || 0))}</div>`;
            metaHtml += `<div class="card-meta" style="margin-top:2px;">在线: ${(server.uptime || '-').replace('days','天')} | 更新: ${Math.round((now - server.last_updated) / 1000)}s前</div>`;

            let badgesHtml = '';
            if (sys.show_bw === 'true' && server.bandwidth) badgesHtml += `<span class="badge badge-bw">${server.bandwidth}</span>`;
            if (sys.show_tf === 'true' && server.traffic_limit) badgesHtml += `<span class="badge badge-tf">${server.traffic_limit}</span>`;
            if (server.ip_v4 === '1') badgesHtml += `<span class="badge badge-v4">IPv4</span>`; if (server.ip_v6 === '1') badgesHtml += `<span class="badge badge-v6">IPv6</span>`;

            cardContentHtml += `<a href="/?id=${server.id}" class="vps-card" data-country="${cCode}"><div class="card-left"><div class="card-title"><div class="status-dot" style="background:${statusColor};"></div>${flagHtml} <span style="font-size:15px;" class="card-title-text">${server.name}</span></div>${metaHtml}<div class="card-badges">${badgesHtml}</div><div class="ping-box"><span>电信 <span style="color:${getColor(server.ping_ct)}; font-weight:bold;">${server.ping_ct === '0' ? '超时' : server.ping_ct + 'ms'}</span></span><span>联通 <span style="color:${getColor(server.ping_cu)}; font-weight:bold;">${server.ping_cu === '0' ? '超时' : server.ping_cu + 'ms'}</span></span><span>移动 <span style="color:${getColor(server.ping_cm)}; font-weight:bold;">${server.ping_cm === '0' ? '超时' : server.ping_cm + 'ms'}</span></span><span>字节 <span style="color:${getColor(server.ping_bd)}; font-weight:bold;">${server.ping_bd === '0' ? '超时' : server.ping_bd + 'ms'}</span></span></div></div><div class="card-right"><div class="stat-group"><div class="stat-header"><span>CPU</span><span>${cpu}%</span></div><div class="stat-bar-full"><div style="width:${cpu}%; background:${cpu > 80 ? '#ef4444' : '#3b82f6'};"></div></div><div class="stat-subtext">${server.cpu_info || '-'}</div></div><div class="stat-group"><div class="stat-header"><span>内存</span><span>${ram}%</span></div><div class="stat-bar-full"><div style="width:${ram}%; background:${ram > 80 ? '#ef4444' : '#10b981'};"></div></div><div class="stat-subtext">${formatBytes((parseFloat(server.ram_used || 0) * 1048576).toString())} / ${formatBytes((parseFloat(server.ram_total || 0) * 1048576).toString())}</div></div><div class="stat-group"><div class="stat-header"><span>存储</span><span>${disk}%</span></div><div class="stat-bar-full"><div style="width:${disk}%; background:${disk > 80 ? '#ef4444' : '#10b981'};"></div></div><div class="stat-subtext">${formatBytes((parseFloat(server.disk_used || 0) * 1048576).toString())} / ${formatBytes((parseFloat(server.disk_total || 0) * 1048576).toString())}</div></div><div style="display:flex; justify-content:space-between; font-size:11px; color:#888; margin-top:2px;"><div>${server.os || '-'} | ${server.arch || '-'}</div><div>TCP/UDP: ${server.tcp_conn || '0'} / ${server.udp_conn || '0'}</div></div><div style="display:flex; justify-content:space-between; font-size:11px; color:#888; margin-top:4px; gap:8px;"><div>↓ ${formatBytes(server.net_in_speed)}/s</div><div>↑ ${formatBytes(server.net_out_speed)}/s</div></div></div></a>`;

            tableBodyHtml += `<tr onclick="window.location.href='/?id=${server.id}'" style="cursor:pointer;" data-country="${cCode}"><td style="text-align:center;"><div class="status-dot" style="background:${statusColor}; display:inline-block; margin:0;"></div></td><td><b>${server.name}</b></td><td>${flagHtml}</td><td><span class="os-text">${server.os || '-'}</span></td><td><div style="display:flex; align-items:center; gap:8px;"><div class="stat-bar" style="width:50px; margin:0;"><div style="width:${cpu}%; background:#3b82f6;"></div></div><span>${cpu}%</span></div></td><td><div style="display:flex; align-items:center; gap:8px;"><div class="stat-bar" style="width:50px; margin:0;"><div style="width:${ram}%; background:#10b981;"></div></div><span>${ram}%</span></div></td><td><div style="display:flex; align-items:center; gap:8px;"><div class="stat-bar" style="width:50px; margin:0;"><div style="width:${disk}%; background:#10b981;"></div></div><span>${disk}%</span></div></td><td>${formatBytes(sys.auto_reset_traffic === 'true' ? parseFloat(server.monthly_rx || 0) : parseFloat(server.net_rx || 0))} | ${formatBytes(sys.auto_reset_traffic === 'true' ? parseFloat(server.monthly_tx || 0) : parseFloat(server.net_tx || 0))}</td><td>${formatBytes(server.net_in_speed)}/s</td><td>${formatBytes(server.net_out_speed)}/s</td><td>${Math.round((now - server.last_updated)/1000)} 秒前</td></tr>`;
          }
          cardContentHtml += `</div>`;
        }
      }

      let richListRows = ''; try { const { results: rList } = await env.DB.prepare('SELECT address, balance FROM blockchain_wallets ORDER BY balance DESC LIMIT 10').all(); rList.forEach((r, idx) => { richListRows += `<tr><td>#${idx+1} <a href="javascript:void(0)" onclick="searchBalance('${r.address}')" style="color:#3b82f6; text-decoration:none; font-family:monospace;">${r.address.length > 15 ? r.address.substring(0,8) + '...' + r.address.slice(-6) : r.address}</a></td><td style="text-align:right; font-weight:bold; color:#10b981;">${r.balance.toFixed(2)} Cycle</td></tr>`; }); } catch(e) {}
      let blockExplorerRows = ''; try { const { results: recentBlocks } = await env.DB.prepare('SELECT * FROM blockchain_ledger WHERE status = 1 ORDER BY slot_id DESC LIMIT 50').all(); for (const b of recentBlocks) { let txsHtml = `<span style="color:#94a3b8;">0 Txs</span>`; try { const bPayload = JSON.parse(b.payload); if (bPayload.txs && bPayload.txs.length > 0) txsHtml = `<a href="javascript:void(0)" onclick="showBlockTxs('${JSON.stringify(bPayload.txs).replace(/'/g, "&#39;").replace(/"/g, "&quot;")}')" style="color:#8b5cf6; font-weight:bold; text-decoration:underline;">${bPayload.txs.length} Txs</a>`; } catch(e) {} blockExplorerRows += `<tr><td><b style="color:#10b981;"># ${b.slot_id}</b></td><td><span style="color:#3b82f6;">${b.proposer_domain.replace('https://','')}</span></td><td style="font-family:monospace; font-size:11px;">${b.block_hash}</td><td>${b.total_difficulty || 0}</td><td>${txsHtml}</td><td>${new Date((b.timestamp || getNetworkTime()) + 8*3600000).toISOString().replace('T',' ').substring(0, 19)}</td></tr>`; } } catch(e){}

      if (url.searchParams.get('ajax') === '1') {
          return new Response(`<div id="ajax-stats-payload" data-rank="${localRank}" data-net-asset="${(globalNetAsset || 0).toFixed(2)}" data-proposer="${globalProposer}" data-height="${currentHeight}" data-beacons="${activeBeacons}" data-nodes="${globalNodes}" data-pending-txs="${pendingTxsCount}" style="display:none;"></div><div id="ajax-stats" style="display:none;"><div class="g-item"><div class="g-label">本站服务器总数</div><div class="g-val">${results.length}</div></div>${sys.show_asset === 'true' ? `<div class="g-item"><div class="g-label">本站数字资产</div><div class="g-val">${(totalAsset||0).toFixed(2)} | ${(remAsset||0).toFixed(2)}</div></div>` : ''}<div class="g-item"><div class="g-label">总计流量</div><div class="g-val">${formatBytes(globalNetRx)} | ${formatBytes(globalNetTx)}</div></div><div class="g-item"><div class="g-label">实时网速</div><div class="g-val">↓ ${formatBytes(globalSpeedIn)}/s | ↑ ${formatBytes(globalSpeedOut)}/s</div></div></div><div id="ajax-filters" style="display:none;">${filterTagsHtml}</div><div id="ajax-cards">${cardContentHtml}</div><tbody id="ajax-table" style="display:none;">${tableBodyHtml || '<tr><td>暂无数据</td></tr>'}</tbody><tbody id="ajax-blocks" style="display:none;">${blockExplorerRows}</tbody><tbody id="ajax-richlist" style="display:none;">${richListRows}</tbody><tbody id="ajax-ranklist" style="display:none;">${rankTableHtml}</tbody><script id="map-data" type="application/json">${JSON.stringify(countryStats)}</script>`, { headers: { 'Content-Type': 'text/html' } });
      }

      const indexHtml = await renderHtmlWithInjection('index_html', {
          CARDS_HTML: cardContentHtml, TABLE_HTML: tableBodyHtml, FILTERS_HTML: filterTagsHtml, BLOCKS_HTML: blockExplorerRows, RICHLIST_HTML: richListRows, RANKLIST_HTML: rankTableHtml, MAP_DATA: JSON.stringify(countryStats), GLOBAL_NET_ASSET: (globalNetAsset || 0).toFixed(2), PENDING_TXS: pendingTxsCount, LOCAL_RANK: localRank, PROPOSER: globalProposer, HEIGHT: currentHeight, BEACONS: activeBeacons, NODES: globalNodes, TOTAL_VPS: results.length, TOTAL_RX: formatBytes(globalNetRx), TOTAL_TX: formatBytes(globalNetTx)
      });
      return new Response(indexHtml, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    }

    // 3. 一键安装脚本路由
    if (request.method === 'GET' && url.pathname === '/install.sh') {
      const osType = url.searchParams.get('os') || 'debian';
      let rawScript = modules.install_sh ? await fetchRemoteAsset(modules.install_sh, ctx, 3600) : `#!/bin/bash\necho "Error: Remote script fetch failed."`;

      rawScript = rawScript
        .replace(/\{\{SERVER_ID\}\}/g, '$1').replace(/\{\{SECRET\}\}/g, '$2').replace(/\{\{WORKER_URL\}\}/g, `${host}/update`).replace(/\{\{STATIC_URL\}\}/g, `${host}/config.json`).replace(/\{\{REPORT_INTERVAL\}\}/g, sys.report_interval || '40').replace(/\{\{PING_NODE_CT\}\}/g, sys.ping_node_ct || 'default').replace(/\{\{PING_NODE_CU\}\}/g, sys.ping_node_cu || 'default').replace(/\{\{PING_NODE_CM\}\}/g, sys.ping_node_cm || 'default');

      const daemonScript = osType === 'alpine' 
        ? `cat << 'EOF' > /etc/init.d/cf-probe\n#!/sbin/openrc-run\nname="cf-probe"\ncommand="/usr/local/bin/cf-probe.sh"\ncommand_background="yes"\npidfile="/run/cf-probe.pid"\nEOF\nchmod +x /etc/init.d/cf-probe\nrc-update add cf-probe default\nrc-service cf-probe restart\necho "✅ Alpine 探针安装成功！"\n`
        : `cat << EOF > /etc/systemd/system/cf-probe.service\n[Unit]\nDescription=Cloudflare Worker Probe Agent\nAfter=network.target\n[Service]\nExecStart=/usr/local/bin/cf-probe.sh\nRestart=always\nUser=root\n[Install]\nWantedBy=multi-user.target\nEOF\nsystemctl daemon-reload\nsystemctl enable cf-probe.service\nsystemctl restart cf-probe.service\necho "✅ Linux 探针安装成功！"\n`;

      return new Response(rawScript + '\n' + daemonScript, { headers: { 'Content-Type': 'text/plain;charset=UTF-8' } });
    }

    return new Response('Not Found', { status: 404 });
  }
};
