const mineflayer = require('mineflayer');
// Изменили эту строку: достаем GoalBlock напрямую из goals
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
// Строку bot.loadPlugin(GoalBlock) полностью УДАЛИЛИ


let botState = "WAITING";
const chatHistory = [];
const hostileMobs = ['zombie', 'skeleton', 'creeper', 'spider'];

bot.once('spawn', () => {
    console.log('Бот в игре. Радар охраны запущен!');
    
    // 1. Главный игровой цикл (раз в 500мс)
    setInterval(async () => {
        // Запись статуса для Python
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

        // Локальная защита от монстров
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

        // Чтение приказов от Python ИИ
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

// Сбор чата
bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    chatHistory.push({ user: username, text: message });
    if (chatHistory.length > 2048) chatHistory.shift();
});

// Выполнение физических действий
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
        } 
        else if (data.action === 'place_block') {
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
        
        // Находим ОДНОГО ближайшего живого моба с нужным именем
        const target = bot.nearestEntity((entity) => {
            return entity.name && 
                   entity.name.toLowerCase() === targetMobName && 
                   entity.username !== bot.username && 
                   entity.isValid; 
        });

        // Если моб не найден в радиусе прогрузки
        if (!target) {
            console.log(`❌ Ошибка: Моб с именем "${targetMobName}" не найден.`);
            bot.chat(`Я не вижу поблизости моба: ${targetMobName}`);
            return; // Мягко выходим из действия
        }

        // Автоматически берем в руку меч или топор из инвентаря перед боем
        const weapon = bot.inventory.items().find(i => i.name.includes('sword') || i.name.includes('axe'));
        if (weapon) await bot.equip(weapon, 'hand');

        console.log(`Начинаю бой против: ${targetMobName}`);
        
        // Дистанция атаки (для Эндермена больше, чтобы не получать урон до того, как ударим сами)
        const attackRange = targetMobName === 'enderman' ? 4.0 : 3.5;

        // Боевой цикл: преследуем и бьем, пока моб жив и у бота есть здоровье
        while (target && target.isValid && bot.health > 0) {
            const distance = bot.entity.position.distanceTo(target.position);

            if (distance > attackRange) {
                // Если моб далеко — бежим за ним (останавливаемся в 2 блоках от него)
                bot.pathfinder.setGoal(new GoalFollow(target, 2), true);
                await sleep(100); 
            } else {
                // Если подошли на дистанцию удара — сбрасываем цель паффайндера, чтобы не дергаться
                bot.pathfinder.setGoal(null); 
                
                // Рассчитываем точку взгляда (для Эндермена смотрим чуть выше — в глаза, для остальных в центр тела)
                const eyeOffset = targetMobName === 'enderman' ? target.height - 0.2 : target.height / 2;
                await bot.lookAt(target.position.offset(0, eyeOffset, 0), true);
                
                // Наносим удар
                bot.attack(target);
                
                // Стандартный кулдаун атаки в Minecraft для максимального урона
                await sleep(750); 
            }
            await sleep(50);
        }

        // После завершения боя обязательно отключаем преследование
        bot.pathfinder.setGoal(null);
        console.log(`Бой с ${targetMobName} успешно завершен.`);
    }

        console.log(`Серия боев с ${data.target.mob_name} завершена.`);
    } catch (err) {
        console.log("Действие прервано:", err.message);
    }
}

// Периодическая проверка голода с жестким приоритетом охоты
setInterval(async () => {
    if (!bot.registry || !bot.inventory) return; 

    // Проверяем уровень голода
    if (bot.food !== null && bot.food < 17) {
        
        // 1. Проверка еды в инвентаре
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
            return; // Еда найдена и съедена, выходим из интервала
        }

        // 2. Поиск мобов строго по цепочке приоритетов (радиус 24 блока)
        const findMob = (mobName) => {
            return bot.nearestEntity((entity) => 
                entity.type === 'mob' && 
                entity.name === mobName && 
                bot.entity.position.distanceTo(entity.position) < 24
            );
        };

        // Проверяем по очереди: Корова -> Свинья -> Овца -> Курица
        const target = findMob('cow') || findMob('pig') || findMob('sheep') || findMob('chicken');

        // 3. Действие при обнаружении цели
        if (target) {
            try {
                botState = "WORKING";
                
                // Поворачиваем голову к мобу и атакуем
                await bot.lookAt(target.position.offset(0, target.height / 2, 0));
                bot.attack(target);
            } catch (err) {
                console.log("Не удалось атаковать моба:", err.message);
            } finally {
                botState = "WAITING";
            }
        } else {
            // 4. Если ни один моб из списка не найден
            console.log("Бот голодает.")
        }
    }
}, 500); // Проверка каждые 5 секунд
