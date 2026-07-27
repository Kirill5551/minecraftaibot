const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalBlock, GoalFollow } } = require('mineflayer-pathfinder');
const collectBlock = require('mineflayer-collectblock').plugin;
const Vec3 = require('vec3');
const fs = require('fs');

const bot = mineflayer.createBot({
    host: 'localhost',
    port: 28010,
    username: 'AI_Body_Bot',
    version: '1.21.1'
});

bot.loadPlugin(pathfinder);
bot.loadPlugin(collectBlock);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let botState = "WAITING";
const chatHistory = [];
const hostileMobs = ['zombie', 'skeleton', 'creeper', 'spider'];

bot.once('spawn', () => {
    console.log('Bot in game.');
    setInterval(async () => {
        try {
            const inv = {};
            bot.inventory.items().forEach(item => { inv[item.name] = item.count; });
            const pos = bot.entity ? bot.entity.position : { x: 0, y: 0, z: 0 };
            
            fs.writeFileSync('status.json', JSON.stringify({
                bot_coords: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) },
                inventory: inv,
                chat_history: chatHistory
            }, null, 2));
        } catch (e) {}

        if (botState === "WAITING") {
            const enemy = bot.nearestEntity(entity => 
                entity.type === 'mob' && 
                hostileMobs.includes(entity.name) &&
                entity.position.distanceTo(bot.entity.position) <= 20
            );
            if (enemy) {
                bot.lookAt(enemy.position.offset(0, enemy.height / 2, 0));
                bot.attack(enemy);
                return;
            }
        }

        if (botState === "WAITING" && fs.existsSync('action.json')) {
            try {
                const actionData = JSON.parse(fs.readFileSync('action.json', 'utf8'));
                if (actionData && actionData.action && actionData.action !== 'idle') {
                    botState = "WORKING";
                    fs.writeFileSync('action.json', JSON.stringify({ action: "idle" })); // сбрасываем
                    
                    await executeAction(actionData);
                    botState = "WAITING";
                }
            } catch (e) {}
        }
    }, 500);
});

bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    chatHistory.push({ user: username, text: message });
    if (chatHistory.length > 2048) chatHistory.shift();
});

async function executeAction(data) {
    const mcData = require('minecraft-data')(bot.version);
    const defaultMove = new Movements(bot, mcData);

    try {
        if (data.action === 'mine_block') {
            const block = bot.findBlock({
                matching: mcData.blocksByName[data.target.block_name]?.id,
                maxDistance: 32
            });
            if (block) await bot.collectBlock.collect(block);
        } else if (data.action === 'place_block') {
            const pos = new Vec3(data.target.x, data.target.y, data.target.z);
            const item = bot.inventory.findInventoryItem(mcData.itemsByName[data.target.block_name]?.id);
            
            if (item) {
                bot.pathfinder.setMovements(defaultMove);
                await bot.pathfinder.goto(new goals.GoalGetToBlock(pos.x, pos.y, pos.z + 1));
                await bot.equip(item, 'hand');
                const refBlock = bot.blockAt(pos.offset(0, -1, 0));
                if (refBlock) await bot.placeBlock(refBlock, new Vec3(0, 1, 0));
            }
        } else if (data.action === 'chat') {
            bot.chat(`${data.target.text}`);
        } else if (data.action === 'walk_to_block') {
            const block = bot.findBlock({
                matching: mcData.blocksByName[data.target.block_name]?.id,
                maxDistance: 32
            });
        } else if (data.action === 'move') {
            const goal = new GoalBlock(data.target.x, data.target.y, data.target.z);
            bot.pathfinder.goto(goal)
        } else if (data.action === 'drop') {
            const item = bot.inventory.items().find(i => i.name === data.target.item_name);
            if (item) {
                await bot.tossStack(item);
                console.log(`Стак ${data.target.item_name} успешно выброшен (Повтор: ${i + 1}/${repetitions})`);
            } else {
                bot.chat(`У меня нет стака ${data.target.item_name}`);
                return;
            }
        }     else if (data.action === 'kill') {
        const targetMobName = data.target.mob_name.toLowerCase().trim();
        
        const target = bot.nearestEntity((entity) => {
            return entity.name && 
                   entity.name.toLowerCase() === targetMobName && 
                   entity.username !== bot.username && 
                   entity.isValid; 
        });

        if (!target) {
            console.log(`❌ Ошибка: Моб с именем "${targetMobName}" не найден.`);
            bot.chat(`Я не вижу поблизости моба: ${targetMobName}`);
            return;
        }

        const weapon = bot.inventory.items().find(i => i.name.includes('sword') || i.name.includes('axe'));
        if (weapon) await bot.equip(weapon, 'hand');

        console.log(`Начинаю бой против: ${targetMobName}`);
        
        const attackRange = targetMobName === 'enderman' ? 4.0 : 3.5;

        while (target && target.isValid && bot.health > 0) {
            const distance = bot.entity.position.distanceTo(target.position);

            if (distance > attackRange) {
                bot.pathfinder.setGoal(new GoalFollow(target, 2), true);
                await sleep(100); 
            } else {
                bot.pathfinder.setGoal(null); 
                
                const eyeOffset = targetMobName === 'enderman' ? target.height - 0.2 : target.height / 2;
                await bot.lookAt(target.position.offset(0, eyeOffset, 0), true);
                bot.attack(target);
                await sleep(750); 
            }
            await sleep(50);
        }

        bot.pathfinder.setGoal(null);
        console.log(`${targetMobName} killed.`);
    }

        console.log(`Series of fights with ${data.target.mob_name} ended.`);
    } catch (err) {
        console.log("[Error] ", err.message);
    }
}

setInterval(async () => {
    if (!bot.registry || !bot.inventory) return; 

    if (bot.food !== null && bot.food < 17) {
        
        const foodItem = bot.inventory.items().find(item => 
            bot.registry.foodsArray && bot.registry.foodsArray.some(f => f.name === item.name)
        );

        if (foodItem) {
            try {
                botState = "WORKING"; 
                await bot.equip(foodItem, 'hand');
                await bot.consume();
            } catch (err) {
                console.log("Не удалось поесть:", err.message);
            } finally {
                botState = "WAITING";
            }
            return;
        }

        const findMob = (mobName) => {
            return bot.nearestEntity((entity) => 
                entity.type === 'mob' && 
                entity.name === mobName && 
                bot.entity.position.distanceTo(entity.position) < 24
            );
        };

        const target = findMob('cow') || findMob('pig') || findMob('sheep') || findMob('chicken');

        if (target) {
            try {
                botState = "WORKING";
                await bot.lookAt(target.position.offset(0, target.height / 2, 0));
                bot.attack(target);
            } catch (err) {
                console.log("[Error] ", err.message);
            } finally {
                botState = "WAITING";
            }
        } else {
            console.log("Bot is hungry.")
        }
    }
}, 500);
