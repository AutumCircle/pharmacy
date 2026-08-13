import os
import sys
import json
import time
import gzip
import logging
import sqlite3
import threading
import hashlib
import msvcrt
from uuid import uuid4
from logging.handlers import RotatingFileHandler
from datetime import datetime, timezone

import requests
from dbfread import DBF
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# 1. Загрузка конфигурации
APP_DIR = os.path.dirname(sys.executable) if getattr(sys, "frozen", False) else os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(APP_DIR, "config.json")
def load_config():
    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

config = load_config()
config["min_expected_rows"] = 1

# 2. Настройка логгера (Ротация)
log_formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
log_file = os.path.join(APP_DIR, "sync_agent.log")
# Ротация логов: 5 файлов по 5 МБ каждый (защита диска от переполнения)
my_handler = RotatingFileHandler(log_file, mode='a', maxBytes=5*1024*1024, backupCount=5, encoding='utf-8', delay=0)
my_handler.setFormatter(log_formatter)
my_handler.setLevel(logging.INFO)

logger = logging.getLogger('root')
logger.setLevel(logging.INFO)
logger.addHandler(my_handler)
if sys.stderr is not None:
    console_handler = logging.StreamHandler(sys.stderr)
    console_handler.setFormatter(log_formatter)
    console_handler.setLevel(logging.INFO)
    logger.addHandler(console_handler)

# Глобальный лок для предотвращения конфликтов потоков (Watchdog + Polling)
sync_lock = threading.Lock()

# 3. Работа с SQLite (Очередь и состояние)
DB_NAME = os.path.join(APP_DIR, "agent_state.db")
INSTANCE_LOCK_FILE = os.path.join(APP_DIR, "agent_sync.lock")
_instance_lock_handle = None


def acquire_single_instance_lock():
    global _instance_lock_handle
    handle = open(INSTANCE_LOCK_FILE, "a+b")
    handle.seek(0, os.SEEK_END)
    if handle.tell() == 0:
        handle.write(b"0")
        handle.flush()
    handle.seek(0)
    try:
        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        handle.close()
        return False
    _instance_lock_handle = handle
    return True


def log_startup_state():
    dbf_path = config["dbf_file_path"]
    queue_size = get_queue_size()
    if os.path.exists(dbf_path):
        current_mod_time = str(os.path.getmtime(dbf_path))
        processed_mod_time = get_state("last_mod_time")
        logger.info(
            "Стартовое состояние: DBF=%s; размер=%s; изменён=%s; обработан=%s; очередь=%s",
            dbf_path,
            os.path.getsize(dbf_path),
            datetime.fromtimestamp(float(current_mod_time)).isoformat(),
            datetime.fromtimestamp(float(processed_mod_time)).isoformat() if processed_mod_time else "никогда",
            queue_size,
        )
    else:
        logger.warning("Стартовое состояние: DBF не найден: %s; очередь=%s", dbf_path, queue_size)

def init_db():
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    # Таблица для очереди неотправленных данных
    c.execute('''CREATE TABLE IF NOT EXISTS pending_queue
                 (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT, created_at TEXT)''')
    # Таблица для состояния (last_sync, hash)
    c.execute('''CREATE TABLE IF NOT EXISTS state
                 (key TEXT PRIMARY KEY, value TEXT)''')
    c.execute("SELECT value FROM state WHERE key='queue_protocol'")
    protocol = c.fetchone()
    if not protocol or protocol[0] != "snapshot-v2":
        c.execute("DELETE FROM pending_queue")
        c.execute("DELETE FROM state WHERE key IN ('last_mod_time', 'last_hash')")
        c.execute("INSERT OR REPLACE INTO state (key, value) VALUES ('queue_protocol', 'snapshot-v2')")
    conn.commit()
    conn.close()

def set_state(key, value):
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    c.execute("INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)", (key, str(value)))
    conn.commit()
    conn.close()

def get_state(key, default=None):
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    c.execute("SELECT value FROM state WHERE key=?", (key,))
    row = c.fetchone()
    conn.close()
    return row[0] if row else default

def add_to_queue(payload_json):
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    c.execute("INSERT INTO pending_queue (payload, created_at) VALUES (?, ?)",
              (payload_json, datetime.now().isoformat()))
    conn.commit()
    conn.close()

def get_queue_size():
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM pending_queue")
    count = c.fetchone()[0]
    conn.close()
    return count

def get_first_in_queue():
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    c.execute("SELECT id, payload FROM pending_queue ORDER BY id ASC LIMIT 1")
    row = c.fetchone()
    conn.close()
    return row

def delete_from_queue(item_id):
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    c.execute("DELETE FROM pending_queue WHERE id=?", (item_id,))
    conn.commit()
    conn.close()

