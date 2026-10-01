import unittest
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import MagicMock, patch

from backend.v1.public_api.lambda_function import search_medicines
from backend.v1.shared.search_ranking import (
    edit_distances,
    normalize,
    query_variants,
    rank_candidates,
    retrieval_terms,
    word_match,
)


CATALOGUE = [
    "Кетоконазол 50мг капс №50",
    "Кетотифен 1г капс №50",
    "КЕТОРОЛ 10МГ ТАБ №20",
    "Кетонал 100мг капс №25",
    "Нурон 1г таб №10",
    "НУРОН 50МГ ТАБ №50",
    "Нурофен 200мг таб №10",
    "НУРОФЕН ЭКСПРЕСС ФОРТЕ КАПС 400МГ №10",
    "Нурофен для детей сусп 100мг/5мл 100мл",
    "Парацетамол 500мг таб №10",
    "Паракс 500мг сироп №30",
    "Цефтриаксон 1г пор д/ин фл №1",
    "Витамин D3 2000МЕ капс №60",
    "Магне B6 таб №50",
    "Но-шпа 40мг таб №24",
    "Валериана экстракт 20мг таб №50",
    "Амоксициллин 500мг капс №16",
    "Ампициллин 500мг таб №10",
]


def _rows(names=CATALOGUE):
    return [{"id": index, "name": name} for index, name in enumerate(names, start=1)]


def _ranked_names(query):
    return [row["name"] for row in rank_candidates(query, _rows())]


class NormalizationTests(unittest.TestCase):
    def test_folds_yo_tajik_letters_and_latin(self):
        self.assertEqual(normalize("Ёж ҳ Nurofen"), "еж х нурофен")
        self.assertEqual(normalize("paracetamol"), "парацетамол")

    def test_repairs_wrong_keyboard_layout(self):
        variants = query_variants("gfhfwtnfvjk")
        self.assertIn("парацетамол", [token.text for variant in variants for token in variant])

    def test_retrieval_skips_generic_words_when_medicine_word_present(self):
        self.assertEqual(retrieval_terms(query_variants("кетанол капс 100")), ["кетанол"])
        self.assertEqual(retrieval_terms(query_variants("таб")), ["таб"])

    def test_retrieval_keeps_latin_brand_spelling(self):
        terms = retrieval_terms(query_variants("box"), raw_query="box")
        self.assertEqual(terms[0], "box")
        self.assertIn("бокс", terms)
        self.assertEqual(retrieval_terms(query_variants("Now"), raw_query="Now")[0], "now")


class DistanceTests(unittest.TestCase):
    def test_common_russian_confusions_are_cheaper(self):
        self.assertEqual(edit_distances("кетанол", "кетонал")[0], 1.0)
        self.assertEqual(edit_distances("кетанол", "кеторол")[0], 1.5)
        self.assertEqual(edit_distances("амоксицилин", "амоксициллин")[0], 0.5)

    def test_prefix_distance_supports_unfinished_words(self):
        self.assertEqual(edit_distances("парацит", "парацетамол")[1], 0.5)

    def test_word_match_prefers_exact_then_prefix_then_typo(self):
        exact = word_match("нурофен", "нурофен")
        prefix = word_match("нуро", "нурофен")
        typo = word_match("нурафен", "нурофен")
        self.assertGreater(exact, prefix)
        self.assertGreater(prefix, typo)
        self.assertGreater(typo, 0)
        self.assertEqual(word_match("нурафен", "нурон"), 0.0)
        self.assertEqual(word_match("500", "50"), 0.0)


