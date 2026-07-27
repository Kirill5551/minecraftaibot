import os
import time
import json
from groq import Groq

GROQ_API_KEY = "PASTE_YOUR_API_TOKEN"
client = Groq(api_key=GROQ_API_KEY)
MODEL_NAME = "llama-3.3-70b-versatile"

SYSTEM_PROMPT = (
    "Ты — ИИ-мозг майнкрафт-бота. Изучи статус и последние сообщения чата.\n"
    "Если игроки просят что-то сделать, выбери ОДНО действие.\n"
    "Доступные действия:\n"
    "1. 'idle' (если команд нет)\n"
    "2. 'chat' (параметр text, например 'Привет, я ваш личный Ассистент!')\n"
    "3. 'move' (параметры x, y, z)\n"
    "4. 'drop' (параметры item_name, например 'wooden_pickaxe')\n"
    "5. 'kill' (параметры mob_name, например 'pig')\n"
    "6. 'walk_to_block' (параметр block_name, например 'oak_log')\n"
    "7. 'place_block' (параметры block_name, x, y, z)\n"
    "8. 'mine_block' (параметр block_name, например 'oak_log')\n"
    "Отвечай СТРОГО в формате JSON:\n"
    "{\"action\": \"название\", \"target\": { ... } }\n"
    "Никакого другого текста!"
)

def main():
    print("Python ИИ Мозг запущен. Слушаю файлы бота...")
    last_chat_len = 0

    while True:
        time.sleep(1) # Проверяем файлы раз в секунду
        
        if not os.path.exists('status.json'):
            continue
            
        try:
            # Читаем то, что видит бот
            with open('status.json', 'r', encoding='utf-8') as f:
                status = json.load(f)
                
            current_chat = status.get('chat_history', [])
            
            # Активируем ИИ только если в чате появилось новое сообщение!
            if len(current_chat) == last_chat_len:
                continue
                
            last_chat_len = len(current_chat)
            print("[ИИ] Замечено новое сообщение в чате! Думаю...")

            # Защита от ошибок кодировки ASCII
            context = f"Статус бота:\n{json.dumps(status, ensure_ascii=False)}"
            context = context.encode('utf-8', errors='ignore').decode('utf-8')

            # Запрос в Groq
                        # --- БЛОК ЗАПРОСА И ИСПРАВЛЕННОГО ЧТЕНИЯ ОТВЕТА ---
            completion = client.chat.completions.create(
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": context}
                ],
                model=MODEL_NAME,
                temperature=0.2,
                response_format={"type": "json_object"}
            )

            # Проверяем структуру ответа: если это список, берем первый элемент [0]
            if isinstance(completion.choices, list):
                raw_content = completion.choices[0].message.content
            else:
                raw_content = completion.choices.message.content

            decision = json.loads(raw_content.strip())
            print(f"[ИИ Решение]: {decision}")

            # Записываем приказ для бота в файл
            with open('action.json', 'w', encoding='utf-8') as f:
                json.dump(decision, f, indent=2)


        except Exception as e:
            print(f"[Ошибка ИИ]: {e}")

if __name__ == "__main__":
    main()
