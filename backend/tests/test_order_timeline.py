"""Job 016: order history events built from status history and the admin audit log."""
import json
import unittest
from datetime import datetime, timedelta, timezone

from backend.v1.shared.order_timeline import (
    COURIER_ACTIONS,
    EVENT_KEYS,
    TIMELINE_LIMIT,
    audit_actor,
    build_timeline,
    courier_view,
    history_actor,
    map_audit_row,
)

T0 = datetime(2026, 10, 20, 6, 0, tzinfo=timezone.utc)
NAMES = {81: 'Парацетамол', 82: 'Ибупрофен'}


def audit(action, details=None, actor='staff:1', minutes=1, row_id=1, resource_type='order',
          resource_id='ord_' + 'a' * 32):
    return {'id': row_id, 'actor_id': actor, 'action': action, 'resource_type': resource_type,
            'resource_id': resource_id, 'details': details if details is not None else {},
            'created_at': T0 + timedelta(minutes=minutes)}


def one(action, details=None, **kwargs):
    events = map_audit_row(audit(action, details, **kwargs), NAMES)
    assert len(events) == 1, events
    return events[0]


def all_keys(events):
    keys = set()
    for event in events:
        keys |= set(event)
        for change in event.get('fields') or []:
            keys |= {'fields.' + key for key in change}
    return keys


