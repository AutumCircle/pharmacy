"""Job 013: customer stage «Собирается → Собран → Подтверждён → В пути → Доставлен» (shared.order_stage)."""
import sqlite3
import unittest

from backend.v1.shared.order_stage import STAGES, assembled_sql, assembly_complete, order_stage


class BoolAnd:
    def __init__(self):
        self.value = None

    def step(self, value):
        self.value = bool(value) if self.value is None else self.value and bool(value)

    def finalize(self):
        return self.value


def stage_of(orders, items=(), answers=(), marks=()):
    """Evaluate the exact SQL fragment on an in-memory database (Postgres-only syntax mapped to SQLite)."""
    db = sqlite3.connect(':memory:')
    db.create_aggregate('bool_and', 1, BoolAnd)
    db.executescript('''
        CREATE TABLE orders (id INTEGER, status TEXT, created_by_staff_account_id INTEGER,
                             fulfillment_pharmacy_id INTEGER);
        CREATE TABLE order_items (id INTEGER, order_id INTEGER, fulfillment_pharmacy_id INTEGER);
        CREATE TABLE order_item_pharmacy_answers (order_item_id INTEGER, pharmacy_id INTEGER, answer TEXT);
        CREATE TABLE order_pharmacy_assembly (order_id INTEGER, pharmacy_id INTEGER, state TEXT);
    ''')
    db.executemany('INSERT INTO orders VALUES (?, ?, ?, ?)', orders)
    db.executemany('INSERT INTO order_items VALUES (?, ?, ?)', items)
    db.executemany('INSERT INTO order_item_pharmacy_answers VALUES (?, ?, ?)', answers)
    db.executemany('INSERT INTO order_pharmacy_assembly VALUES (?, ?, ?)', marks)
    expression = (assembled_sql('o').replace('IS NOT DISTINCT FROM', 'IS')
                  .replace('IS DISTINCT FROM', 'IS NOT'))
    rows = db.execute(f'SELECT o.id, o.status, {expression} FROM orders o ORDER BY o.id').fetchall()
    db.close()
    return {order_id: order_stage(status, bool(assembled)) for order_id, status, assembled in rows}


class OrderStageMapperTests(unittest.TestCase):
    def test_every_status_maps_to_a_stage(self):
        self.assertEqual(order_stage('pending', False), 'assembling')
        self.assertEqual(order_stage('pending', True), 'assembled')
        self.assertEqual(order_stage('pending'), 'assembling')
        self.assertEqual(order_stage('pending', None), 'assembling')
        self.assertEqual(order_stage('pending', 1), 'assembling')  # only a real boolean True counts
        for status in ('confirmed', 'delivering', 'delivered', 'cancelled'):
            for assembled in (False, True):
                with self.subTest(status=status, assembled=assembled):
                    self.assertEqual(order_stage(status, assembled), status)
        self.assertEqual(order_stage('unknown', True), 'assembling')
        self.assertEqual(set(STAGES), {'assembling', 'assembled', 'confirmed', 'delivering', 'delivered', 'cancelled'})

    def test_python_twin_requires_website_order_and_at_least_one_part(self):
        self.assertTrue(assembly_complete(True, ['assembled']))
        self.assertTrue(assembly_complete(True, ['assembled', 'assembled']))
        self.assertFalse(assembly_complete(True, ['assembled', 'waiting']))
        self.assertFalse(assembly_complete(True, ['assembling']))
        self.assertFalse(assembly_complete(True, []))
        self.assertFalse(assembly_complete(False, ['assembled']))

    def test_alias_must_be_an_identifier(self):
        with self.assertRaises(ValueError):
            assembled_sql('o; DROP TABLE orders')
        self.assertIn('o.status = \'pending\'', assembled_sql('o'))
        self.assertIn('orders_x.id', assembled_sql('orders_x'))


class OrderStageSqlTests(unittest.TestCase):
    def test_pending_without_marks_is_assembling(self):
        self.assertEqual(stage_of([(1, 'pending', None, None)], items=[(10, 1, None)]), {1: 'assembling'})

    def test_single_pharmacy_assembled_is_assembled(self):
        stages = stage_of([(1, 'pending', None, None), (2, 'pending', None, None)],
                          items=[(10, 1, None), (11, 1, None), (20, 2, None)],
                          marks=[(1, 1, 'assembled'), (2, 1, 'assembling')])
        self.assertEqual(stages, {1: 'assembled', 2: 'assembling'})

    def test_routed_order_needs_both_pharmacies(self):
        # Item 11 was answered «Нет в наличии» by «Ватан 1» and routed to «Ватан 2».
        items = [(10, 1, None), (11, 1, 2)]
        answers = [(10, 1, 'available'), (11, 1, 'unavailable')]
        only_one = stage_of([(1, 'pending', None, None)], items, answers, marks=[(1, 1, 'assembled')])
        self.assertEqual(only_one, {1: 'assembling'})
        both = stage_of([(1, 'pending', None, None)], items, answers,
                        marks=[(1, 1, 'assembled'), (1, 2, 'assembled')])
        self.assertEqual(both, {1: 'assembled'})

    def test_pharmacy_with_only_unavailable_items_is_not_waited_for(self):
        # «Ватан 2» lacks the routed item too: only «Ватан 1» assembles.
        items = [(10, 1, None), (11, 1, 2)]
        answers = [(11, 1, 'unavailable'), (11, 2, 'unavailable')]
        self.assertEqual(stage_of([(1, 'pending', None, None)], items, answers, marks=[(1, 1, 'assembled')]),
                         {1: 'assembled'})

    def test_everything_unavailable_in_both_pharmacies_stays_assembling(self):
        items = [(10, 1, 2)]
        answers = [(10, 1, 'unavailable'), (10, 2, 'unavailable')]
        self.assertEqual(stage_of([(1, 'pending', None, None)], items, answers), {1: 'assembling'})

    def test_order_without_items_stays_assembling(self):
        self.assertEqual(stage_of([(1, 'pending', None, None)]), {1: 'assembling'})

    def test_staff_created_pending_order_stays_assembling(self):
        for creator in (1, 2, 3):
            with self.subTest(creator=creator):
                self.assertEqual(stage_of([(1, 'pending', creator, creator)], items=[(10, 1, None)],
                                          marks=[(1, creator, 'assembled')]), {1: 'assembling'})

    def test_order_level_pharmacy_two_is_the_assembly_pharmacy(self):
        stages = stage_of([(1, 'pending', None, 2)], items=[(10, 1, None)], marks=[(1, 2, 'assembled')])
        self.assertEqual(stages, {1: 'assembled'})
        wrong = stage_of([(1, 'pending', None, 2)], items=[(10, 1, None)], marks=[(1, 1, 'assembled')])
        self.assertEqual(wrong, {1: 'assembling'})

    def test_other_statuses_map_one_to_one(self):
        orders = [(1, 'confirmed', None, None), (2, 'delivering', None, None), (3, 'delivered', None, None),
                  (4, 'cancelled', None, None)]
        items = [(10 + n, n, None) for n in range(1, 5)]
        marks = [(n, 1, 'assembled') for n in range(1, 5)]
        self.assertEqual(stage_of(orders, items, marks=marks),
                         {1: 'confirmed', 2: 'delivering', 3: 'delivered', 4: 'cancelled'})


if __name__ == '__main__':
    unittest.main()
