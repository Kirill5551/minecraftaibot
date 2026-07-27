const mineflayer = require('mineflayer');
const { plugin: collectBlock } = require('mineflayer-collectblock');
const pathfinder = require('mineflayer-pathfinder').pathfinder;
const Movements = require('mineflayer-pathfinder').Movements;
const { goals: { GoalBlock, GoalFollow, GoalGetToBlock } } = require('mineflayer-pathfinder');

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

const PORT = 3000;
let bots = []; // Массив для хранения всех запущенных ботов роя
let manualDisconnect = false; 
let isLooping = false; 
let autoReconnectEnabled = true;
let reconnectAttempts = 0;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Mineflayer Swarm Dashboard</title>
            <script src="/socket.io/socket.io.js"></script>
            <style>
                :root {
                    --bg-main: #0f172a;
                    --bg-card: #1e293b;
                    --bg-terminal: #090d16;
                    --border: #334155;
                    --text-main: #f8fafc;
                    --text-muted: #64748b;
                    --accent: #38bdf8;
                    --success: #10b981;
                    --danger: #ef4444;
                }
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body { 
                    font-family: 'Segoe UI', system-ui, sans-serif; 
                    background: var(--bg-main); 
                    color: var(--text-main); 
                    padding: 20px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                }
                .container { width: 100%; max-width: 950px; display: flex; flex-direction: column; gap: 16px; }
                .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
                .grid-flex { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
                .input-group { display: flex; flex-direction: column; gap: 4px; flex-grow: 1; }
                .input-group label { font-size: 0.7rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
                input[type="text"], input[type="number"], select { 
                    width: 100%; padding: 8px 12px; background: #0f172a; border: 1px solid var(--border); 
                    color: var(--text-main); border-radius: 6px; font-size: 0.9rem; transition: border-color 0.2s;
                    height: 36px;
                }
                input:focus, select:focus { border-color: var(--accent); outline: none; }
                .checkbox-group { display: flex; align-items: center; gap: 8px; height: 36px; user-select: none; cursor: pointer; color: var(--text-main); font-size: 0.9rem; }
                button { 
                    padding: 8px 16px; background: var(--success); border: none; color: #fff; border-radius: 6px; 
                    font-size: 0.9rem; font-weight: 500; cursor: pointer; white-space: nowrap; height: 36px; transition: opacity 0.2s;
                }
                button:hover { opacity: 0.9; }
                button.btn-danger { background: var(--danger); }
                .status-line { margin-top: 15px; font-size: 0.85rem; color: var(--text-muted); display: flex; gap: 12px; align-items: center; }
                
                .terminal-card { background: var(--bg-terminal); border: 1px solid var(--border); border-radius: 10px; padding: 15px; display: flex; flex-direction: column; gap: 10px; }
                #chat { height: 450px; overflow-y: auto; font-family: 'Courier New', Courier, monospace; font-size: 0.95rem; line-height: 1.6; padding-right: 5px; }
                .terminal-input-row { display: flex; background: #111827; border: 1px solid var(--border); border-radius: 6px; padding: 4px 10px; align-items: center; gap: 8px; }
                .terminal-prefix { font-family: monospace; color: var(--accent); font-weight: bold; font-size: 1.1rem; user-select: none; }
                #cmd { background: transparent; border: none; padding: 6px 0; font-family: 'Courier New', monospace; font-size: 1rem; color: #fff; width: 100%; }
                #cmd:focus { outline: none; }
                ::-webkit-scrollbar { width: 6px; }
                ::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="card">
                    <div class="grid-flex">
                        <div class="input-group" style="flex-grow: 1; max-width: 130px;">
                            <label>Mode</label>
                            <select id="mode" onchange="changeMode(this.value)">
                                <option value="single">Single</option>
                                <option value="multiple">Multiple</option>
                            </select>
                        </div>
                        <div class="input-group" style="flex-grow: 2;"><label>Server IP</label><input type="text" id="ip" value="localhost"></div>
                        <div class="input-group" style="flex-grow: 1; max-width: 100px;"><label>Port</label><input type="number" id="port" value="25565"></div>
                        <div class="input-group" style="flex-grow: 2;"><label>Bot Username</label><input type="text" id="username" value="WebBot"></div>
                        
                        <div class="input-group" id="count-group" style="display: none; flex-grow: 1; max-width: 100px;">
                            <label>Bot Count</label>
                            <input type="number" id="bot_count" value="3" min="1" max="100">
                        </div>

                        <div class="checkbox-group">
                            <input type="checkbox" id="reconnect" checked onchange="toggleReconnect(this.checked)">
                            <label for="reconnect" style="cursor:pointer; font-size:0.9rem;">Auto-reconnect</label>
                        </div>
                    </div>
                    <!-- Строка 3: Кнопки, Статус и новый Чекбокс Задержки -->
                    <div class="status-line">
                        <button class="btn-danger" onclick="disconnectBot()">Disconnect</button>
                        <button onclick="connectBot()">Connect</button>
                        
                        <div class="checkbox-group" id="delay-group" style="display: none; margin-left: 10px;">
                            <input type="checkbox" id="delay_connect" checked>
                            <label for="delay_connect" style="cursor:pointer; font-size:0.9rem; color:var(--text-main);">Delay (3000ms)</label>
                        </div>

                        <div style="margin-left: auto;">Status: <span id="status" style="font-weight: 600; color: var(--danger);">Disconnected</span></div>
                    </div>
                </div>

                <div class="terminal-card">
                    <div id="chat">
                        <div style="color: var(--text-muted);">=== Mineflayer Swarm Interactive CLI Terminal ===</div>
                        <div style="color: var(--text-muted);">Type "help" to see available commands and usage.</div>
                    </div>
                    <div class="terminal-input-row">
                        <span class="terminal-prefix">&gt;</span>
                        <input type="text" id="cmd" placeholder="Enter command for swarm..." autocomplete="off">
                    </div>
                </div>
            </div>

            <script>
                const socket = io();
                const cmdHistory = [];
                let historyIndex = -1;

                function changeMode(mode) {
                    const usernameInput = document.getElementById('username');
                    const countGroup = document.getElementById('count-group');
                    const delayGroup = document.getElementById('delay-group');
                    let currentName = usernameInput.value;

                    if (mode === 'single') {
                        countGroup.style.display = 'none';
                        delayGroup.style.display = 'none';
                        if (currentName.includes('{index}')) {
                            usernameInput.value = currentName.replace('{index}', '').trim();
                        }
                        printToTerminal('info', '[System] Switched to Single.');
                    } else if (mode === 'multiple') {
                        countGroup.style.display = 'flex';
                        delayGroup.style.display = 'flex';
                        if (!currentName.includes('{index}')) {
                            usernameInput.value = currentName + '{index}';
                        }
                        printToTerminal('info', '[System] Switched to Multiple.');
                    }
                }

                function connectBot() {
                    const mode = document.getElementById('mode').value;
                    const ip = document.getElementById('ip').value;
                    const port = parseInt(document.getElementById('port').value);
                    const username = document.getElementById('username').value;
                    const count = parseInt(document.getElementById('bot_count').value) || 1;
                    const delayEnabled = document.getElementById('delay_connect').checked;

                    socket.emit('bot_connect', { mode, ip, port, username, count, delayEnabled });
                }

                function disconnectBot() { socket.emit('bot_disconnect'); }
                function toggleReconnect(val) { socket.emit('toggle_reconnect', val); }

                const cmdInput = document.getElementById('cmd');
                cmdInput.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') {
                        const val = this.value.trim();
                        if (val !== "") {
                            socket.emit('bot_terminal_cmd', val);
                            if (cmdHistory.length === 0 || cmdHistory[cmdHistory.length - 1] !== val) {
                                cmdHistory.push(val);
                            }
                            historyIndex = cmdHistory.length;
                            this.value = "";
                        }
                    } else if (e.key === 'ArrowUp') {
                        if (cmdHistory.length > 0 && historyIndex > 0) {
                            historyIndex--;
                            this.value = cmdHistory[historyIndex];
                            setTimeout(() => this.setSelectionRange(this.value.length, this.value.length), 0);
                        }
                        e.preventDefault();
                    } else if (e.key === 'ArrowDown') {
                        if (historyIndex < cmdHistory.length - 1) {
                            historyIndex++;
                            this.value = cmdHistory[historyIndex];
                        } else {
                            historyIndex = cmdHistory.length;
                            this.value = "";
                        }
                        e.preventDefault();
                    }
                });

                function printToTerminal(type, msg) {
                    const chatDiv = document.getElementById('chat');
                    let style = 'color: #ffffff;';
                    if (type === 'error') style = 'color: var(--danger); font-weight:600;';
                    else if (type === 'help') style = 'color: #e2e8f0; font-style: italic;';
                    else if (type === 'cmd') style = 'color: #ffffff; font-weight: 500;';
                    chatDiv.innerHTML += '<div style="' + style + '">' + msg + '</div>';
                    chatDiv.scrollTop = chatDiv.scrollHeight;
                }

                socket.on('status', data => {
                    const text = document.getElementById('status');
                    text.innerText = data.text;
                    if (data.connected) text.style.color = 'var(--success)';
                    else if (data.text.includes('Reconnect') || data.text.includes('Connecting')) text.style.color = '#ff9800';
                    else text.style.color = 'var(--danger)';
                });
                
                socket.on('terminal_log', data => {
                    printToTerminal(data.type, data.message);
                });
            </script>
        </body>
        </html>
    `);
});
let countdownInterval = null; 
let actionAttempts = 0; 
let currentActiveCommand = null; 
let connectionConfig = null; 

process.on('uncaughtException', (err) => {
    console.error('Intercepted crash:', err);
    isLooping = false;
    bots.forEach(b => { if (b && b.pathfinder) b.pathfinder.setGoal(null); });
    io.emit('terminal_log', { type: 'error', message: `[Critical Error] Intercepted crash: ${err.message || 'Block interaction failed.'}` });
    io.emit('terminal_log', { type: 'info', message: '[Bot] Swarm goals resetted.' });
});

// Каскадная функция запуска ботов (учитывает статус чекбокса Delay)
async function startSwarm(data, socket) {
    if (bots.length > 0) return;
    manualDisconnect = false;
    connectionConfig = data;

    if (data.mode === 'multiple' && !data.username.includes('{index}')) {
        io.emit('terminal_log', { type: 'error', message: '[Error] You need add {index} tag to bot name if you run in multiple mode.' });
        io.emit('status', { connected: false, text: 'Disconnected' });
        return;
    }

    io.emit('status', { connected: false, text: 'Connecting...' });
    const count = data.mode === 'single' ? 1 : data.count;

    for (let i = 0; i < count; i++) {
        if (manualDisconnect) break;

        const currentName = data.mode === 'single' 
            ? data.username 
            : data.username.replace('{index}', (i + 1));

        io.emit('terminal_log', { type: 'info', message: `[System] Spawning bot: ${currentName}...` });
        
        const newBot = mineflayer.createBot({
            host: data.ip,
            port: data.port,
            username: currentName
        });

        newBot.loadPlugin(collectBlock);
        newBot.loadPlugin(pathfinder);

        const spawnPromise = new Promise((resolve) => {
            newBot.once('spawn', () => {
                io.emit('terminal_log', { type: 'info', message: `[System] Bot ${currentName} successfully joined.` });
                resolve(true);
            });
        });

        setupBotEvents(newBot, data, socket, i === 0);
        bots.push(newBot);

        await spawnPromise;

        // Делаем паузу, только если ботов больше одного И включен чекбокс Delay
        if (count > 1 && i < count - 1 && data.delayEnabled && !manualDisconnect) {
            io.emit('terminal_log', { type: 'info', message: `[System] Waiting 3000ms before next spawn...` });
            await sleep(3000);
        }
    }

    io.emit('status', { connected: true, text: 'Connected' });
}

function setupBotEvents(targetBot, data, socket, isFirstBot) {
    targetBot.on('end', () => {
        bots = bots.filter(b => b.username !== targetBot.username);
        isLooping = false;

        if (manualDisconnect) {
            if (bots.length === 0) {
                io.emit('status', { connected: false, text: 'Disconnected' });
                io.emit('terminal_log', { type: 'info', message: '[System] All bots disconnected.' });
            }
            return;
        }

        if (isFirstBot && autoReconnectEnabled) {
            bots.forEach(b => b.quit());
            bots = [];

            reconnectAttempts++;
            io.emit('terminal_log', { type: 'info', message: `[System] Connection lost. Reconnect attempt #${reconnectAttempts} of 5...` });

            if (reconnectAttempts >= 5) {
                reconnectAttempts = 0;
                io.emit('status', { connected: false, text: 'Disconnected' });
                io.emit('terminal_log', { type: 'error', message: '[Error] Failed to reconnect with 5 attempts!' });
            } else {
                let timeLeft = 5;
                io.emit('status', { connected: false, text: `Reconnect in ${timeLeft} seconds` });
                if (countdownInterval) clearInterval(countdownInterval);

                countdownInterval = setInterval(() => {
                    timeLeft--;
                    if (timeLeft > 0 && autoReconnectEnabled && !manualDisconnect && bots.length === 0) {
                        io.emit('status', { connected: false, text: `Reconnect in ${timeLeft} seconds` });
                    } else {
                        clearInterval(countdownInterval);
                        countdownInterval = null;
                        if (autoReconnectEnabled && !manualDisconnect && bots.length === 0) {
                            startSwarm(connectionConfig, socket);
                        }
                    }
                }, 1000);
            }
        } else if (bots.length === 0) {
            io.emit('status', { connected: false, text: 'Disconnected' });
        }
    });

    targetBot.on('error', (err) => {
        console.log(`Bot ${targetBot.username} Error:`, err.message);
        io.emit('terminal_log', { type: 'error', message: `[System Error] ${targetBot.username}: ${err.message || 'Unknown network error.'}` });
    });
}