# 4. Логика чтения базы DBF
def clean_catalog_attribute(value):
    return "" if value is None else str(value)


def file_signature(filepath):
    stat = os.stat(filepath)
    return stat.st_size, stat.st_mtime_ns


def wait_for_stable_file(filepath):
    stable_seconds = int(config.get("file_stability_seconds", 30))
    check_seconds = int(config.get("file_stability_check_seconds", 3))
    max_wait_seconds = int(config.get("file_stability_max_wait_seconds", 300))
    started = time.monotonic()
    signature = file_signature(filepath)
    stable_since = time.monotonic()
    while time.monotonic() - started < max_wait_seconds:
        time.sleep(check_seconds)
        current = file_signature(filepath)
        if current != signature:
            signature = current
            stable_since = time.monotonic()
            continue
        if time.monotonic() - stable_since >= stable_seconds:
            return signature
    raise RuntimeError("OSTATKI.DBF did not become stable before timeout")


def extract_data_from_dbf(filepath):
    logger.info(f"Начало чтения файла {filepath}...")

    # Пытаемся открыть файл с Exponential Backoff для обхода PermissionError (файл заблокирован на запись)
    max_retries = 5
    records = []

    for attempt in range(max_retries):
        try:
            # Важно: Явное указание кодировки для обхода проблем с мусором в заголовках DBF
            table = DBF(filepath, encoding=config["dbf_encoding"], char_decode_errors='replace')
            for record in table:
                # Извлечение по ИМЕНАМ колонок
                item = {
                    "name": record.get("NAME", "N/A"),
                    "price": record.get("PRICE", 0.0),
                    "country": clean_catalog_attribute(record.get("COUNTRY", "")),
                    "vendor": clean_catalog_attribute(record.get("PROIZVOD", "") or record.get("VENDOR", ""))  # DBF uses PROIZVOD column
                }
                records.append(item)
            break # Успешно прочитали
        except PermissionError:
            sleep_time = 2 ** attempt
            logger.warning(f"Файл заблокирован. Попытка {attempt+1}/{max_retries}. Ждем {sleep_time} сек...")
            time.sleep(sleep_time)
        except Exception as e:
            logger.error(f"Ошибка при чтении DBF: {e}")
            return None

    if not records and max_retries > 0:
        logger.error("Не удалось прочитать DBF файл после всех попыток (файл постоянно заблокирован или пуст).")
        return None

    return records

def validate_data(records):
    # Sanity Check
    if not records:
        logger.error("Sanity Check провален: Данные пусты.")
        return False

    if len(records) < config["min_expected_rows"]:
        logger.error(f"Sanity Check провален: получено {len(records)} строк, ожидается минимум {config['min_expected_rows']}.")
        return False

    # Проверка типов (на примере первой записи)
    first_price = records[0].get("price")
    if not isinstance(first_price, (int, float)):
        logger.error(f"Sanity Check провален: поле price не является числом (получено {type(first_price)}).")
        return False

    return True

# 5. Отправка данных на сервер
def send_to_server(payload_json):
    url = f"{config['server_url'].rstrip('/')}/api/sync"
    headers = {
    "x-api-key": config['api_key'],
    "Content-Encoding": "gzip",
    "Content-Type": "application/json"
    }

    compressed_data = gzip.compress(payload_json.encode('utf-8'))

    try:
        # verify=True для проверки SSL в продакшене.
        response = requests.post(url, data=compressed_data, headers=headers, verify=True, timeout=30)
        if response.status_code == 200:
            return True
        else:
            logger.error(f"Сервер вернул ошибку {response.status_code}: {response.text}")
            return False
    except Exception as e:
        logger.error(f"Сетевая ошибка при отправке: {e}")
        return False

