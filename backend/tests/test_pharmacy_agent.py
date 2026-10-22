import datetime as dt
import decimal
import os
import tempfile
import unittest

from backend.pharmacy_agent import pharmacy_agent as agent


STOCK = agent.TableSpec("T_SKLAD_STATE", "SKLAD_STATE_ID", "CHANGE_ID", 60, 900)
INCOME = agent.TableSpec("T_INCOME", "INCOME_ID", None, 60, 7200)
COLUMNS = ["SKLAD_STATE_ID", "PRODUCT_COUNT_SKLAD", "CHANGE_ID", "NOTE"]


class FakeSource:
    """In-memory stand-in for OracleSource."""

    def __init__(self, rows):
        self.rows = {spec: list(values) for spec, values in rows.items()}

    def page_by_key(self, spec, after_key, limit):
        key_index = 0
        rows = sorted(self.rows[spec.name], key=lambda row: row[key_index])
        if after_key is not None:
            rows = [row for row in rows if row[key_index] > after_key]
        return self.columns(spec), rows[:limit]

    def changed_since(self, spec, change_id, limit):
        rows = sorted((row for row in self.rows[spec.name] if row[2] > change_id), key=lambda row: row[2])
        return self.columns(spec), rows[:limit]

    @staticmethod
    def columns(spec):
        return COLUMNS if spec.name == "T_SKLAD_STATE" else ["INCOME_ID", "INCOME_COUNT"]


class Harness:
    def __init__(self, directory, rows, tables=(STOCK,)):
        self.posts = []
        self.state = agent.StateStore(os.path.join(directory, "state.sqlite3"))
        self.source = FakeSource(rows)
        self.now = 1000.0
        sender = agent.Sender(1, self.state, lambda path, payload: self.posts.append(payload))
        self.sync = agent.Synchronizer(self.source, self.state, sender, tables, change_overlap=5, clock=lambda: self.now)

    def sent_keys(self):
        return [row["key"] for payload in self.posts for row in payload["upserts"]]

    def deleted_keys(self):
        return [key for payload in self.posts for key in payload["deletes"]]


class EncodingTests(unittest.TestCase):
    def test_oracle_values_become_exact_json_scalars(self):
        self.assertEqual(agent.encode_value(decimal.Decimal("114993")), 114993)
        self.assertEqual(agent.encode_value(decimal.Decimal("0.000334")), "0.000334")
        self.assertEqual(agent.encode_value(decimal.Decimal("37.50")), "37.5")
        self.assertEqual(agent.encode_value(dt.datetime(2026, 10, 19, 9, 57, 1, 5)), "2026-10-19T09:57:01")
        self.assertEqual(agent.encode_value("Немозол,ж/таб"), "Немозол,ж/таб")
        self.assertIsNone(agent.encode_value(None))
        self.assertIsNone(agent.encode_value(object()))

    def test_record_omits_nulls_and_hash_is_stable(self):
        first = agent.build_record(COLUMNS, (decimal.Decimal(5), decimal.Decimal("1"), decimal.Decimal(77), None), STOCK)
        second = agent.build_record(COLUMNS, (decimal.Decimal(5), decimal.Decimal("1"), decimal.Decimal(77), None), STOCK)
        self.assertEqual(first.key, "5")
        self.assertEqual(first.change_id, 77)
        self.assertNotIn("NOTE", first.data)
        self.assertEqual(first.row_hash, second.row_hash)

    def test_batches_respect_row_and_size_limits(self):
        records = [agent.Record(str(i), None, {"A": i}, "h", 1000) for i in range(4500)]
        chunks = list(agent.chunk_records(records))
        self.assertEqual([len(chunk) for chunk in chunks], [1500, 1500, 1500])


