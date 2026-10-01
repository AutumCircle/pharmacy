"""Typo-tolerant ranking for public medicine search.

PostgreSQL (pg_trgm) only collects a bounded pool of candidates; the final
order is decided here, word by word:

* every query word is compared with every word of the medicine name using a
  weighted Damerau-Levenshtein distance, where typical Russian spelling
  confusions (а/о, е/и, doubled consonants, ь/ъ ...) are cheaper than
  arbitrary substitutions;
* medicine-name words weigh more than dosage forms, units and numbers, so a
  corrected typo in the drug name beats an exact hit on "таб" or "500";
* Latin input is transliterated ("nurofen") and wrong keyboard layout is
  repaired ("ghfwtnfvjk" -> "парацетамол").

The module is pure Python so it can be unit-tested without a database.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Iterable, Sequence


_TOKEN_RE = re.compile(r"[^\W_]+", re.UNICODE)
_LETTER_DIGIT_RE = re.compile(r"(?<=\D)(?=\d)|(?<=\d)(?=\D)")

_CYRILLIC_FOLD = str.maketrans({
    "ё": "е",
    # Tajik letters are folded to the nearest Russian letter used in catalogue names.
    "ӣ": "и",
    "ӯ": "у",
    "ҳ": "х",
    "қ": "к",
    "ҷ": "ч",
    "ғ": "г",
})

_EN_TO_RU_LAYOUT = dict(zip(
    "qwertyuiop[]asdfghjkl;'zxcvbnm,.`",
    "йцукенгшщзхъфывапролджэячсмитьбюё",
))

_LATIN_DIGRAPHS = (
    ("shch", "щ"), ("sch", "щ"), ("ch", "ч"), ("sh", "ш"), ("zh", "ж"), ("kh", "х"),
    ("ts", "ц"), ("ya", "я"), ("yu", "ю"), ("yo", "е"), ("ph", "ф"), ("th", "т"), ("ck", "к"),
)
_LATIN_LETTERS = {
    "a": "а", "b": "б", "d": "д", "e": "е", "f": "ф", "g": "г", "h": "х", "i": "и",
    "j": "й", "k": "к", "l": "л", "m": "м", "n": "н", "o": "о", "p": "п", "q": "к",
    "r": "р", "s": "с", "t": "т", "u": "у", "v": "в", "w": "в", "x": "кс", "y": "и", "z": "з",
}

# Dosage forms, units and filler words: useful to narrow results, but they must
# never outweigh the medicine name itself.
GENERIC_WORDS = frozenset("""
таб табл таблетки таблетка капс капсулы капсула р ра раствор мазь гель крем сироп сусп
суспензия спрей капли пор порошок амп ампулы фл флакон пак пакет пакетики драже мг мл г
мкг ме ед доз д ин наз для детей детский детская и с в по от шт уп упак
""".split())

# Colloquial names customers type -> names used in the catalogue.
SYNONYMS: dict[str, tuple[str, ...]] = {
    "валерьянка": ("валериана",),
    "аскорбинка": ("аскорбиновая",),
    "зеленка": ("бриллиантовый",),
    "перекись": ("перекись", "водорода"),
    "ношпа": ("но", "шпа"),
    "уголь": ("уголь", "активированный"),
}

_CHEAP_SUBSTITUTIONS = frozenset(
    frozenset(pair)
    for pair in (
        "ао", "еи", "иы", "еэ", "ея", "ий", "шщ", "ьъ", "зс", "дт", "бп", "вф", "гк", "жш", "цс", "юу",
    )
)
_SILENT = frozenset("ьъ")

SIGNIFICANT_WEIGHT = 1.0
NUMBER_WEIGHT = 0.5
GENERIC_WEIGHT = 0.3
MIN_SCORE = 0.45
# Once confident matches exist, weaker ones are hidden instead of filling pages with noise.
CONFIDENT_SCORE = 0.9
MAX_GAP_FROM_BEST = 0.35


def _transliterate(text: str) -> str:
    for latin, cyrillic in _LATIN_DIGRAPHS:
        text = text.replace(latin, cyrillic)
    result = []
    for index, char in enumerate(text):
        if char == "c":
            following = text[index + 1] if index + 1 < len(text) else ""
            result.append("ц" if following in "eiyеиы" else "к")
        else:
            result.append(_LATIN_LETTERS.get(char, char))
    return "".join(result)


def normalize(text: str) -> str:
    """Lower-case, fold ё/Tajik letters and transliterate Latin letters to Cyrillic."""
    return _transliterate(" ".join(text.split()).casefold().translate(_CYRILLIC_FOLD))


def tokenize(text: str) -> list[str]:
    tokens: list[str] = []
    for raw in _TOKEN_RE.findall(normalize(text)):
        tokens.extend(part for part in _LETTER_DIGIT_RE.split(raw) if part)
    return tokens


def _has_latin(text: str) -> bool:
    return any("a" <= char <= "z" for char in text.casefold())


def _layout_fix(text: str) -> str:
    return "".join(_EN_TO_RU_LAYOUT.get(char, char) for char in text.casefold())


@dataclass(frozen=True)
class QueryToken:
    text: str
    alternatives: tuple[str, ...]
    weight: float

    @property
    def is_significant(self) -> bool:
        return self.weight == SIGNIFICANT_WEIGHT


def _token_weight(token: str) -> float:
    if token.isdigit():
        return NUMBER_WEIGHT
    if token in GENERIC_WORDS or len(token) == 1:
        return GENERIC_WEIGHT
    return SIGNIFICANT_WEIGHT


def _query_tokens(text: str, max_tokens: int) -> list[QueryToken]:
    tokens = list(dict.fromkeys(tokenize(text)))[:max_tokens]
    return [
        QueryToken(token, tuple(dict.fromkeys((token, *SYNONYMS.get(token, ())))), _token_weight(token))
        for token in tokens
    ]


def query_variants(query: str, max_tokens: int = 12) -> list[list[QueryToken]]:
    """Return the query as typed plus a keyboard-layout-repaired variant for Latin input."""
    variants = [_query_tokens(query, max_tokens)]
    if _has_latin(query):
        fixed = _query_tokens(_layout_fix(query), max_tokens)
        if fixed and [token.text for token in fixed] != [token.text for token in variants[0]]:
            variants.append(fixed)
    return [variant for variant in variants if variant]


def retrieval_terms(variants: Sequence[Sequence[QueryToken]], limit: int = 24, raw_query: str = "") -> list[str]:
    """Words sent to PostgreSQL for candidate retrieval.

    Generic words and numbers are left out whenever the query has a real
    medicine word, otherwise "таб" alone would flood the candidate pool.
    """
    # Keep Latin brand names in the SQL recall pool. Ranking transliterates
    # "box" to "бокс", but a catalogue row named "BOX ..." would otherwise
    # never reach the Python ranker because SQL searches the original name.
    terms = [token for token in _TOKEN_RE.findall(raw_query.casefold())
             if len(token) >= 2 and any("a" <= char <= "z" for char in token)]
    for tokens in variants:
        significant = [token for token in tokens if token.is_significant]
        for token in significant or tokens:
            terms.extend(alt for alt in token.alternatives if len(alt) >= 2 or not significant)
    return list(dict.fromkeys(terms))[:limit]


def _substitution_cost(left: str, right: str) -> float:
    if left == right:
        return 0.0
    return 0.5 if frozenset((left, right)) in _CHEAP_SUBSTITUTIONS else 1.0


def _indel_cost(word: str, index: int) -> float:
    """Cost of inserting/deleting word[index]: cheap for ь/ъ and doubled letters."""
    char = word[index]
    if char in _SILENT:
        return 0.5
    if (index > 0 and word[index - 1] == char) or (index + 1 < len(word) and word[index + 1] == char):
        return 0.5
    return 1.0


def edit_distances(token: str, word: str) -> tuple[float, float]:
    """Weighted Damerau-Levenshtein distance of token to the whole word and to its best prefix."""
    rows, cols = len(token) + 1, len(word) + 1
    table = [[0.0] * cols for _ in range(rows)]
    for i in range(1, rows):
        table[i][0] = table[i - 1][0] + _indel_cost(token, i - 1)
    for j in range(1, cols):
        table[0][j] = table[0][j - 1] + _indel_cost(word, j - 1)
    for i in range(1, rows):
        for j in range(1, cols):
            best = min(
                table[i - 1][j] + _indel_cost(token, i - 1),
                table[i][j - 1] + _indel_cost(word, j - 1),
                table[i - 1][j - 1] + _substitution_cost(token[i - 1], word[j - 1]),
            )
            if i > 1 and j > 1 and token[i - 1] == word[j - 2] and token[i - 2] == word[j - 1]:
                best = min(best, table[i - 2][j - 2] + 1.0)
            table[i][j] = best
    return table[-1][-1], min(table[-1][1:]) if cols > 1 else table[-1][0]


def _allowed_errors(length: int) -> float:
    if length < 4:
        return 0.0
    if length <= 5:
        return 1.0
    if length <= 7:
        return 1.5
    if length <= 10:
        return 2.0
    return 2.5


def word_match(token: str, word: str) -> float:
    """Score in [0, 1] of how well one query token matches one name word."""
    if token == word:
        return 1.0
    if word.startswith(token):
        if token.isdigit():
            return 0.6
        return 0.9 if len(token) >= 3 else 0.7 if len(token) == 2 else 0.5
    if token.isdigit() or word.isdigit():
        return 0.0
    allowed = _allowed_errors(len(token))
    score = 0.0
    # Cheapest deletion costs 0.5, so a much shorter word can never be within reach.
    if allowed and len(word) >= len(token) - 2 * allowed:
        full, prefix = edit_distances(token, word)
        if full <= allowed:
            score = 0.88 - 0.12 * full
        if prefix <= allowed:
            score = max(score, 0.8 - 0.12 * prefix)
    # No plain "substring inside a word" matches: "фикс" must not find "Зеффикс".
    return score


@dataclass(frozen=True)
class RankedName:
    score: float
    matched_all: bool


def _name_words(name: str) -> list[str]:
    words = tokenize(name)
    # "Но-шпа" is also matched as "ношпа", "Аква детрим" as "аквадетрим".
    joined = [words[i] + words[i + 1] for i in range(len(words) - 1) if not words[i + 1].isdigit()]
    return words + joined


def _score_variant(tokens: Sequence[QueryToken], words: list[str], plain_words: int, normalized_name: str) -> RankedName:
    total_weight = sum(token.weight for token in tokens)
    gained = 0.0
    matched_all = True
    significant_hit = False
    first_word_hit = False
    for token in tokens:
        best = 0.0
        best_position = -1
        for alternative in token.alternatives:
            for position, word in enumerate(words):
                score = word_match(alternative, word)
                if score > best:
                    best, best_position = score, position
        gained += token.weight * best
        if best == 0.0:
            matched_all = False
        elif token.is_significant:
            significant_hit = True
            if best_position == 0 or best_position == plain_words:
                first_word_hit = True
    has_significant = any(token.is_significant for token in tokens)
    if has_significant and not significant_hit:
        return RankedName(0.0, False)
    score = gained / total_weight
    if matched_all:
        score += 0.1
    if first_word_hit:
        score += 0.05
    if normalized_name.startswith(" ".join(token.text for token in tokens)):
        score += 0.1
    return RankedName(score, matched_all)


def score_name(variants: Sequence[Sequence[QueryToken]], name: str) -> float:
    words = _name_words(name)
    plain_words = len(tokenize(name))
    normalized_name = " ".join(tokenize(name))
    return max((_score_variant(tokens, words, plain_words, normalized_name).score for tokens in variants), default=0.0)


def rank_candidates(query: str, rows: Iterable[dict[str, Any]], max_tokens: int = 12) -> list[dict[str, Any]]:
    """Sort candidate rows by typo-tolerant relevance, dropping unrelated ones."""
    variants = query_variants(query, max_tokens)
    scored = []
    for row in rows:
        score = score_name(variants, str(row.get("name") or ""))
        if score >= MIN_SCORE:
            scored.append((score, row))
    if scored:
        best = max(score for score, _ in scored)
        if best >= CONFIDENT_SCORE:
            scored = [(score, row) for score, row in scored if score >= best - MAX_GAP_FROM_BEST]
    scored.sort(key=lambda item: (-round(item[0], 6), len(tokenize(str(item[1]["name"]))), str(item[1]["name"]).casefold(), item[1]["id"]))
    return [row for _, row in scored]


def did_you_mean(query: str, name: str) -> str | None:
    """Corrected query built from the words of the best match, if the query had a typo."""
    words = [word for word in re.findall(r"[^\W\d_]+", name) if len(word) >= 2]
    normalized_words = [normalize(word) for word in words]
    corrected: list[str] = []
    changed = False
    for token in tokenize(query):
        if token.isdigit() or token in GENERIC_WORDS or len(token) < 4:
            corrected.append(token)
            continue
        best_score, best_word = 0.0, None
        for original, normalized in zip(words, normalized_words):
            score = word_match(token, normalized)
            if score > best_score:
                best_score, best_word = score, original
        if best_word and best_score < 0.9:
            corrected.append(best_word.capitalize())
            changed = True
        else:
            corrected.append(token)
    return " ".join(corrected) if changed else None