class RankingTests(unittest.TestCase):
    def test_typo_in_name_beats_exact_dosage_form(self):
        names = _ranked_names("кетанол капс")
        self.assertEqual(names[0], "Кетонал 100мг капс №25")
        self.assertNotIn("Кетоконазол 50мг капс №50", names)

    def test_all_variants_of_misspelled_brand_come_before_other_brands(self):
        names = _ranked_names("нурафен таб")
        self.assertEqual(set(names[:3]), {name for name in CATALOGUE if "урофен" in name.casefold()})
        self.assertFalse(any("нурон" in name.casefold() for name in names))

    def test_latin_layout_and_joined_words(self):
        self.assertEqual(_ranked_names("nurofen")[0], "Нурофен 200мг таб №10")
        self.assertEqual(_ranked_names("gfhfwtnfvjk")[0], "Парацетамол 500мг таб №10")
        # Wrong layout and a missing letter at the same time.
        self.assertEqual(_ranked_names("ghfwtnfvjk")[0], "Парацетамол 500мг таб №10")
        self.assertEqual(_ranked_names("ношпа")[0], "Но-шпа 40мг таб №24")
        self.assertEqual(_ranked_names("магне б6")[0], "Магне B6 таб №50")
        self.assertEqual(_ranked_names("витамин д")[0], "Витамин D3 2000МЕ капс №60")

    def test_synonyms_and_doubled_letters(self):
        self.assertEqual(_ranked_names("валерьянка")[0], "Валериана экстракт 20мг таб №50")
        self.assertEqual(_ranked_names("амоксицилин 500")[0], "Амоксициллин 500мг капс №16")
        self.assertEqual(_ranked_names("цефтриоксон")[0], "Цефтриаксон 1г пор д/ин фл №1")

    def test_similar_suffix_brands_do_not_outrank_typo(self):
        names = [row["name"] for row in rank_candidates("Осфикс", _rows([
            "Зеффикс,т.п.о,0.1,№ 28",
            "Графикс №10 таб.",
            "Графикс Эйр № 12",
            "Графикс Презер класик №12",
            "Освикс (клопидогрель) 75 мг №30 тб",
        ]))]
        self.assertEqual(names, ["Освикс (клопидогрель) 75 мг №30 тб"])

    def test_number_does_not_outweigh_misspelled_name(self):
        self.assertEqual(_ranked_names("парацитамол 500")[0], "Парацетамол 500мг таб №10")


class SearchEndpointTests(unittest.TestCase):
    @staticmethod
    def _db_rows(names):
        return [{
            "id": index,
            "name": name,
            "price": Decimal("10.00"),
            "country": None,
            "vendor": None,
            "in_stock": True,
            "updated_at": datetime(2026, 9, 30, tzinfo=timezone.utc),
            "image_url": None,
            "selling_unit_price": 10,
            "recall_score": 1,
        } for index, name in enumerate(names, start=1)]

    def _search(self, query, names):
        cursor = MagicMock()
        cursor.fetchall.return_value = self._db_rows(names)

        @contextmanager
        def fake_transaction():
            yield cursor

        with patch("backend.v1.public_api.lambda_function.transaction", fake_transaction):
            return search_medicines(query), cursor

    def test_reranks_candidates_and_paginates(self):
        page, cursor = self._search({"q": "кетанол капс", "limit": "1"}, CATALOGUE)
        sql, params = cursor.execute.call_args.args
        self.assertIn("word_similarity", sql)
        self.assertEqual(params[0], ["кетанол"])
        self.assertEqual([item["medicine_name"] for item in page["data"]], ["Кетонал 100мг капс №25"])
        self.assertEqual(page["page"]["total_items"], 1)
        self.assertEqual(page["did_you_mean"], "Кетонал капс")

    def test_numbered_page_reports_totals(self):
        names = [f"Нурофен {dose}мг таб №10" for dose in range(1, 51)]
        page, _ = self._search({"q": "нурофен", "limit": "24", "page": "3"}, names)
        self.assertEqual(len(page["data"]), 2)
        self.assertEqual(page["page"]["number"], 3)
        self.assertEqual(page["page"]["total_items"], 50)
        self.assertEqual(page["page"]["total_pages"], 3)
        self.assertFalse(page["page"]["has_more"])

    def test_irrelevant_candidates_are_not_shown_but_suggested(self):
        page, _ = self._search({"q": "кетонол"}, ["Кетонал 100мг капс №25", "Кетоконазол 50мг капс №50"])
        self.assertEqual([item["medicine_name"] for item in page["data"]], ["Кетонал 100мг капс №25"])
        self.assertEqual(page["did_you_mean"], "Кетонал")
        page, _ = self._search({"q": "zzqx"}, ["Кетонал 100мг капс №25"])
        self.assertEqual(page["data"], [])

    def test_latin_brand_beats_transliterated_and_fuzzy_matches(self):
        names = ["Таблетница бокс", "Медаокс №10", "BOX Аптечка домашняя (маленькая)", "Бозентас №20"]
        page, cursor = self._search({"q": "box", "limit": "24"}, names)
        self.assertEqual(cursor.execute.call_args.args[1][0][0], "box")
        self.assertEqual(page["data"][0]["medicine_name"], "BOX Аптечка домашняя (маленькая)")
        self.assertNotIn("Медаокс №10", [item["medicine_name"] for item in page["data"]])

if __name__ == "__main__":
    unittest.main()
