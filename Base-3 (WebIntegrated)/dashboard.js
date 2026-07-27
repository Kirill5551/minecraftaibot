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
let bot = null;
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
            <title>Mineflayer Console Dashboard</title>
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
                .container { width: 100%; max-width: 900px; display: flex; flex-direction: column; gap: 16px; }
                .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
                .grid-flex { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
                .input-group { display: flex; flex-direction: column; gap: 4px; flex-grow: 1; }
                .input-group label { font-size: 0.7rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
                input[type="text"], input[type="number"] { 
                    width: 100%; padding: 8px 12px; background: #0f172a; border: 1px solid var(--border); 
                    color: var(--text-main); border-radius: 6px; font-size: 0.9rem; transition: border-color 0.2s;
                }
                input:focus { border-color: var(--accent); outline: none; }
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
                        <div class="input-group" style="flex-grow: 2;"><label>Server IP</label><input type="text" id="ip" value="localhost"></div>
                        <div class="input-group" style="flex-grow: 1; max-width: 120px;"><label>Port</label><input type="number" id="port" value="25565"></div>
                        <div class="input-group" style="flex-grow: 2;"><label>Bot Username</label><input type="text" id="username" value="WebBot"></div>
                        <div class="checkbox-group">
                            <input type="checkbox" id="reconnect" checked onchange="toggleReconnect(this.checked)">
                            <label for="reconnect" style="cursor:pointer; text-transform:none; font-size:0.9rem; color:var(--text-main);">Auto-reconnect</label>
                        </div>
                    </div>
                    <div class="status-line">
                        <button class="btn-danger" onclick="disconnectBot()">Disconnect</button>
                        <button onclick="connectBot()">Connect</button>
                        <div style="margin-left: auto;">Status: <span id="status" style="font-weight: 600; color: var(--danger);">Disconnected</span></div>
                    </div>
                </div>

                <div class="terminal-card">
                    <div id="chat">
                        <div style="color: var(--text-muted);">=== Mineflayer Interactive CLI Terminal ===</div>
                        <div style="color: var(--text-muted);">Type "help" to see available commands and usage.</div>
                    </div>
                    <div class="terminal-input-row">
                        <span class="terminal-prefix">&gt;</span>
                        <input type="text" id="cmd" placeholder="Enter command..." autocomplete="off">
                    </div>
                </div>
            </div>

            <script>
                const socket = io();
                
                const cmdHistory = [];
                let historyIndex = -1;

                function connectBot() {
                    const ip = document.getElementById('ip').value;
                    const port = parseInt(document.getElementById('port').value);
                    const username = document.getElementById('username').value;
                    socket.emit('bot_connect', { ip, port, username });
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
                        } else if (historyIndex === 0) {
                            this.value = cmdHistory[0];
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

                socket.on('status', data => {
                    const text = document.getElementById('status');
                    text.innerText = data.text;
                    if (data.connected) {
                        text.style.color = 'var(--success)';
                    } else if (data.text.includes('Reconnect') || data.text.includes('Connecting')) {
                        text.style.color = '#ff9800';
                    } else {
                        text.style.color = 'var(--danger)';
                    }
                });
                
                socket.on('terminal_log', data => {
                    const chatDiv = document.getElementById('chat');
                    let style = '';
                    if (data.type === 'error') {
                        style = 'color: var(--danger); font-weight:600;';
                    } else if (data.type === 'help') {
                        style = 'color: #e2e8f0; font-style: italic;';
                    } else if (data.type === 'cmd') {
                        style = 'color: #ffffff; font-weight: 500;';
                    } else {
                        style = 'color: #ffffff;';
                    }
                    
                    chatDiv.innerHTML += '<div style="' + style + '">' + data.message + '</div>';
                    chatDiv.scrollTop = chatDiv.scrollHeight;
                });

                socket.on('disable_reconnect_checkbox', () => {
                    document.getElementById('reconnect').checked = false;
                });
            </script>
        </body>
        </html>
    `);
});
let countdownInterval = null; 
let actionAttempts = 0; // Счетчик попыток выполнения действия в игре
let currentActiveCommand = null; // Хранение текущей запущенной команды для повторов

process.on('uncaughtException', (err) => {
    console.error('Intercepted crash:', err);
    isLooping = false;
    if (bot) {
        if (bot.pathfinder) bot.pathfinder.setGoal(null);
        io.emit('terminal_log', { type: 'error', message: `[Critical Error] Intercepted crash: ${err.message || 'Block interaction failed.'}` });
        io.emit('terminal_log', { type: 'info', message: '[Bot] Goal resetted.' });
    }
});

function startBotInstance(data, socket) {
    if (bot) return;
    
    manualDisconnect = false;
    io.emit('status', { connected: false, text: 'Connecting...' });

    bot = mineflayer.createBot({
        host: data.ip,
        port: data.port,
        username: data.username
    });

    bot.loadPlugin(collectBlock);
    bot.loadPlugin(pathfinder);

    bot.on('spawn', () => {
        reconnectAttempts = 0; 
        io.emit('status', { connected: true, text: 'Connected' });
        io.emit('terminal_log', { type: 'info', message: '[System] Bot successfully joined the server.' });
    });

    bot.on('end', () => {
        bot = null;
        isLooping = false;
        
        if (manualDisconnect) {
            io.emit('status', { connected: false, text: 'Disconnected' });
            io.emit('terminal_log', { type: 'info', message: '[System] Bot disconnected.' });
            return;
        }

        if (autoReconnectEnabled) {
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
                    if (timeLeft > 0 && autoReconnectEnabled && !manualDisconnect && !bot) {
                        io.emit('status', { connected: false, text: `Reconnect in ${timeLeft} seconds` });
                    } else {
                        clearInterval(countdownInterval);
                        countdownInterval = null;
                        if (autoReconnectEnabled && !manualDisconnect && !bot) {
                            startBotInstance(data, socket);
                        }
                    }
                }, 1000);
            }
        } else {
            io.emit('status', { connected: false, text: 'Disconnected' });
            io.emit('terminal_log', { type: 'info', message: '[System] Connection closed. Auto-reconnect is disabled.' });
        }
    });

    bot.on('error', (err) => {
        console.log('Bot Error:', err.message);
        io.emit('terminal_log', { type: 'error', message: `[System Error] ${err.message || 'Unknown network error.'}` });
    });
}

io.on('connection', (socket) => {
    socket.emit('status', { connected: !!bot, text: bot ? 'Connected' : 'Disconnected' });

    socket.on('toggle_reconnect', (val) => {
        autoReconnectEnabled = val;
        if (val) reconnectAttempts = 0;
    });

    socket.on('bot_connect', (data) => {
        reconnectAttempts = 0; 
        startBotInstance(data, socket);
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
        
        if (bot) {
            bot.quit();
            bot = null;
        } else {
            io.emit('status', { connected: false, text: 'Disconnected' });
            io.emit('terminal_log', { type: 'info', message: '[System] Bot disconnected.' });
        }
    });

    socket.on('bot_stop_loop', () => {
        isLooping = false;
        actionAttempts = 0;
        currentActiveCommand = null;
        if (bot && bot.pathfinder) bot.pathfinder.setGoal(null);
    });

    socket.on('bot_terminal_cmd', async (fullCommand) => {
        io.emit('terminal_log', { type: 'cmd', message: `> ${fullCommand}` });

        const args = fullCommand.trim().split(/\s+/);
        const command = args[0].toLowerCase();
        
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
            io.emit('terminal_log', { type: 'help', message: 'mine (block_name) - Sets bot goal to mine setted block.' });
            io.emit('terminal_log', { type: 'help', message: 'find (block_name) - Sets bot goal to walk to the setted block.' });
            io.emit('terminal_log', { type: 'help', message: 'move (x) (y) (z) - Sets bot goal to walk to setted position.' });
            io.emit('terminal_log', { type: 'help', message: 'drop (item_name) - Sets bot goal to drop the setted item.' });
            io.emit('terminal_log', { type: 'help', message: 'kill (mob_name) - Sets bot goal to kill the setted mob.' });
            io.emit('terminal_log', { type: 'help', message: 'stop - Resets bot goal.' });
            return;
        }

        if (!bot) {
            io.emit('terminal_log', { type: 'error', message: '[Error] Bot is offline. Connect it first.' });
            return;
        }

        if (command === 'stop') {
            isLooping = false;
            actionAttempts = 0;
            currentActiveCommand = null;
            if (bot.pathfinder) bot.pathfinder.setGoal(null);
            io.emit('terminal_log', { type: 'info', message: '[Bot] Goal resetted.' });
            return;
        }

        // При вводе новой команды обнуляем попытки действий
        actionAttempts = 0;
        currentActiveCommand = fullCommand;
        isLooping = false;
        await sleep(250); 
        isLooping = true;

        const mcData = require('minecraft-data')(bot.version);

        while (isLooping && bot) {
            try {
                if (command === 'mine') {
                    const blockName = args.slice(1).join(' ').toLowerCase();
                    const blockType = mcData.blocksByName[blockName];
                    
                    if (!blockType) {
                        io.emit('terminal_log', { type: 'info', message: `[Bot] Not found ${blockName}.` });
                        io.emit('terminal_log', { type: 'info', message: '[Bot] Goal resetted.' });
                        isLooping = false;
                        break;
                    }

                    const block = bot.findBlock({ matching: blockType.id, maxDistance: 32 });
                    if (block) {
                        const p = block.position;
                        io.emit('terminal_log', { type: 'info', message: `[Bot] Walking to ${blockName} on ${p.x} ${p.y} ${p.z}.` });
                        
                        const defaultMovements = new Movements(bot, mcData);
                        bot.pathfinder.setMovements(defaultMovements);
                        await bot.pathfinder.goto(new GoalGetToBlock(p.x, p.y, p.z));
                        
                        if (!isLooping) break;
                        io.emit('terminal_log', { type: 'info', message: `[Bot] Mining ${blockName}.` });
                        
                        try {
                            await bot.collectBlock.collect(block);
                            actionAttempts = 0; // Обнуляем попытки при успешном сборе блока
                        } catch (mineError) {
                            actionAttempts++;
                            
                            // Выводим оранжевое предупреждение о попытке ретрая (используем тип 'help' для оранжевого/светлого тона или кастомную обработку)
                            io.emit('terminal_log', { type: 'help', message: `[Bot Error] Cannot mine ${blockName}. Retry attempt #${actionAttempts} of 5...` });
                            
                            if (actionAttempts >= 5) {
                                io.emit('terminal_log', { type: 'error', message: `[Error] Failed to mine ${blockName} with 5 attempts!` });
                                io.emit('terminal_log', { type: 'info', message: '[Bot] Goal resetted.' });
                                isLooping = false;
                                actionAttempts = 0;
                                if (bot.pathfinder) bot.pathfinder.setGoal(null);
                                break;
                            } else {
                                await sleep(2000); // Ожидание перед повторной попыткой действия
                                continue;
                            }
                        }
                    } else {
                        io.emit('terminal_log', { type: 'info', message: `[Bot] Not found ${blockName}.` });
                        io.emit('terminal_log', { type: 'info', message: '[Bot] Goal resetted.' });
                        isLooping = false;
                        break;
                    }

                } else if (command === 'find') {
                    const blockName = args.slice(1).join(' ').toLowerCase();
                    const blockType = mcData.blocksByName[blockName];

                    if (!blockType) {
                        io.emit('terminal_log', { type: 'info', message: `[Bot] Not found ${blockName}.` });
                        io.emit('terminal_log', { type: 'info', message: '[Bot] Goal resetted.' });
                        isLooping = false;
                        break;
                    }

                    const block = bot.findBlock({ matching: blockType.id, maxDistance: 32 });
                    if (block) {
                        const p = block.position;
                        io.emit('terminal_log', { type: 'info', message: `[Bot] Walking to ${blockName} on ${p.x} ${p.y} ${p.z}.` });
                        
                        const defaultMovements = new Movements(bot, mcData);
                        bot.pathfinder.setMovements(defaultMovements);
                        await bot.pathfinder.goto(new GoalGetToBlock(p.x, p.y, p.z));
                        
                        await sleep(2000);
                    } else {
                        io.emit('terminal_log', { type: 'info', message: `[Bot] Not found ${blockName}.` });
                        io.emit('terminal_log', { type: 'info', message: '[Bot] Goal resetted.' });
                        isLooping = false;
                        break;
                    }

                } else if (command === 'move') {
                    const x = parseFloat(args[1]);
                    const y = parseFloat(args[2]);
                    const z = parseFloat(args[3]);

                    io.emit('terminal_log', { type: 'info', message: `[Bot] Walking to ${x} ${y} ${z}.` });
                    
                    const defaultMovements = new Movements(bot, mcData);
                    bot.pathfinder.setMovements(defaultMovements);
                    await bot.pathfinder.goto(new GoalBlock(x, y, z));
                    
                    isLooping = false;
                    if (bot.pathfinder) bot.pathfinder.setGoal(null);
                    break;

                } else if (command === 'drop') {
                    const itemName = args.slice(1).join(' ').toLowerCase();
                    const item = bot.inventory.items().find(it => it.name === itemName);

                    if (item) {
                        await bot.tossStack(item);
                        io.emit('terminal_log', { type: 'info', message: `[Bot] Dropped ${itemName}.` });
                        await sleep(1000);
                    } else {
                        io.emit('terminal_log', { type: 'info', message: `[Bot] Not found ${itemName} in inventory.` });
                        io.emit('terminal_log', { type: 'info', message: '[Bot] Goal resetted.' });
                        isLooping = false;
                        break;
                    }

                } else if (command === 'kill') {
                    const mobName = args.slice(1).join(' ').toLowerCase();
                    const target = bot.nearestEntity((entity) => {
                        return entity.name && entity.name.toLowerCase() === mobName && entity.username !== bot.username && entity.isValid; 
                    });

                    if (!target) {
                        io.emit('terminal_log', { type: 'info', message: `[Bot] Not found ${mobName}.` });
                        io.emit('terminal_log', { type: 'info', message: '[Bot] Goal resetted.' });
                        isLooping = false;
                        break;
                    }

                    const weapon = bot.inventory.items().find(i => i.name.includes('sword') || i.name.includes('axe'));
                    if (weapon) await bot.equip(weapon, 'hand');

                    const attackRange = mobName === 'enderman' ? 4.0 : 3.5;
                    const defaultMovements = new Movements(bot, mcData);
                    bot.pathfinder.setMovements(defaultMovements);

                    const p = target.position;
                    io.emit('terminal_log', { type: 'info', message: `[Bot] Walking to ${mobName} on ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}.` });

                    while (target && target.isValid && bot.health > 0 && isLooping) {
                        const distance = bot.entity.position.distanceTo(target.position);
                        if (distance > attackRange) {
                            bot.pathfinder.setGoal(new GoalFollow(target, 2), true);
                            await sleep(100); 
                        } else {
                            bot.pathfinder.setGoal(null); 
                            io.emit('terminal_log', { type: 'info', message: `[Bot] Killing ${mobName}.` });
                            const eyeOffset = mobName === 'enderman' ? target.height - 0.2 : target.height / 2;
                            await bot.lookAt(target.position.offset(0, eyeOffset, 0), true);
                            bot.attack(target);
                            await sleep(750); 
                        }
                        await sleep(50);
                    }
                    
                    if (!target.isValid && isLooping) {
                        io.emit('terminal_log', { type: 'info', message: `[Bot] Killed ${mobName}.` });
                    }
                    if (bot.pathfinder) bot.pathfinder.setGoal(null);
                    await sleep(1000);
                }
            } catch (err) {
                console.log('Loop Error:', err.message);
                io.emit('terminal_log', { type: 'error', message: `[Error] Internal bot failure: ${err.message}` });
                io.emit('terminal_log', { type: 'info', message: '[Bot] Goal resetted.' });
                isLooping = false;
                if (bot && bot.pathfinder) bot.pathfinder.setGoal(null);
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