io.on('connection', (socket) => {
    socket.emit('status', { connected: bots.length > 0, text: bots.length > 0 ? 'Connected' : 'Disconnected' });

    socket.on('toggle_reconnect', (val) => {
        autoReconnectEnabled = val;
        if (val) reconnectAttempts = 0;
    });

    socket.on('bot_connect', (data) => {
        reconnectAttempts = 0; 
        startSwarm(data, socket);
    });

    socket.on('bot_disconnect', () => {
        isLooping = false;
        manualDisconnect = true;
        reconnectAttempts = 0;
        actionAttempts = 0;
        currentActiveCommand = null;
        
        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
        
        bots.forEach(b => b.quit());
        bots = [];
        io.emit('status', { connected: false, text: 'Disconnected' });
        io.emit('terminal_log', { type: 'info', message: '[System] Swarm disconnected by user.' });
    });

    socket.on('bot_stop_loop', () => {
        isLooping = false;
        actionAttempts = 0;
        currentActiveCommand = null;
        bots.forEach(b => { if (b.pathfinder) b.pathfinder.setGoal(null); });
    });

    socket.on('bot_terminal_cmd', async (fullCommand) => {
        io.emit('terminal_log', { type: 'cmd', message: `> ${fullCommand}` });

        const args = fullCommand.trim().split(/\s+/);
        const command = args.toLowerCase();
        
        const commandSpecs = {
            'help': { min: 0, max: 0 },
            'stop': { min: 0, max: 0 },
            'mine': { min: 1, max: 1 },
            'find': { min: 1, max: 1 },
            'drop': { min: 1, max: 1 },
            'kill': { min: 1, max: 1 },
            'move': { min: 3, max: 3 }
        };

        if (!commandSpecs.hasOwnProperty(command)) {
            io.emit('terminal_log', { type: 'error', message: `[Error] '${command}' is not found!` });
            return;
        }

        const spec = commandSpecs[command];
        const providedArgsCount = args.length - 1;

        if (spec.min > 0 && providedArgsCount === 0) {
            io.emit('terminal_log', { type: 'error', message: `[Error] Arguments is missing!` });
            return;
        }

        if (providedArgsCount < spec.min) {
            const missingIndices = [];
            for (let i = providedArgsCount + 1; i <= spec.min; i++) {
                missingIndices.push(`#${i}`);
            }
            if (missingIndices.length === 1) {
                io.emit('terminal_log', { type: 'error', message: `[Error] Argument ${missingIndices} is missing!` });
            } else {
                io.emit('terminal_log', { type: 'error', message: `[Error] Arguments ${missingIndices.join(', ')} is missing!` });
            }
            return;
        }

        if (providedArgsCount > spec.max) {
            const extraIndices = [];
            for (let i = spec.max + 1; i <= providedArgsCount; i++) {
                extraIndices.push(`#${i}`);
            }
            if (extraIndices.length === 1) {
                io.emit('terminal_log', { type: 'error', message: `[Error] Extra argument ${extraIndices} detected!` });
            } else {
                io.emit('terminal_log', { type: 'error', message: `[Error] Extra arguments ${extraIndices.join(', ')} detected!` });
            }
            return;
        }

        if (command === 'help') {
            io.emit('terminal_log', { type: 'help', message: 'mine (block_name) - Sets swarm goal to mine block.' });
            io.emit('terminal_log', { type: 'help', message: 'find (block_name) - Sets swarm goal to walk to block.' });
            io.emit('terminal_log', { type: 'help', message: 'move (x) (y) (z) - Sets swarm goal to walk to position.' });
            io.emit('terminal_log', { type: 'help', message: 'drop (item_name) - Sets swarm goal to drop item.' });
            io.emit('terminal_log', { type: 'help', message: 'kill (mob_name) - Sets swarm goal to kill mob.' });
            io.emit('terminal_log', { type: 'help', message: 'stop - Resets swarm goals.' });
            return;
        }

        if (bots.length === 0) {
            io.emit('terminal_log', { type: 'error', message: '[Error] Swarm is offline. Connect bots first.' });
            return;
        }

        if (command === 'stop') {
            isLooping = false;
            actionAttempts = 0;
            currentActiveCommand = null;
            bots.forEach(b => { if (b.pathfinder) b.pathfinder.setGoal(null); });
            io.emit('terminal_log', { type: 'info', message: '[Bot] Swarm goals resetted.' });
            return;
        }

        actionAttempts = 0;
        currentActiveCommand = fullCommand;
        isLooping = false;
        await sleep(250); 
        isLooping = true;

        // Берем версию под первого зашедшего бота
        const mcData = require('minecraft-data')(bots[0].version);

        while (isLooping && bots.length > 0) {
            try {
                if (command === 'mine') {
                    const blockName = args.slice(1).join(' ').toLowerCase();
                    const blockType = mcData.blocksByName[blockName];
                    
                    if (!blockType) {
                        io.emit('terminal_log', { type: 'info', message: `[Bot] Not found ${blockName}.` });
                        io.emit('terminal_log', { type: 'info', message: '[Bot] Swarm goals resetted.' });
                        isLooping = false;
                        break;
                    }

                    // Синхронно отдаем приказ каждому живому боту в массиве
                    for (const botInstance of bots) {
                        const block = botInstance.findBlock({ matching: blockType.id, maxDistance: 32 });
                        if (block) {
                            const p = block.position;
                            io.emit('terminal_log', { type: 'info', message: `[Bot] ${botInstance.username} walking to ${blockName} on ${p.x} ${p.y} ${p.z}.` });
                            
                            try {
                                const defaultMovements = new Movements(botInstance, mcData);
                                botInstance.pathfinder.setMovements(defaultMovements);
                                await botInstance.pathfinder.goto(new GoalGetToBlock(p.x, p.y, p.z));
                                
                                if (!isLooping) break;
                                io.emit('terminal_log', { type: 'info', message: `[Bot] ${botInstance.username} mining ${blockName}.` });
                                await botInstance.collectBlock.collect(block);
                                actionAttempts = 0; 
                            } catch (mineError) {
                                actionAttempts++;
                                io.emit('terminal_log', { type: 'help', message: `[Bot Error] ${botInstance.username} failed. Retry attempt #${actionAttempts} of 5...` });
                                
                                if (actionAttempts >= 5) {
                                    io.emit('terminal_log', { type: 'error', message: `[Error] Swarm task failed after 5 attempts!` });
                                    io.emit('terminal_log', { type: 'info', message: '[Bot] Swarm goals resetted.' });
                                    isLooping = false;
                                    actionAttempts = 0;
                                    bots.forEach(b => { if (b.pathfinder) b.pathfinder.setGoal(null); });
                                    break;
                                } else {
                                    await sleep(1000);
                                }
                            }
                        } else {
                            io.emit('terminal_log', { type: 'info', message: `[Bot] ${botInstance.username} cannot find ${blockName} nearby.` });
                        }
                    }

                } else if (command === 'find') {
                    const blockName = args.slice(1).join(' ').toLowerCase();
                    const blockType = mcData.blocksByName[blockName];

                    if (!blockType) {
                        io.emit('terminal_log', { type: 'info', message: `[Bot] Not found ${blockName}.` });
                        io.emit('terminal_log', { type: 'info', message: '[Bot] Swarm goals resetted.' });
                        isLooping = false;
                        break;
                    }

                    for (const botInstance of bots) {
                        const block = botInstance.findBlock({ matching: blockType.id, maxDistance: 32 });
                        if (block) {
                            const p = block.position;
                            io.emit('terminal_log', { type: 'info', message: `[Bot] ${botInstance.username} walking to ${blockName} on ${p.x} ${p.y} ${p.z}.` });
                            
                            const defaultMovements = new Movements(botInstance, mcData);
                            botInstance.pathfinder.setMovements(defaultMovements);
                            botInstance.pathfinder.goto(new GoalGetToBlock(p.x, p.y, p.z)).catch(() => {});
                        }
                    }
                    await sleep(4000);

                } else if (command === 'move') {
                    const x = parseFloat(args[1]);
                    const y = parseFloat(args[2]);
                    const z = parseFloat(args[3]);

                    io.emit('terminal_log', { type: 'info', message: `[Bot] Swarm moving to target: ${x} ${y} ${z}.` });
                    
                    // Все боты бегут маршем в одну точку
                    for (const botInstance of bots) {
                        try {
                            const defaultMovements = new Movements(botInstance, mcData);
                            botInstance.pathfinder.setMovements(defaultMovements);
                            botInstance.pathfinder.goto(new GoalBlock(x, y, z)).catch(() => {});
                        } catch (e) {}
                    }
                    
                    isLooping = false;
                    break;
                }
                else if (command === 'drop') {
                    const itemName = args.slice(1).join(' ').toLowerCase();
                    io.emit('terminal_log', { type: 'info', message: `[Bot] Swarm dropping all ${itemName}...` });

                    for (const botInstance of bots) {
                        const item = botInstance.inventory.items().find(it => it.name === itemName);
                        if (item) {
                            await botInstance.tossStack(item);
                        }
                    }
                    await sleep(2000);

                } else if (command === 'kill') {
                    const mobName = args.slice(1).join(' ').toLowerCase();

                    for (const botInstance of bots) {
                        const target = botInstance.nearestEntity((entity) => {
                            return entity.name && entity.name.toLowerCase() === mobName && entity.username !== botInstance.username && entity.isValid; 
                        });

                        if (target) {
                            const weapon = botInstance.inventory.items().find(i => i.name.includes('sword') || i.name.includes('axe'));
                            if (weapon) await botInstance.equip(weapon, 'hand');

                            const attackRange = mobName === 'enderman' ? 4.0 : 3.5;
                            const defaultMovements = new Movements(botInstance, mcData);
                            botInstance.pathfinder.setMovements(defaultMovements);

                            const p = target.position;
                            io.emit('terminal_log', { type: 'info', message: `[Bot] ${botInstance.username} hunting ${mobName} on ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}.` });

                            while (target && target.isValid && botInstance.health > 0 && isLooping) {
                                const distance = botInstance.entity.position.distanceTo(target.position);
                                if (distance > attackRange) {
                                    botInstance.pathfinder.setGoal(new GoalFollow(target, 2), true);
                                    await sleep(100); 
                                } else {
                                    botInstance.pathfinder.setGoal(null); 
                                    const eyeOffset = mobName === 'enderman' ? target.height - 0.2 : target.height / 2;
                                    await botInstance.lookAt(target.position.offset(0, eyeOffset, 0), true);
                                    botInstance.attack(target);
                                    await sleep(750); 
                                }
                                await sleep(50);
                            }
                            if (botInstance.pathfinder) botInstance.pathfinder.setGoal(null);
                        }
                    }
                    await sleep(1000);
                }
            } catch (err) {
                console.log('Swarm Loop Error:', err.message);
                io.emit('terminal_log', { type: 'error', message: `[Error] Swarm failure: ${err.message}` });
                isLooping = false;
                break;
            }
            await sleep(100);
        }
    });
});

function detectFreePort(startPort, callback) {
    const net = require('net');
    const server = net.createServer();

    server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            detectFreePort(startPort + 1, callback);
        }
    });

    server.once('listening', () => {
        server.close(() => {
            callback(startPort);
        });
    });

    server.listen(startPort);
}

detectFreePort(PORT, (freePort) => {
    http.listen(freePort, () => {
        console.log(`Dashboard running on http://localhost:${freePort}`);
    });
});