class MappingTests(unittest.TestCase):
    def test_actor_mapping(self):
        self.assertEqual(audit_actor('staff:1'), {'actor': 'pharmacy', 'pharmacy_id': 1})
        self.assertEqual(audit_actor('staff:2'), {'actor': 'pharmacy', 'pharmacy_id': 2})
        self.assertEqual(audit_actor('staff:3'), {'actor': 'courier'})
        self.assertEqual(audit_actor('admin:mvp-token'), {'actor': 'admin'})
        self.assertEqual(audit_actor('staff:9'), {'actor': 'system'})
        self.assertEqual(history_actor('customer', None), {'actor': 'customer'})
        self.assertEqual(history_actor('admin', 'boss'), {'actor': 'admin'})
        self.assertEqual(history_actor('staff', 'courier:3'), {'actor': 'courier'})
        self.assertEqual(history_actor('staff', '2'), {'actor': 'pharmacy', 'pharmacy_id': 2})
        self.assertEqual(history_actor('legacy_import', None), {'actor': 'system'})

    def test_items_answered_splits_answers_and_routing(self):
        events = map_audit_row(audit('pharmacy.order.items_answered', {
            'pharmacy_id': 1, 'items': [{'order_item_id': 81, 'answer': 'available'},
                                        {'order_item_id': 82, 'answer': 'unavailable'},
                                        {'order_item_id': 83, 'answer': 'bogus'}],
            'routed_to_pharmacy_2': [82]}), NAMES)
        self.assertEqual([(e['kind'], e['order_item_id'], e['answer'], e['pharmacy_id']) for e in events],
                         [('pharmacy_answer', 81, 'available', 1), ('pharmacy_routed', 82, 'unavailable', 1)])
        self.assertEqual(events[0]['medicine_name'], 'Парацетамол')
        self.assertEqual(events[0]['actor'], 'pharmacy')

    def test_pharmacy_price_change(self):
        event = one('pharmacy.order.item_price_changed', {'pharmacy_id': 2, 'items': [
            {'order_item_id': 82, 'previous_base_unit_price': '25.00', 'new_base_unit_price': '28.00',
             'new_selling_unit_price': '32.20'}]}, actor='staff:2')
        self.assertEqual((event['kind'], event['pharmacy_id'], event['previous_price'], event['new_price'],
                          event['client_price'], event['medicine_name']),
                         ('pharmacy_price_changed', 2, '25.00', '28.00', '32.20', 'Ибупрофен'))

    def test_assembly_events(self):
        self.assertEqual(one('pharmacy.order.item_collected', {'pharmacy_id': 2, 'order_item_id': 82},
                             actor='staff:2')['kind'], 'item_collected')
        marked = one('pharmacy.order.assembly_marked', {'pharmacy_id': 1, 'from_state': 'assembling',
                                                        'to_state': 'assembled', 'answered_available': [81]})
        self.assertEqual((marked['kind'], marked['state'], marked['pharmacy_id']), ('assembly_marked', 'assembled', 1))
        self.assertNotIn('answered_available', marked)
        reopened = one('pharmacy.order.assembly_reopened', {'pharmacy_id': 2, 'routed_order_item_ids': [82]})
        self.assertEqual((reopened['kind'], reopened['actor'], reopened['pharmacy_id']),
                         ('assembly_reopened', 'pharmacy', 1))

    def test_courier_checklist_and_status(self):
        step = one('courier.order.checklist_updated', {'step': 2, 'done': False}, actor='staff:3')
        self.assertEqual((step['kind'], step['actor'], step['step'], step['done']),
                         ('checklist_updated', 'courier', 2, False))
        status = one('courier.order.status_changed', {'from_status': 'confirmed', 'to_status': 'delivering'},
                     actor='staff:3')
        self.assertEqual((status['kind'], status['from_status'], status['to_status']),
                         ('status_changed', 'confirmed', 'delivering'))

    def test_customer_updates_list_only_changed_fields(self):
        for action, actor in (('order.customer_updated', 'admin'), ('courier.order.customer_updated', 'staff:3')):
            event = one(action, {'previous': {'customer_name': 'Али', 'phone': '+992900000001', 'address': 'A'},
                                 'current': {'customer_name': 'Али', 'phone': '+992900000002', 'address': 'B'},
                                 'revision': 3}, actor=actor)
            self.assertEqual(event['kind'], 'customer_updated')
            self.assertEqual(event['fields'], [
                {'field': 'phone', 'previous': '+992900000001', 'current': '+992900000002'},
                {'field': 'address', 'previous': 'A', 'current': 'B'}])
            self.assertNotIn('revision', event)

    def test_admin_item_edits(self):
        price = one('order.item_price_updated', {
            'reference': '2010-001', 'medicine_name': 'Парацетамол', 'previous_unit_price': '10.00',
            'new_unit_price': '12.00', 'previous_base_unit_price': '8.00', 'new_base_unit_price': '8.00',
            'quantity': '1', 'line_total': '12.00', 'order_total': '30.00'},
            actor='admin', resource_type='order_item', resource_id='81')
        self.assertEqual((price['kind'], price['order_item_id'], price['fields']),
                         ('item_updated', 81, [{'field': 'client_price', 'previous': '10.00', 'current': '12.00'}]))
        quantity = one('order.item_quantity_set', {'order_reference': '2010-001', 'medicine_name': 'Ибупрофен',
                                                   'previous_quantity': '1', 'new_quantity': '2'},
                       actor='admin', resource_type='order_item', resource_id='82')
        self.assertEqual(quantity['fields'], [{'field': 'quantity', 'previous': '1', 'current': '2'}])
        removed = one('order.item_removed', {'medicine_name': 'Старое', 'new_quantity': '0'},
                      actor='admin', resource_type='order_item', resource_id='79')
        self.assertEqual((removed['kind'], removed['order_item_id'], removed['medicine_name']),
                         ('item_removed', 79, 'Старое'))

    def test_courier_item_edits(self):
        updated = one('courier.order.item_updated', {'medicine_name': 'X', 'previous_quantity': '1',
                                                     'previous_price': '5.00', 'new_quantity': None,
                                                     'new_price': '6.00'},
                      actor='staff:3', resource_type='order_item', resource_id='81')
        self.assertEqual(updated['fields'], [{'field': 'client_price', 'previous': '5.00', 'current': '6.00'}])
        removed = one('courier.order.item_removed', {'medicine_name': 'X'}, actor='staff:3',
                      resource_type='order_item', resource_id='81')
        self.assertEqual((removed['kind'], removed['actor']), ('item_removed', 'courier'))

    def test_items_added_and_delivery_and_delete_and_created(self):
        for action, details in (('admin.order.items_added', {'items': [{'medicine_id': 1}, {'medicine_id': 2}]}),
                                ('courier.order.items_added', {'items': [{'medicine_id': 1}, {'medicine_id': 2}]}),
                                ('order.manual_items_added', {'manual_items': [{'medicine_name': 'a'}, {}]})):
            event = one(action, details)
            self.assertEqual((event['kind'], event['count']), ('items_added', 2))
        fee = one('order.delivery_fee_updated', {'previous_courier_amount': '0.00', 'previous_owner_amount': '0.00',
                                                 'courier_amount': '10.00', 'owner_amount': '5.00'}, actor='admin')
        self.assertEqual([change['field'] for change in fee['fields']], ['courier_amount', 'owner_amount'])
        self.assertEqual(one('order.soft_delete', {'reference': 'x', 'status': 'pending'}, actor='admin')['kind'],
                         'deleted')
        self.assertEqual(one('staff.order.created', {'staff_account_id': 3}, actor='staff:3')['kind'], 'created')

    def test_unknown_action_is_other_without_details(self):
        event = one('pharmacy.order.collected_v2', {'secret': 'x', 'phone': '+992900000001'}, actor='staff:2')
        self.assertEqual(event, {'at': (T0 + timedelta(minutes=1)).isoformat(), 'kind': 'other',
                                 'actor': 'pharmacy', 'pharmacy_id': 2})

    def test_details_as_json_text_and_garbage(self):
        event = one('courier.order.checklist_updated', json.dumps({'step': 6, 'done': True}), actor='staff:3')
        self.assertEqual((event['step'], event['done']), (6, True))
        self.assertEqual(one('order.item_quantity_set', 'not json', actor='admin')['kind'], 'item_updated')

    def test_only_whitelisted_keys(self):
        events = map_audit_row(audit('order.customer_updated', {
            'previous': {'customer_name': 'A', 'extra': 'secret'}, 'current': {'customer_name': 'B'},
            'details': {'x': 1}}, actor='admin'), NAMES)
        self.assertTrue(set(events[0]) <= EVENT_KEYS)
        self.assertNotIn('details', events[0])
        self.assertNotIn('secret', json.dumps(events, ensure_ascii=False))


