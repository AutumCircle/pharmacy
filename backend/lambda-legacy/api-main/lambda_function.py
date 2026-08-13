"""
Pharmacy Query & E-Commerce Lambda Handler (v3)
------------------------------------------
Handles queries, search, orders, categories, and featured products.
"""

import os
import json
import logging
from decimal import Decimal

import psycopg2
from psycopg2.extras import RealDictCursor

logger = logging.getLogger()
logger.setLevel(logging.INFO)

DB_CONFIG = {
    "host": os.environ.get("DB_HOST"),
    "port": int(os.environ.get("DB_PORT", 5432)),
    "dbname": os.environ.get("DB_NAME"),
    "user": os.environ.get("DB_USER"),
    "password": os.environ.get("DB_PASSWORD"),
    "connect_timeout": 10,
}

_connection = None


def get_connection():
    global _connection
    if _connection is None or _connection.closed:
        _connection = psycopg2.connect(**DB_CONFIG)
        _connection.autocommit = True
    return _connection


def init_db(cur):
    """Ensure all tables exist."""
    try:
        cur.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    except Exception as e:
        logger.warning(f"Could not create pg_trgm extension: {e}")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            phone VARCHAR(20) UNIQUE NOT NULL,
            name VARCHAR(255),
            address TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS orders (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id),
            customer_name VARCHAR(255) NOT NULL,
            phone VARCHAR(20) NOT NULL,
            address TEXT NOT NULL,
            total_price DECIMAL(10,2) NOT NULL,
            status VARCHAR(50) DEFAULT 'pending',
            notes TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS order_items (
            id SERIAL PRIMARY KEY,
            order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
            medicine_name TEXT NOT NULL,
            price DECIMAL(10,2) NOT NULL,
            quantity INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS categories (
            id SERIAL PRIMARY KEY,
            slug VARCHAR(100) UNIQUE NOT NULL,
            name VARCHAR(255) NOT NULL,
            icon VARCHAR(50) DEFAULT '💊',
            color VARCHAR(20) DEFAULT '#E31E24',
            sort_order INTEGER DEFAULT 0,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS category_medicines (
            id SERIAL PRIMARY KEY,
            category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
            medicine_name TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0,
            UNIQUE(category_id, medicine_name)
        );

        CREATE TABLE IF NOT EXISTS featured_products (
            id SERIAL PRIMARY KEY,
            medicine_name TEXT NOT NULL UNIQUE,
            sort_order INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW()
        );
    """)

    # Seed default categories if none exist
    cur.execute("SELECT COUNT(*) as cnt FROM categories")
    row = cur.fetchone()
    if row and row["cnt"] == 0:
        default_categories = [
            ("promos", "% Акции", "🏷️", "#E31E24", 0),
            ("vitamins-bads", "Витамины и БАДы", "💊", "#8B5CF6", 1),
            ("vitamins-minerals", "Витамины и минералы", "🌿", "#10B981", 2),
            ("vitamin-d", "Витамин Д3", "☀️", "#F59E0B", 3),
            ("herbs", "Лечебные травы", "🌱", "#059669", 4),
            ("mom-baby", "Мама и малыш", "👶", "#EC4899", 5),
            ("hygiene", "Гигиена", "🧴", "#3B82F6", 6),
            ("orthopedics", "Ортопедия", "🦴", "#6366F1", 7),
        ]
        for slug, name, icon, color, sort_order in default_categories:
            cur.execute("""
                INSERT INTO categories (slug, name, icon, color, sort_order)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (slug) DO NOTHING
            """, (slug, name, icon, color, sort_order))


class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        return super().default(obj)


def lambda_handler(event, context):
    logger.info("=== Query Lambda v3 triggered ===")

    try:
        body = event.get("body", "{}")
        if isinstance(body, str):
            params = json.loads(body)
        else:
            params = body or {}

        action = params.get("action", "count")
        conn = get_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        write_actions = (
            "create_order", "list_orders", "get_order_status",
            "create_category", "update_category", "delete_category",
            "add_category_medicine", "remove_category_medicine",
            "set_featured", "remove_featured", "update_order",
            "reorder_categories",
        )
        if action in write_actions:
            init_db(cur)

        result = {}

        # ─── Search ──────────────────────────────────────────────────────
        if action == "search":
            name = params.get("name", "")
            limit = min(params.get("limit", 20), 50)
            in_stock = params.get("in_stock")

            try:
                if in_stock is not None:
                    cur.execute("""
                        SELECT name, price, country, vendor, in_stock, updated_at::text,
                               similarity(name, %s) as sim
                        FROM medicines
                        WHERE in_stock = %s AND (LOWER(name) LIKE LOWER(%s) OR name %% %s)
                        ORDER BY in_stock DESC, sim DESC, name
                        LIMIT %s
                    """, (name, in_stock, f"%{name}%", name, limit))
                else:
                    cur.execute("""
                        SELECT name, price, country, vendor, in_stock, updated_at::text,
                               similarity(name, %s) as sim
                        FROM medicines
                        WHERE LOWER(name) LIKE LOWER(%s) OR name %% %s
                        ORDER BY in_stock DESC, sim DESC, name
                        LIMIT %s
                    """, (name, f"%{name}%", name, limit))
            except Exception:
                # Fallback to ILIKE if pg_trgm not loaded
                cur.execute(
                    "SELECT name, price, country, vendor, in_stock, updated_at::text "
                    "FROM medicines WHERE LOWER(name) LIKE LOWER(%s) ORDER BY in_stock DESC, name LIMIT %s",
                    (f"%{name}%", limit)
                )
            result = {"matches": [dict(r) for r in cur.fetchall()]}

        # ─── Get single medicine by name ─────────────────────────────────
        elif action == "get":
            name = params.get("name", "")
            cur.execute(
                "SELECT id, name, price, country, vendor, in_stock, "
                "updated_at::text, created_at::text "
                "FROM medicines WHERE name = %s",
                (name,)
            )
            row = cur.fetchone()
            result = dict(row) if row else {"error": "not found"}

        # ─── List medicines ───────────────────────────────────────────────
        elif action == "list":
            limit = min(params.get("limit", 20), 100)
            offset = params.get("offset", 0)
            in_stock = params.get("in_stock")
            sort = params.get("sort", "name")
            valid_sorts = {"name": "name", "price": "price", "updated": "updated_at"}
            sort_col = valid_sorts.get(sort, "name")

            if in_stock is not None:
                cur.execute(
                    f"SELECT name, price, country, vendor, in_stock, updated_at::text "
                    f"FROM medicines WHERE in_stock = %s ORDER BY {sort_col} LIMIT %s OFFSET %s",
                    (in_stock, limit, offset)
                )
            else:
                cur.execute(
                    f"SELECT name, price, country, vendor, in_stock, updated_at::text "
                    f"FROM medicines ORDER BY {sort_col} LIMIT %s OFFSET %s",
                    (limit, offset)
                )
            result = {"medicines": [dict(r) for r in cur.fetchall()]}

        # ─── Stats ───────────────────────────────────────────────────────
        elif action == "stats":
            cur.execute("""
                SELECT
                    COUNT(*) as total_medicines,
                    COUNT(*) FILTER (WHERE in_stock = TRUE) as in_stock,
                    COUNT(*) FILTER (WHERE in_stock = FALSE) as out_of_stock,
                    COALESCE(MIN(price), 0) as min_price,
                    COALESCE(MAX(price), 0) as max_price,
                    COALESCE(ROUND(AVG(price)::numeric, 2), 0) as avg_price,
                    COUNT(DISTINCT country) as countries,
                    MAX(updated_at)::text as last_updated
                FROM medicines
            """)
            result = dict(cur.fetchone())

        # ─── Count ───────────────────────────────────────────────────────
        elif action == "count":
            in_stock = params.get("in_stock")
            if in_stock is not None:
                cur.execute("SELECT COUNT(*) as count FROM medicines WHERE in_stock = %s", (in_stock,))
            else:
                cur.execute("SELECT COUNT(*) as count FROM medicines")
            result = dict(cur.fetchone())

        # ─── Duplicates ──────────────────────────────────────────────────
        elif action == "duplicates":
            cur.execute("""
                SELECT name, COUNT(*) as count
                FROM medicines
                GROUP BY name HAVING COUNT(*) > 1
                ORDER BY count DESC LIMIT 100
            """)
            result = {"duplicates": [dict(r) for r in cur.fetchall()]}

        # ─── History ─────────────────────────────────────────────────────
        elif action == "history":
            cur.execute("""
                SELECT sync_time::text, upserted_count, in_stock_count, out_of_stock_count
                FROM sync_logs ORDER BY sync_time DESC LIMIT 50
            """)
            result = {"history": [dict(r) for r in cur.fetchall()]}

        # ─── Cleanup archive ─────────────────────────────────────────────
        elif action == "cleanup_archive":
            cur.execute("DELETE FROM medicines WHERE in_stock = FALSE")
            result = {"message": f"Deleted {cur.rowcount} out-of-stock items."}

        # ─── Delete All Orders ───────────────────────────────────────────
        elif action == "delete_all_orders":
            # Удаляем все товары из заказов, а затем сами заказы (CASCADE решает зависимости)
            cur.execute("TRUNCATE TABLE order_items RESTART IDENTITY CASCADE")
            cur.execute("TRUNCATE TABLE orders RESTART IDENTITY CASCADE")
            result = {"message": "All orders and their items were successfully deleted."}

        elif action == "wipe_db":
            cur.execute("TRUNCATE TABLE medicines")
            result = {"message": "Database wiped."}

        # ═══ CATEGORIES ══════════════════════════════════════════════════

        elif action == "list_categories":
            cur.execute("""
                SELECT id, slug, name, icon, color, sort_order, is_active
                FROM categories ORDER BY sort_order, id
            """)
            result = {"categories": [dict(r) for r in cur.fetchall()]}

        elif action == "get_category_medicines":
            slug = params.get("slug", "")
            cur.execute("""
                SELECT c.id as category_id, c.name as category_name, c.icon
                FROM categories c WHERE c.slug = %s
            """, (slug,))
            cat = cur.fetchone()
            if not cat:
                result = {"error": "Category not found"}
            else:
                cur.execute("""
                    SELECT cm.medicine_name, cm.sort_order,
                           m.price, m.country, m.vendor, m.in_stock
                    FROM category_medicines cm
                    LEFT JOIN medicines m ON m.name = cm.medicine_name
                    WHERE cm.category_id = %s
                    ORDER BY cm.sort_order, cm.medicine_name
                """, (cat["category_id"],))
                meds = [dict(r) for r in cur.fetchall()]
                result = {
                    "category": dict(cat),
                    "medicines": meds
                }

        elif action == "create_category":
            slug = params.get("slug", "").strip().lower()
            name = params.get("name", "").strip()
            icon = params.get("icon", "💊")
            color = params.get("color", "#E31E24")
            if not slug or not name:
                result = {"error": "slug and name required"}
            else:
                cur.execute("""
                    INSERT INTO categories (slug, name, icon, color)
                    VALUES (%s, %s, %s, %s) RETURNING id
                """, (slug, name, icon, color))
                result = {"id": cur.fetchone()["id"], "success": True}

        elif action == "update_category":
            cat_id = params.get("id")
            name = params.get("name")
            icon = params.get("icon")
            color = params.get("color")
            is_active = params.get("is_active")
            if not cat_id:
                result = {"error": "id required"}
            else:
                updates = []
                vals = []
                if name is not None: updates.append("name = %s"); vals.append(name)
                if icon is not None: updates.append("icon = %s"); vals.append(icon)
                if color is not None: updates.append("color = %s"); vals.append(color)
                if is_active is not None: updates.append("is_active = %s"); vals.append(is_active)
                if updates:
                    vals.append(cat_id)
                    cur.execute(f"UPDATE categories SET {', '.join(updates)} WHERE id = %s", vals)
                result = {"success": True}

        elif action == "delete_category":
            cat_id = params.get("id")
            cur.execute("DELETE FROM categories WHERE id = %s", (cat_id,))
            result = {"success": True}

        elif action == "add_category_medicine":
            slug = params.get("slug", "")
            medicine_name = params.get("medicine_name", "")
            cur.execute("SELECT id FROM categories WHERE slug = %s", (slug,))
            cat = cur.fetchone()
            if not cat:
                result = {"error": "Category not found"}
            else:
                cur.execute("""
                    INSERT INTO category_medicines (category_id, medicine_name)
                    VALUES (%s, %s) ON CONFLICT DO NOTHING
                """, (cat["id"], medicine_name))
                result = {"success": True}

        elif action == "remove_category_medicine":
            slug = params.get("slug", "")
            medicine_name = params.get("medicine_name", "")
            cur.execute("SELECT id FROM categories WHERE slug = %s", (slug,))
            cat = cur.fetchone()
            if cat:
                cur.execute("""
                    DELETE FROM category_medicines
                    WHERE category_id = %s AND medicine_name = %s
                """, (cat["id"], medicine_name))
            result = {"success": True}

        elif action == "reorder_categories":
            order = params.get("order", [])  # [{"id": 1, "sort_order": 0}, ...]
            for item in order:
                cur.execute(
                    "UPDATE categories SET sort_order = %s WHERE id = %s",
                    (item.get("sort_order", 0), item.get("id"))
                )
            result = {"success": True}

        # ═══ FEATURED PRODUCTS ═══════════════════════════════════════════

        elif action == "list_featured":
            cur.execute("""
                SELECT fp.medicine_name, fp.sort_order,
                       m.price, m.country, m.vendor, m.in_stock
                FROM featured_products fp
                LEFT JOIN medicines m ON m.name = fp.medicine_name
                ORDER BY fp.sort_order, fp.medicine_name
            """)
            result = {"featured": [dict(r) for r in cur.fetchall()]}

        elif action == "set_featured":
            medicine_name = params.get("medicine_name", "")
            if not medicine_name:
                result = {"error": "medicine_name required"}
            else:
                cur.execute("""
                    INSERT INTO featured_products (medicine_name)
                    VALUES (%s) ON CONFLICT (medicine_name) DO NOTHING
                """, (medicine_name,))
                result = {"success": True}

        elif action == "remove_featured":
            medicine_name = params.get("medicine_name", "")
            cur.execute("DELETE FROM featured_products WHERE medicine_name = %s", (medicine_name,))
            result = {"success": True}

        # ═══ ORDERS ══════════════════════════════════════════════════════

        elif action == "create_order":
            customer_name = params.get("customer_name")
            phone = params.get("phone")
            address = params.get("address")
            items = params.get("items", [])

            if not all([customer_name, phone, address, items]):
                result = {"error": "Missing required fields"}
            else:
                cur.execute("""
                    INSERT INTO users (phone, name, address)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address
                    RETURNING id
                """, (phone, customer_name, address))
                user_id = cur.fetchone()["id"]
                total = sum(Decimal(str(i["price"])) * int(i["quantity"]) for i in items)
                cur.execute("""
                    INSERT INTO orders (user_id, customer_name, phone, address, total_price, status)
                    VALUES (%s, %s, %s, %s, %s, 'pending') RETURNING id
                """, (user_id, customer_name, phone, address, total))
                order_id = cur.fetchone()["id"]
                for item in items:
                    cur.execute("""
                        INSERT INTO order_items (order_id, medicine_name, price, quantity)
                        VALUES (%s, %s, %s, %s)
                    """, (order_id, item["medicine_name"], item["price"], item["quantity"]))
                result = {"order_id": order_id, "message": "Order created"}

        elif action == "get_order_status":
            order_id = params.get("order_id")
            phone_last4 = params.get("phone_last4")
            if not order_id or not phone_last4:
                result = {"error": "order_id and phone_last4 required"}
            else:
                cur.execute("""
                    SELECT id, customer_name, phone, address, total_price, status, created_at::text
                    FROM orders WHERE id = %s AND RIGHT(phone, 4) = %s
                """, (order_id, str(phone_last4)))
                order = cur.fetchone()
                if not order:
                    result = {"error": "Order not found or invalid credentials"}
                else:
                    cur.execute("SELECT medicine_name, price, quantity FROM order_items WHERE order_id = %s", (order_id,))
                    order_data = dict(order)
                    order_data["items"] = [dict(i) for i in cur.fetchall()]
                    result = order_data

        elif action == "list_orders":
            status = params.get("status")
            if status:
                cur.execute("""
                    SELECT id, customer_name, phone, address, total_price, status, created_at::text
                    FROM orders WHERE status = %s ORDER BY id DESC LIMIT 100
                """, (status,))
            else:
                cur.execute("""
                    SELECT id, customer_name, phone, address, total_price, status, created_at::text
                    FROM orders ORDER BY id DESC LIMIT 100
                """)
            orders = [dict(r) for r in cur.fetchall()]
            for o in orders:
                cur.execute("SELECT medicine_name, price, quantity FROM order_items WHERE order_id = %s", (o["id"],))
                o["items"] = [dict(i) for i in cur.fetchall()]
            result = {"orders": orders}

        elif action == "update_order":
            order_id = params.get("order_id")
            new_status = params.get("status")
            if not order_id or not new_status:
                result = {"error": "Missing order_id or status"}
            else:
                cur.execute("UPDATE orders SET status = %s WHERE id = %s", (new_status, order_id))
                result = {"success": True}

        else:
            result = {"error": f"Unknown action: {action}"}

        cur.close()
        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps(result, cls=DecimalEncoder, ensure_ascii=False),
        }

    except Exception as e:
        logger.error(f"Query error: {e}", exc_info=True)
        global _connection
        _connection = None
        return {
            "statusCode": 500,
            "body": json.dumps({"error": str(e)}),
        }