class SynchronizerTests(unittest.TestCase):
    def test_first_cycle_sends_everything_then_nothing(self):
        with tempfile.TemporaryDirectory() as directory:
            h = Harness(directory, {"T_SKLAD_STATE": [(1, 2, 10, None), (2, 3, 11, None)]})
            h.sync.run_cycle(force_full=True)
            self.assertEqual(h.sent_keys(), ["1", "2"])
            h.posts.clear()
            h.now += 61
            h.sync.run_cycle()
            self.assertEqual(h.posts, [])

    def test_delta_sends_only_really_changed_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            h = Harness(directory, {"T_SKLAD_STATE": [(1, 2, 10, None), (2, 3, 11, None)]})
            h.sync.run_cycle(force_full=True)
            h.posts.clear()
            h.source.rows["T_SKLAD_STATE"] = [(1, 1, 12, None), (2, 3, 11, None), (3, 9, 13, None)]
            h.now += 61
            summary = h.sync.run_cycle()
            self.assertEqual(sorted(h.sent_keys()), ["1", "3"])
            self.assertEqual(summary["T_SKLAD_STATE"], {"mode": "delta", "sent": 2})
            self.assertEqual(h.state.get("T_SKLAD_STATE")["last_change_id"], 13)

    def test_full_scan_detects_deleted_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            h = Harness(directory, {"T_SKLAD_STATE": [(1, 2, 10, None), (2, 3, 11, None)]})
            h.sync.run_cycle(force_full=True)
            h.posts.clear()
            h.source.rows["T_SKLAD_STATE"] = [(2, 3, 11, None)]
            h.now += 901
            h.sync.run_cycle()
            self.assertEqual(h.deleted_keys(), ["1"])
            self.assertEqual(h.state.count("T_SKLAD_STATE"), 1)

    def test_failed_upload_is_retried_next_cycle(self):
        with tempfile.TemporaryDirectory() as directory:
            h = Harness(directory, {"T_SKLAD_STATE": [(1, 2, 10, None)]})

            def failing_post(path, payload):
                raise RuntimeError("network down")

            h.sync.sender.post = failing_post
            summary = h.sync.run_cycle(force_full=True)
            self.assertEqual(summary["T_SKLAD_STATE"]["mode"], "error")
            self.assertEqual(h.state.count("T_SKLAD_STATE"), 0)
            h.sync.sender.post = lambda path, payload: h.posts.append(payload)
            h.sync.run_cycle()
            self.assertEqual(h.sent_keys(), ["1"])

    def test_suspicious_empty_scan_does_not_delete_server_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            rows = [(i, 1, i, None) for i in range(1, 1201)]
            h = Harness(directory, {"T_SKLAD_STATE": rows})
            h.sync.run_cycle(force_full=True)
            h.posts.clear()
            h.source.rows["T_SKLAD_STATE"] = rows[:10]
            summary = h.sync.run_cycle(force_full=True)
            self.assertEqual(summary["T_SKLAD_STATE"]["mode"], "error")
            self.assertEqual(h.deleted_keys(), [])
            self.assertEqual(h.state.count("T_SKLAD_STATE"), 1200)

    def test_table_without_change_id_reads_new_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            h = Harness(directory, {"T_INCOME": [(1, 5), (2, 6)]}, tables=(INCOME,))
            h.sync.run_cycle(force_full=True)
            h.posts.clear()
            h.source.rows["T_INCOME"].append((3, 7))
            h.now += 61
            h.sync.run_cycle()
            self.assertEqual(h.sent_keys(), ["3"])
            self.assertEqual(h.state.get("T_INCOME")["max_key"], 3)

    def test_server_without_rows_forces_resend(self):
        with tempfile.TemporaryDirectory() as directory:
            h = Harness(directory, {"T_SKLAD_STATE": [(1, 2, 10, None)]})
            h.sync.run_cycle(force_full=True)
            reset = h.sync.reconcile_with_server({"tables": []})
            self.assertEqual(reset, ["T_SKLAD_STATE"])
            self.assertEqual(h.state.count("T_SKLAD_STATE"), 0)

    def test_agent_tables_match_server_allowlist(self):
        from backend.v1.shared.pharmacy_mirror import DEFAULT_MIRROR_TABLES

        self.assertEqual({spec.name for spec in agent.DEFAULT_TABLES}, set(DEFAULT_MIRROR_TABLES))


if __name__ == "__main__":
    unittest.main()