class BuildTimelineTests(unittest.TestCase):
    def test_creation_folds_history_row_and_order_is_by_time_then_id(self):
        history = [
            {'id': 1, 'from_status': None, 'to_status': 'pending', 'actor_type': 'customer', 'actor_id': None,
             'reason': None, 'created_at': T0},
            {'id': 2, 'from_status': 'pending', 'to_status': 'confirmed', 'actor_type': 'staff',
             'actor_id': 'courier:3', 'reason': None, 'created_at': T0 + timedelta(minutes=5)},
        ]
        rows = [audit('courier.order.status_changed', {'from_status': 'pending', 'to_status': 'confirmed'},
                      actor='staff:3', minutes=5, row_id=11),
                audit('pharmacy.order.assembly_marked', {'to_state': 'assembled'}, minutes=3, row_id=12),
                audit('pharmacy.order.item_collected', {'order_item_id': 81}, minutes=3, row_id=10)]
        events, truncated = build_timeline(created_at=T0, creator={'actor': 'customer'}, status_rows=history,
                                           audit_rows=rows, item_names=NAMES)
        self.assertFalse(truncated)
        self.assertEqual([event['kind'] for event in events],
                         ['created', 'item_collected', 'assembly_marked', 'status_changed'])
        self.assertEqual(events[0]['actor'], 'customer')
        self.assertEqual(events[-1]['actor'], 'courier')  # the history row, the audit duplicate is dropped

    def test_creator_from_history_when_unknown(self):
        history = [{'id': 1, 'from_status': None, 'to_status': 'pending', 'actor_type': 'staff', 'actor_id': '2',
                    'reason': 'Источник: phone', 'created_at': T0}]
        events, _ = build_timeline(created_at=T0, creator=None, status_rows=history, audit_rows=[
            audit('staff.order.created', {'staff_account_id': 2}, actor='staff:2')])
        self.assertEqual(events, [{'at': T0.isoformat(), 'kind': 'created', 'actor': 'pharmacy', 'pharmacy_id': 2}])

    def test_cap_keeps_newest_oldest_first(self):
        rows = [audit('courier.order.checklist_updated', {'step': 1, 'done': index % 2 == 0}, actor='staff:3',
                      minutes=index + 1, row_id=index + 1) for index in range(TIMELINE_LIMIT + 10)]
        events, truncated = build_timeline(created_at=T0, creator={'actor': 'customer'}, status_rows=[],
                                           audit_rows=rows)
        self.assertTrue(truncated)
        self.assertEqual(len(events), TIMELINE_LIMIT)
        self.assertNotEqual(events[0]['kind'], 'created')
        self.assertEqual(events[-1]['at'], (T0 + timedelta(minutes=TIMELINE_LIMIT + 10)).isoformat())
        moments = [event['at'] for event in events]
        self.assertEqual(moments, sorted(moments))
        _, flagged = build_timeline(created_at=T0, creator=None, status_rows=[], audit_rows=[],
                                    source_truncated=True)
        self.assertTrue(flagged)