def process_sync_workflow():
    # Неблокирующий Lock. Если уже выполняется (например, из-за Polling), пропускаем Watchdog.
    if not sync_lock.acquire(blocking=False):
        logger.debug("Синхронизация уже идет. Пропуск...")
        return

    try:
        dbf_path = config["dbf_file_path"]
        if not os.path.exists(dbf_path):
            logger.warning(f"Файл {dbf_path} не найден.")
            return

        dbf_mod_time = str(os.path.getmtime(dbf_path))
        last_processed_time = get_state("last_mod_time")

        if dbf_mod_time == last_processed_time:
            logger.debug("Файл не изменился с прошлой проверки.")
        else:
            logger.info("Обнаружены изменения в файле. Начинаем чтение...")
            try:
                stable_signature = wait_for_stable_file(dbf_path)
            except (OSError, RuntimeError) as exc:
                logger.warning(f"DBF is not stable yet: {exc}")
                return
            records = extract_data_from_dbf(dbf_path)
            if records and file_signature(dbf_path) != stable_signature:
                logger.warning("DBF changed while it was being read; snapshot was not queued")
                return

            if records and validate_data(records):
                records_json = json.dumps(records, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
                payload_hash = hashlib.sha256(records_json.encode("utf-8")).hexdigest()
                last_hash = get_state("last_hash")

                if payload_hash == last_hash:
                    logger.info("Данные не изменились (дубликат по хэшу). Отправка отменена.")
                    set_state("last_mod_time", dbf_mod_time)
                else:
                    logger.info("Помещение новых данных в очередь (SQLite)...")
                    snapshot = {
                        "format": "vatan-direct-catalog-snapshot/v2",
                        "sync_id": str(uuid4()),
                        "generated_at": datetime.now(timezone.utc).isoformat(),
                        "expected_row_count": len(records),
                        "snapshot_sha256": payload_hash,
                        "records": records,
                    }
                    payload_json = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
                    add_to_queue(payload_json)
                    set_state("last_mod_time", dbf_mod_time)
                    set_state("last_hash", payload_hash)
            else:
                logger.warning("Синхронизация отменена из-за ошибки чтения или провала Sanity Check.")
                set_state("last_error", "Sanity Check failed")

        # Обработка очереди (Отправка на сервер)
        process_queue()

    finally:
        sync_lock.release()

def process_queue():
    while True:
        item = get_first_in_queue()
        if not item:
            break

        item_id, payload_json = item
        logger.info(f"Попытка отправки элемента из очереди (ID: {item_id})...")
        success = send_to_server(payload_json)

        if success:
            logger.info(f"✅ Данные успешно доставлены на сервер! (ID: {item_id})")
            delete_from_queue(item_id)
            set_state("last_successful_sync_at", datetime.now().isoformat())
            set_state("last_error", "")
        else:
            logger.warning(f"Не удалось отправить данные. Элемент {item_id} остается в очереди.")
            set_state("last_error", "Ошибка сети или сервера 500")
            break # Прерываем цикл, ждем следующего прохода, чтобы не спамить

# 6. Heartbeat (Пульс)
def heartbeat_loop():
    while True:
        url = f"{config['server_url'].rstrip('/')}/api/heartbeat"
        headers = {
            "x-api-key": config['api_key'],
	    "Content-Type": "application/json"
        }

        payload = {
            "status": "alive",
            "last_successful_sync_at": get_state("last_successful_sync_at"),
            "pending_queue_size": get_queue_size(),
            "last_error": get_state("last_error")
        }

        try:
            requests.post(url, json=payload, headers=headers, verify=True, timeout=10)
            logger.debug("Heartbeat успешно отправлен.")
        except Exception as e:
            logger.debug(f"Ошибка отправки Heartbeat: {e}")

        time.sleep(config["heartbeat_interval_seconds"])

# 7. Polling (Резервная проверка)
def polling_loop():
    while True:
        time.sleep(config["poll_interval_seconds"])
        logger.debug("Запуск проверки по таймеру (Polling)...")
        process_sync_workflow()

# 8. Watchdog (Быстрая проверка)
class DBFEventHandler(FileSystemEventHandler):
    def on_modified(self, event):
        # event.src_path - абсолютный путь. Проверяем, что изменен именно наш файл
        abs_dbf_path = os.path.abspath(config["dbf_file_path"])
        if not event.is_directory and os.path.abspath(event.src_path) == abs_dbf_path:
            logger.info("Watchdog: Обнаружено изменение файла через события ОС.")
            process_sync_workflow()

def start_watchdog():
    event_handler = DBFEventHandler()
    observer = Observer()
    dbf_dir = os.path.dirname(os.path.abspath(config["dbf_file_path"]))
    if not dbf_dir:
        dbf_dir = "."
    observer.schedule(event_handler, path=dbf_dir, recursive=False)
    observer.start()
    return observer

if __name__ == "__main__":
    if not acquire_single_instance_lock():
        logger.warning("Другой экземпляр agent_sync.exe уже работает. Новый экземпляр завершён.")
        raise SystemExit(0)
    logger.info("="*50)
    logger.info("Запуск модуля синхронизации аптеки (Agent)...")
    init_db()
    log_startup_state()

    # Catch-up при старте
    logger.info("Выполнение стартовой (catch-up) проверки...")
    process_sync_workflow()

    # Запуск фоновых потоков
    hb_thread = threading.Thread(target=heartbeat_loop, daemon=True)
    hb_thread.start()

    poll_thread = threading.Thread(target=polling_loop, daemon=True)
    poll_thread.start()

    observer = start_watchdog()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        logger.info("Остановка агента...")
        observer.stop()
        observer.join()