class CourierViewTests(unittest.TestCase):
    def _all_events(self):
        history = [{'id': 1, 'from_status': 'confirmed', 'to_status': 'cancelled', 'actor_type': 'admin',
                    'actor_id': 'boss-admin', 'reason': 'Клиент отказался', 'created_at': T0 + timedelta(minutes=9)},
                   {'id': 2, 'from_status': 'pending', 'to_status': 'confirmed', 'actor_type': 'admin',
                    'actor_id': 'boss-admin', 'reason': 'внутренняя заметка', 'created_at': T0 + timedelta(minutes=2)}]
        rows = [
            audit('order.customer_updated', {'previous': {'phone': '+992900000001'},
                                             'current': {'phone': '+992900000002'}}, actor='boss-admin', row_id=1),
            audit('courier.order.customer_updated', {'previous': {'address': 'Старый адрес'},
                                                     'current': {'address': 'Новый адрес'}}, actor='staff:3', row_id=2),
            audit('order.delivery_fee_updated', {'previous_owner_amount': '0', 'owner_amount': '7.00',
                                                 'previous_courier_amount': '0', 'courier_amount': '10.00'},
                  actor='boss-admin', row_id=3),
            audit('order.item_price_updated', {'previous_base_unit_price': '17.40', 'new_base_unit_price': '19.60',
                                               'previous_unit_price': '10.00', 'new_unit_price': '11.00'},
                  actor='boss-admin', resource_type='order_item', resource_id='81', row_id=4),
            audit('order.soft_delete', {'reference': 'x'}, actor='boss-admin', row_id=5),
            audit('pharmacy.order.items_answered', {'pharmacy_id': 1, 'items': [
                {'order_item_id': 82, 'answer': 'unavailable'}], 'routed_to_pharmacy_2': [82]}, row_id=6),
            audit('pharmacy.order.item_price_changed', {'pharmacy_id': 2, 'items': [
                {'order_item_id': 82, 'previous_base_unit_price': '25.00', 'new_base_unit_price': '28.00'}]},
                  actor='staff:2', row_id=7),
            audit('pharmacy.order.assembly_marked', {'to_state': 'assembled'}, actor='staff:2', row_id=8),
            audit('pharmacy.order.assembly_reopened', {'pharmacy_id': 2}, row_id=9),
            audit('pharmacy.order.item_collected', {'order_item_id': 82}, actor='staff:2', row_id=10),
            audit('courier.order.checklist_updated', {'step': 1, 'done': True}, actor='staff:3', row_id=11),
            audit('something.new', {'phone': '+992900000009'}, actor='boss-admin', row_id=12),
        ]
        events, _ = build_timeline(created_at=T0, creator={'actor': 'customer'}, status_rows=history,
                                   audit_rows=rows, item_names=NAMES)
        return events

    def test_courier_view_keeps_only_allowed_kinds(self):
        events = courier_view(self._all_events())
        self.assertEqual({event['kind'] for event in events},
                         {'created', 'status_changed', 'pharmacy_routed', 'pharmacy_price_changed',
                          'assembly_marked', 'assembly_reopened', 'item_collected', 'checklist_updated'})

    def test_courier_view_strips_forbidden_values(self):
        events = courier_view(self._all_events())
        text = json.dumps(events, ensure_ascii=False)
        for forbidden in ('+992900000001', '+992900000002', 'Старый адрес', 'Новый адрес', '7.00', 'owner',
                          'boss-admin', 'внутренняя заметка', '+992900000009', '17.40', '19.60', 'deleted', 'fields'):
            self.assertNotIn(forbidden, text)
        cancelled = [event for event in events if event.get('to_status') == 'cancelled']
        self.assertEqual(cancelled[0]['reason'], 'Клиент отказался')
        self.assertEqual(cancelled[0]['actor'], 'admin')
        price = [event for event in events if event['kind'] == 'pharmacy_price_changed'][0]
        self.assertEqual((price['previous_price'], price['new_price'], price['pharmacy_id']), ('25.00', '28.00', 2))

    def test_courier_actions_are_courier_kinds(self):
        for action in COURIER_ACTIONS:
            for event in courier_view(map_audit_row(audit(action, {'items': [
                    {'order_item_id': 81, 'answer': 'available'}], 'order_item_id': 81, 'step': 1, 'done': True}))):
                self.assertNotEqual(event['kind'], 'other')


if __name__ == '__main__':
    unittest.main()
