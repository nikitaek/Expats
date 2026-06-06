#!/usr/bin/env python3
"""Parse hotel research docs, aggregate, dedupe, export JSON/MD/CSV/KML."""

from __future__ import annotations

import csv
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

BASE = Path(__file__).resolve().parent
SOURCES = [
    BASE / "Make a research in russian tour operator market, s.md",
    BASE / "openai-research.md",
    BASE / "Russian-Tour-Operators-in-Vietnam-Comprehensive-Hotel-Mapping-for-Da-Nang-and-Hoi-An-Markets.md",
]

OPERATOR_ALIASES = {
    "anex": "ANEX",
    "anex tour": "ANEX",
    "tez": "TEZ",
    "tez tour": "TEZ",
    "pegas": "Pegas",
    "pegas touristik": "Pegas",
    "coral": "Coral",
    "coral travel": "Coral",
    "intourist": "Intourist",
    "int": "Intourist",
    "fun&sun": "FUN&SUN",
    "fun and sun": "FUN&SUN",
    "fstravel": "FUN&SUN",
    "pacs": "PACS",
    "paks": "PACS",
    "pac group": "PACS",
    "pac group / paks": "PACS",
    "r-express": "R-Express",
    "r express": "R-Express",
    "russian express": "R-Express",
    "ics": "ICS",
    "ics travel group": "ICS",
    "space travel": "Space Travel",
    "planeta travel": "Planeta Travel",
    "art tour": "Art Tour",
    "bg": "BG",
    "biblio globus": "BG",
    "biblio-globus": "BG",
    "sunmar": "Sunmar",
    "psg": "PSG",
    "psg tourist": "PSG",
    "kompas": "KOMPAS",
    "china travel": "China Travel",
    "spectrum": "Spectrum",
    "intourist": "Intourist",
}

CITY_HINTS = {
    "danang": "Da Nang",
    "da nang": "Da Nang",
    "hoi an": "Hoi An",
    "hoian": "Hoi An",
    "hoiana": "Hoiana",
    "nam hoi an": "Hoiana / Nam Hoi An",
    "non nuoc": "Da Nang",
    "my khe": "Da Nang",
    "son tra": "Da Nang",
    "cua dai": "Hoi An",
    "ha my": "Hoi An",
    "dien duong": "Hoi An",
    "binh minh": "Hoi An",
}

SKIP_NAMES = {
    "operators confirmed",
    "hotel",
    "stars sold",
    "price segment",
    "public pricing signal",
    "sub-area",
    "overlap count",
    "region",
    "stars",
    "operators (confirmed)",
    "price segment 1–10",
    "price segment 1-10",
    "hoi an",
    "da nang",
    "danang",
    "hoiana",
    "hoi an hoiana",
    "hoiana nam hoi an",
}


def norm_key(name: str) -> str:
    s = name.lower()
    s = re.sub(r"\([^)]*\)", "", s)
    s = re.sub(r"\d+\s*★|\d+\s*\*|deluxe|managed by accor.*", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


INVALID_NAME_RE = re.compile(
    r"(\$|\d+\s*hotels|unique hotels|beach resort destination|recommendation|market segment|operator focus|properties:|:--|^[\d\\]+$|budget/economy|value midscale|mainstream resort|ultra.luxury|hotel density|no-flight|working list|beach corridor|284 in|519 hotels)",
    re.I,
)

PROSE_SKIP_PHRASES = (
    "budget/economy",
    "value midscale",
    "mainstream resort",
    "ultra-luxury",
    "hotel density",
    "no-flight",
    "working list",
    "beach corridor",
    "five-star beachfront resort",
    "284 in hoi an",
    "519 hotels",
    "properties:",
    "operator focus",
    "recommendation",
    "among others",
    "pullman, intercontinental",
    "usd no-flight",
    "ruble package",
    "price segment",
    "operator overlap",
)

HOTEL_SUFFIX_RE = re.compile(
    r"\b(hotel|resort|villa|villas|retreat|residences|spa|suites|apartment|beach|bay|land|mercure|mgallery|nam hai|wellness|garden|retreat)\b",
    re.I,
)


def is_valid_hotel_name(name: str) -> bool:
    if not name or len(name.strip()) < 4:
        return False
    if INVALID_NAME_RE.search(name):
        return False
    if name.strip() in {":--", "-"}:
        return False
    if "/" in name and not HOTEL_SUFFIX_RE.search(name.split("/")[0]):
        return False
    if name.lower() in SKIP_NAMES:
        return False
    # Must look like a hotel/resort property name
    if HOTEL_SUFFIX_RE.search(name):
        return True
    if name.endswith(("Danang", "Hoi An", "Hoiana")):
        return len(name.split()) >= 3
    return False


def clean_hotel_name(raw: str) -> str:
    name = raw.strip()
    name = name.replace("’", "'").replace("‘", "'")
    name = name.rstrip("\\")
    name = re.sub(r"\s+\d+\s*★.*$", "", name)
    name = re.sub(r"\s+\d+\\?\*.*$", "", name)
    name = re.sub(r"\s+\d+(?:\\?\*)?$", "", name)
    name = re.sub(r"\s+5\* deluxe$", " deluxe", name, flags=re.I)
    name = re.sub(r"\s*\([^)]*\)\s*$", "", name)
    name = re.sub(r"[\[\]][^\s,\.]*", "", name)
    name = re.sub(r"\s+", " ", name).strip(" ,-")
    return name


def prose_name_ok(name: str) -> bool:
    if not name or len(name) > 90:
        return False
    lower = name.lower()
    if any(p in lower for p in PROSE_SKIP_PHRASES):
        return False
    return is_valid_hotel_name(name)


def non_table_text(text: str) -> str:
    return "\n".join(line for line in text.splitlines() if not line.strip().startswith("|"))


def split_prose_hotel_list(chunk: str) -> list[str]:
    chunk = re.sub(r"\*\*", "", chunk)
    chunk = re.sub(r"[\[\]][^\s,\.]*", "", chunk)
    items = []
    for item in re.split(r",\s*(?=[A-Z«\"])|,\s*and\s+|\s+and\s+", chunk):
        item = clean_hotel_name(item)
        if prose_name_ok(item):
            items.append(item)
    return items


def infer_operators_from_context(ctx: str) -> set[str]:
    ops = normalize_operators(ctx)
    lower = ctx.lower()
    if "biblio-globus" in lower or "biblio globus" in lower:
        ops.add("BG")
    if "art tour" in lower:
        ops.add("Art Tour")
    if "space travel" in lower:
        ops.add("Space Travel")
    if "planeta travel" in lower:
        ops.add("Planeta Travel")
    if "pacs" in lower or "paks" in lower:
        ops.add("PACS")
    if "psg" in lower:
        ops.add("PSG")
    if "kompas" in lower:
        ops.add("KOMPAS")
    return ops


def canonical_name(name: str) -> str:
    name = clean_hotel_name(name)
    name = name.replace("4\\", "4*").replace("\\", "")
    aliases = {
        "samdi": "Samdi Hotel",
        "royal lotus": "Royal Lotus Hotel Danang",
        "century hotel da nang": "Century Hotel Da Nang",
        "four season resort the nam hai hoi an": "Four Seasons Resort The Nam Hai",
        "four seasons the nam hai": "Four Seasons Resort The Nam Hai",
        "danang marriott non nuoc": "Danang Marriott Resort & Spa",
        "non nuoc beach villas": "Non Nuoc Beach Villas",
        "premier village danang resort managed by accor": "Premier Village Danang Resort",
        "maximilan danang beach hotel": "Maximilan Danang Beach Hotel",
        "maximilian danang beach hotel": "Maximilan Danang Beach Hotel",
        "belle maison parosand danang": "Belle Maison Parosand Danang",
        "parosand da nang hotel": "Belle Maison Parosand Danang",
        "tia wellness resort danang": "TIA Wellness Resort",
        "fusion maia resort danang": "TIA Wellness Resort",
        "koi resort residence da nang": "Koi Resort & Residence Da Nang",
        "rivertown hoi an resort spa": "RiverTown Hoi An Resort & Spa",
        "river town hoi an resort spa": "RiverTown Hoi An Resort & Spa",
        "bellerive hoi an resort spa": "Bellerive Hoi An Resort & Spa",
        "hotel royal hoi an mgallery": "Hotel Royal Hoi An - MGallery",
        "renaissance danang hoi an resort spa": "Renaissance Hoi An Resort & Spa",
        "new world hoiana beach resort": "New World Hoiana Beach & Resort",
        "vinpearl resort golf nam hoi an": "Vinpearl Resort & Golf Nam Hoi An",
        "signature by m village danang heritage": "Signature By M Village Danang Heritage",
        "signature by m village beachfront": "Signature By M Village Danang Heritage",
        "grand tourane hotel danang": "Grand Tourane",
        "peninsula hotel danang": "Peninsula Hotel Danang",
        "intercontinental danang sun peninsula": "InterContinental Danang Sun Peninsula Resort",
        "four seasons the nam hai": "Four Seasons Resort The Nam Hai",
        "danang marriott non nuoc beach villas": "Non Nuoc Beach Villas",
        "new world hoiana": "New World Hoiana Beach & Resort",
        "palm garden hoian": "Palm Garden Beach Resort & Spa Hoi An",
        "rivertown": "RiverTown Hoi An Resort & Spa",
        "grand mercure danang": "Grand Mercure Danang",
        "furama villas danang": "Furama Villas Danang",
        "koi resort spa": "Koi Resort & Spa Hoi An",
        "centre point hotel and residence": "Centre Point Hotel and Residence",
        "fusion resort villas da nang": "Fusion Resort & Villas Da Nang",
        "grandvrio ocean resort danang": "Grandvrio Ocean Resort Danang",
        "four points by sheraton danang": "Four Points by Sheraton Danang",
        "wyndham soleil danang": "Wyndham Soleil Danang",
        "shilla monogram danang": "Shilla Monogram Danang",
        "sunrise premium resort spa": "Sunrise Premium Resort & Spa Hoi An",
        "sunrise premium resort spa hoi an": "Sunrise Premium Resort & Spa Hoi An",
        "kings finger hotel": "King's Finger Hotel",
        "blue ocean 2 hotel": "Blue Ocean 2 Hotel",
        "angel hotel": "Angel Hotel",
        "anantara hoi an": "Anantara Hoi An Resort",
        "centara sandy beach resort": "Centara Sandy Beach Resort Danang",
        "golden sand resort": "Golden Sand Resort & Spa",
        "grandvrio ocean resort": "Grandvrio Ocean Resort Danang",
        "pullman danang": "Pullman Danang Beach Resort",
        "sunrise premium resort": "Sunrise Premium Resort & Spa Hoi An",
        "new orient hotel danang": "New Orient Hotel Danang",
    }
    key = norm_key(name)
    return aliases.get(key, name)


def split_hotel_names(name: str) -> list[str]:
    parts = []
    for chunk in re.split(r"\s*/\s*|\s*,\s*and\s+|\s*,\s*(?=[A-Z])", name):
        chunk = clean_hotel_name(chunk)
        if chunk and chunk.lower() not in SKIP_NAMES:
            parts.append(chunk)
    return parts or [clean_hotel_name(name)]


def normalize_operators(text: str) -> set[str]:
    if not text:
        return set()
    text = re.sub(r"[\[\]][^\s,\.]*", "", text)
    text = re.sub(r"\\&", "&", text)
    text = re.sub(r"cite[^,\.]*", "", text, flags=re.I)
    text = re.sub(r"[^A-Za-z0-9&\-\s,/]", " ", text)
    ops = set()
    for part in re.split(r"[,;]", text):
        token = part.strip().strip(".")
        token = re.sub(r"\s*\([^)]*\)\s*", "", token)
        token = re.sub(r"\s+", " ", token).strip()
        if not token or len(token) > 40:
            continue
        lower = token.lower()
        if lower in {"among others", "etc", "dr", "sletat", "turn"}:
            continue
        if any(x in lower for x in ("показывает", "подборке", "public", "pricing", "scan")):
            continue
        mapped = OPERATOR_ALIASES.get(lower)
        if mapped:
            ops.add(mapped)
        elif token in {"ANEX", "TEZ", "Pegas", "Coral", "Intourist", "FUN&SUN", "PACS", "R-Express", "ICS", "Space Travel", "Planeta Travel", "Art Tour", "BG", "Sunmar", "PSG", "KOMPAS", "China Travel", "Spectrum"}:
            ops.add(token)
        elif lower.startswith("fun") and "sun" in lower:
            ops.add("FUN&SUN")
    return ops


def infer_city(name: str, region: str = "") -> str:
    blob = f"{name} {region}".lower()
    if "hoiana" in blob or "nam hoi an" in blob:
        return "Hoiana / Nam Hoi An" if "nam hoi an" in blob else "Hoiana"
    if "hoi an" in blob or "hoian" in blob:
        return "Hoi An"
    if any(x in blob for x in ("danang", "da nang", "non nuoc", "my khe", "son tra")):
        return "Da Nang"
    if region:
        r = region.strip()
        if r:
            return r.replace("Danang", "Da Nang")
    return "Da Nang"


def parse_stars(text: str) -> str:
    if not text:
        return "n/a"
    t = text.strip()
    t = t.replace("★", "*").replace("☆", "*")
    m = re.search(r"(\d\s*[-–/\+]+\s*\d\s*\*|\d\s*\*|5\s*\*\s*deluxe|n/a)", t, re.I)
    if m:
        return re.sub(r"\s+", "", m.group(1).replace("–", "-").replace("/", "-"))
    if "deluxe" in t.lower():
        return "5* deluxe"
    return "n/a"


def extract_star_numbers(text: str) -> list[int]:
    if not text or text == "n/a":
        return []
    t = text.replace("★", "*").replace("☆", "*")
    return [int(n) for n in re.findall(r"\d+", t) if 1 <= int(n) <= 5]


def normalize_hotel_stars(stars) -> int | None:
    """Return lowest star count as plain integer, stripping *, deluxe, ranges, etc."""
    if not stars:
        return None
    if isinstance(stars, set):
        parts = stars
    else:
        parts = re.split(r"\s*/\s*", str(stars))
    nums: list[int] = []
    for part in parts:
        nums.extend(extract_star_numbers(part))
    return min(nums) if nums else None


def parse_usd_amount(text: str) -> int | None:
    m = re.search(r"\\?\$([\d,]+)", text)
    if not m:
        return None
    return int(m.group(1).replace(",", ""))


def usd_to_price_segment(usd: int) -> int:
    """Map comprehensive-doc RUB/USD package prices to normalized 1-10 segments."""
    if usd >= 280_000:
        return 10
    if usd >= 220_000:
        return 9
    if usd >= 175_000:
        return 8
    if usd >= 140_000:
        return 7
    if usd >= 115_000:
        return 6
    if usd >= 90_000:
        return 5
    if usd >= 70_000:
        return 4
    if usd >= 45_000:
        return 3
    if usd >= 25_000:
        return 2
    return 1


STAR_TO_SEGMENT = {
    "3*": 2,
    "4*": 4,
    "4-5*": 5,
    "4+/5*": 6,
    "5*": 7,
    "5* deluxe": 10,
}


def segment_from_stars(stars: str) -> int | None:
    if not stars or stars == "n/a":
        return None
    primary = stars.split(" / ")[0].strip()
    if primary in STAR_TO_SEGMENT:
        return STAR_TO_SEGMENT[primary]
    nums = re.findall(r"\d+", primary)
    if nums:
        return min(10, max(1, int(round(sum(int(n) for n in nums) / len(nums) + 1))))
    return None


def merge_metadata(meta: dict, name: str, stars: str | None = None, price: int | None = None):
    key = norm_key(canonical_name(name))
    if not key:
        return
    entry = meta.setdefault(key, {"stars": set(), "prices": []})
    if stars and stars != "n/a":
        entry["stars"].add(stars)
    if price is not None:
        entry["prices"].append(price)


def build_metadata_index() -> dict:
    """Scan all research files for explicit stars and price-segment signals."""
    meta: dict = {}

    for path in SOURCES:
        text = path.read_text(encoding="utf-8")

        # Markdown tables (Perplexity + OpenAI formats)
        for line in text.splitlines():
            parts = parse_markdown_table(line)
            if not parts:
                continue
            hotel_raw = re.sub(r"\*\*", "", parts[0])
            if hotel_raw.lower() in SKIP_NAMES or not hotel_raw:
                continue
            if len(parts) >= 6:
                stars = parse_stars(parts[4])
                price = parse_price_segment_text(parts[5])
            elif len(parts) >= 5:
                stars = parse_stars(parts[2])
                price = parse_price_segment_text(parts[4])
            else:
                continue
            merge_metadata(meta, hotel_raw, stars, price)

        # Comprehensive bullet lines with USD pricing
        section_stars = ""
        for line in text.splitlines():
            lower = line.lower()
            if "ultra-budget 3-star" in lower:
                section_stars = "3*"
            elif "additional 5-star" in lower:
                section_stars = "5*"
            elif "mid-range 3-4 star" in lower:
                section_stars = "4*"
            elif "five-star beachfront" in lower or "flagship ultra-luxury" in lower:
                section_stars = "5*"
            m = re.match(r"^-\s+\*\*(.+?)\*\*\s*[—–-]", line)
            if not m:
                continue
            raw = m.group(1)
            name = clean_hotel_name(raw)
            stars = parse_stars(raw) if parse_stars(raw) != "n/a" else section_stars
            usd = parse_usd_amount(line)
            price = usd_to_price_segment(usd) if usd else None
            if re.search(r"150,?000\+", line):
                price = max(price or 0, 8)
            merge_metadata(meta, name, stars, price)

        # Price-tier property lists (comprehensive doc section 5)
        tier_patterns = [
            (r"Ultra-Budget Tier[^\.]*\*\*Properties:\*\*\s*([^\.]+)\.", 2, "3*"),
            (r"Value Mid-Range Tier[^\.]*\*\*Properties:\*\*\s*([^\.]+)\.", 4, "4*"),
            (r"Premium Comfort Tier[^\.]*\*\*Properties:\*\*\s*([^\.]+)\.", 6, "4*"),
            (r"Ultra-Luxury Tier[^\.]*\*\*Properties:\*\*\s*([^\.]+)\.", 9, "5*"),
        ]
        for pat, tier_price, tier_stars in tier_patterns:
            for m in re.finditer(pat, text, re.I | re.S):
                for item in re.split(r",\s*(?=[A-Z])| and ", m.group(1)):
                    item = clean_hotel_name(re.sub(r"\([^)]*\)", "", item))
                    if prose_name_ok(item) or is_valid_hotel_name(item):
                        merge_metadata(meta, item, tier_stars, tier_price)

        # Bold hotel mentions with inline USD on same line
        for line in text.splitlines():
            if "\\$" not in line and "$" not in line:
                continue
            usd = parse_usd_amount(line)
            if not usd:
                continue
            price = usd_to_price_segment(usd)
            for m in re.finditer(r"\*\*([^*]+?)\*\*", line):
                raw = m.group(1)
                if "$" in raw or re.search(r"\d+\s*hotels", raw, re.I):
                    continue
                name = clean_hotel_name(raw)
                if not is_valid_hotel_name(name) and not HOTEL_SUFFIX_RE.search(name):
                    continue
                stars = parse_stars(raw)
                merge_metadata(meta, name, stars, price)

    # Research-based estimates for prose-only hotels (openai long tail, sitemap, ICS)
    prose_estimates = {
        "Bellerive Hoi An Resort & Spa": ("5*", 7),
        "Laluna Riverside Hoi An": ("4*", 5),
        "RiverTown Hoi An Resort & Spa": ("4*", 5),
        "Hoi An Odyssey Hotel": ("4*", 4),
        "Silk River Hoi An Hotel & Spa": ("4*", 5),
        "La Charm Hoi An Hotel & Spa": ("4*", 5),
        "Ancient House Resort Hoi An": ("4*", 5),
        "Hotel Royal Hoi An - MGallery": ("5*", 8),
        "Furama Villas Danang": ("5*", 9),
        "Grand Mercure Danang": ("5*", 6),
        "Pulchra Resort Danang": ("5*", 8),
        "Vinpearl Da Nang Resort & Villas": ("5*", 8),
        "Mandila Beach Hotel": ("4*", 4),
        "Minh Toan Safi Ocean Hotel": ("4*", 3),
        "Wyndham Garden Hoi An": ("4*", 5),
        "Victoria Hoi An Beach Resort & Spa": ("5*", 7),
        "King's Finger Hotel": ("3*", 1),
        "Blue Ocean 2 Hotel": ("3*", 1),
        "Angel Hotel": ("3*", 1),
        "Avatar Da Nang Hotel": ("4*", 2),
        "Four Points by Sheraton Danang": ("5*", 6),
        "Wyndham Soleil Danang": ("5*", 6),
        "Boutique Hoi An Resort": ("4-5*", 7),
        "TIA Wellness Resort": ("5*", 9),
        "Centara Sandy Beach Resort Danang": ("4*", 5),
        "Non Nuoc Beach Villas": ("5*", 9),
        "Koi Resort & Residence Da Nang": ("5*", 6),
        "Koi Resort & Spa Hoi An": ("5*", 5),
    }
    for name, (stars, price) in prose_estimates.items():
        merge_metadata(meta, name, stars, price)

    return meta


def enrich_store_metadata(store: dict[tuple[str, str], HotelRecord], meta: dict):
    """Fill missing stars and price segments from scraped metadata and inference."""
    for rec in store.values():
        key = norm_key(rec.hotel_name)
        scraped = meta.get(key, {})

        if scraped.get("stars"):
            rec.hotel_stars.update(scraped["stars"])
        if scraped.get("prices"):
            rec.price_segments.extend(scraped["prices"])

        if not rec.hotel_stars or rec.hotel_stars == {"n/a"}:
            inferred_stars = infer_stars_from_name(rec.hotel_name)
            if inferred_stars:
                rec.hotel_stars.add(inferred_stars)

        if not rec.price_segments:
            for stars in rec.hotel_stars:
                seg = segment_from_stars(stars)
                if seg is not None:
                    rec.price_segments.append(seg)
                    break
            if not rec.price_segments:
                seg = infer_segment_from_name(rec.hotel_name, rec.city)
                if seg is not None:
                    rec.price_segments.append(seg)


def infer_stars_from_name(name: str) -> str | None:
    lower = name.lower()
    ultra_luxury = (
        "intercontinental", "four seasons", "nam hai", "premier village",
        "sun peninsula", "hoiana residences", "non nuoc beach villas",
    )
    luxury = (
        "marriott", "sheraton", "pullman", "hyatt", "radisson", "wyndham golden",
        "furama villas", "pulchra", "vinpearl", "namia", "bliss hoi an",
        "renaissance", "mgallery", "bellerive",
    )
    upscale = (
        "resort & spa", "beach resort", "retreat", "memories land", "fusion",
        "grandvrio", "shilla", "peninsula", "centre point", "new world hoiana",
        "koi resort",
    )
    budget = (
        "kay hotel", "lion sea", "bamboo green", "fansipan", "dylan hotel",
        "field villa", "rose garden", "king's finger", "blue ocean", "angel hotel",
    )
    if any(x in lower for x in ultra_luxury):
        return "5* deluxe" if "four seasons" in lower or "nam hai" in lower else "5*"
    if any(x in lower for x in luxury):
        return "5*"
    if any(x in lower for x in budget):
        return "3*"
    if any(x in lower for x in upscale):
        return "4*" if "boutique" in lower or "odyssey" in lower else "5*"
    if "hotel" in lower and "luxury" not in lower:
        return "4*"
    return None


def infer_segment_from_name(name: str, city: str) -> int | None:
    stars = infer_stars_from_name(name)
    if stars:
        return segment_from_stars(stars)
    return None


def parse_price_segment_text(text: str) -> int | None:
    if not text:
        return None
    text = re.sub(r"\*\*", "", text)
    nums = [int(n) for n in re.findall(r"\b(\d{1,2})\b", text)]
    if not nums:
        return None
    # Prefer explicit range midpoint or single value
    if len(nums) >= 2 and re.search(r"\d\s*[-–]\s*\d", text):
        return round((nums[0] + nums[1]) / 2)
    return nums[0]


class HotelRecord:
    __slots__ = ("hotel_name", "city", "operators", "hotel_stars", "price_segments")

    def __init__(self, hotel_name: str, city: str):
        self.hotel_name = hotel_name
        self.city = city
        self.operators: set[str] = set()
        self.hotel_stars: set[str] = set()
        self.price_segments: list[int] = []


def merge_record(store: dict[tuple[str, str], HotelRecord], name: str, city: str, operators: set[str], stars: str, price: int | None):
    for split_name in split_hotel_names(name):
        split_name = canonical_name(split_name)
        if not split_name or split_name.lower() in SKIP_NAMES or not is_valid_hotel_name(split_name):
            continue
        c = infer_city(split_name, city)
        if INVALID_NAME_RE.search(c) or c.strip() in {":--", "-"}:
            c = infer_city(split_name, "")
        key = (norm_key(split_name), norm_key(c))
        rec = store.get(key)
        if not rec:
            rec = HotelRecord(split_name, c)
            store[key] = rec
        rec.operators.update(operators)
        if stars and stars != "n/a":
            rec.hotel_stars.add(stars)
        if price is not None:
            rec.price_segments.append(price)


def parse_markdown_table(line: str) -> list[str] | None:
    if not line.startswith("|") or line.startswith("|---") or "Hotel" in line and "City" in line:
        return None
    parts = [p.strip() for p in line.strip().strip("|").split("|")]
    if len(parts) < 2:
        return None
    return parts


def parse_perplexity_tables(text: str, store: dict):
    for line in text.splitlines():
        parts = parse_markdown_table(line)
        if not parts or len(parts) < 5:
            continue
        hotel_raw = re.sub(r"\*\*", "", parts[0])
        if hotel_raw.lower() in SKIP_NAMES or not hotel_raw:
            continue
        region = parts[1]
        stars = parse_stars(parts[2])
        operators = normalize_operators(re.sub(r"\[\^[^\]]+\]", "", parts[3]))
        price = parse_price_segment_text(parts[4])
        merge_record(store, hotel_raw, region, operators, stars, price)


def parse_openai_tables(text: str, store: dict):
    for line in text.splitlines():
        parts = parse_markdown_table(line)
        if not parts or len(parts) < 6:
            continue
        hotel_raw = re.sub(r"\*\*", "", parts[0])
        if hotel_raw.lower() in {"hotel", "sub-area"}:
            continue
        sub = parts[1]
        operators = normalize_operators(re.sub(r"[\[\]0-9]+|cite[^,\.]*|[^,\.]*", "", parts[3]))
        stars = parse_stars(parts[4])
        price = parse_price_segment_text(parts[5])
        merge_record(store, hotel_raw, sub, operators, stars, price)


def parse_bold_bullets(text: str, store: dict, default_city: str = ""):
    for m in re.finditer(r"\*\*([^*]+?)\*\*", text):
        raw = m.group(1).strip()
        if any(x in raw.lower() for x in ("operator", "market", "tier", "recommendation", "properties:", "operator focus:")):
            continue
        if any(x in raw.lower() for x in PROSE_SKIP_PHRASES):
            continue
        if len(raw) > 90:
            continue
        if not (
            re.search(r"\$\d", raw)
            or re.search(r"\d+\s*★", raw)
            or re.search(r"\d+\\?\*", raw)
            or HOTEL_SUFFIX_RE.search(raw)
            or raw.endswith(("Danang", "Hoi An", "Hoiana"))
        ):
            continue
        stars = parse_stars(raw)
        name = clean_hotel_name(raw)
        if not prose_name_ok(name):
            continue
        ctx = text[max(0, m.start() - 200): m.end() + 200]
        ops = infer_operators_from_context(ctx)
        city = infer_city(name, default_city)
        merge_record(store, name, city, ops, stars, None)


PROSE_LIST_PATTERNS = [
    (r"the most credible density candidates are \*\*([^*]+)\*\*", {"ANEX", "FUN&SUN", "TEZ", "Coral", "Pegas", "Sunmar"}),
    (r"the strongest density candidates are \*\*([^*]+)\*\*", {"ANEX", "FUN&SUN", "TEZ", "Coral", "Pegas", "Sunmar"}),
    (r"materially expand the visible inventory in luxury and upper-upscale hotels such as \*\*([^*]+)\*\*", set()),
    (r"starting with \*\*([^*]+)\*\*, and for more affluent", set()),
    (r"you should start with \*\*([^*]+)\*\*, and for more affluent", set()),
]

PROSE_SECTION_PATTERNS = [
    (r"FUN&SUN also surfaced a meaningful long tail including(.+?)\.", {"FUN&SUN"}),
    (r"Russian Express also surfaced Hoi An inventory such as(.+?)\.", {"R-Express"}),
    (r"China Travel published direct pages for several central-Vietnam hotels as well, including(.+?)\.", {"China Travel"}),
    (r"ANEX['’]s Da Nang sitemap includes(.+?)\.", {"ANEX"}),
    (r"ICS additionally exposed lower-price properties such as(.+?)\.", {"ICS"}),
    (r"extra inventory that may still matter[^.]*\.\s+ANEX['’]s Da Nang sitemap includes(.+?)\.", {"ANEX"}),
]


def extract_names_from_prose_block(block: str) -> list[str]:
    names: list[str] = []
    for m in re.finditer(r"\*\*([^*]+)\*\*", block):
        names.extend(split_prose_hotel_list(m.group(1)))
    if not names:
        names = split_prose_hotel_list(re.sub(r"\*\*", "", block))
    return names


def parse_prose_inventory(text: str, store: dict, default_city: str = ""):
    """Extract hotel names from narrative paragraphs, comma lists, and bold mentions."""
    prose = non_table_text(text)

    for pat, default_ops in PROSE_SECTION_PATTERNS:
        for m in re.finditer(pat, prose, re.I | re.S):
            ctx = prose[max(0, m.start() - 250): m.end() + 250]
            ops = set(default_ops) | infer_operators_from_context(ctx)
            for item in extract_names_from_prose_block(m.group(1)):
                merge_record(store, item, infer_city(item, default_city), ops, "n/a", None)

    for pat, default_ops in PROSE_LIST_PATTERNS:
        for m in re.finditer(pat, prose, re.I | re.S):
            ctx = prose[max(0, m.start() - 250): m.end() + 250]
            ops = set(default_ops) | infer_operators_from_context(ctx)
            for item in split_prose_hotel_list(m.group(1)):
                merge_record(store, item, infer_city(item, default_city), ops, "n/a", None)

    parse_bold_bullets(prose, store, default_city)

    if re.search(r"\*\*A La Carte Danang Beach\*\*", prose, re.I):
        merge_record(store, "A La Carte Danang Beach", "Da Nang", {"ANEX", "R-Express"}, "5*", 7)


def parse_openai_long_tail(text: str, store: dict):
    parse_prose_inventory(text, store)


def parse_comprehensive_bullets(text: str, store: dict):
    section_op = None
    section_city = ""
    section_stars = ""
    for line in text.splitlines():
        if "## 2. Da Nang Hotel Market" in line:
            section_city = "Da Nang"
        elif "## 3. Hoi An Hotel Market" in line:
            section_city = "Hoi An"
        lower = line.lower()
        if "ultra-budget 3-star" in lower:
            section_stars = "3*"
        elif "additional 5-star" in lower:
            section_stars = "5*"
        elif "mid-range 3-4 star" in lower:
            section_stars = "4*"
        elif "five-star beachfront" in lower or "flagship ultra-luxury" in lower:
            section_stars = "5*"
        if "From **ANEX Tour**" in line or "Flagship Ultra-Luxury from ANEX Tour" in line or "**ANEX Tour** features" in line:
            section_op = "ANEX"
        elif (
            "From **Tez Tour**" in line
            or "Ultra-Budget 3-star from Tez Tour" in line
            or "Additional 5-Star from Tez Tour" in line
            or "Mid-Range Budget Alternatives from Tez Tour" in line
            or "Mid-Range 3-4 Star from Tez Tour" in line
            or "Additionally, **Tez Tour**" in line
            or "**Tez Tour** catalogs" in line
        ):
            section_op = "TEZ"
        elif "Luxury Alternative from Russian Express" in line:
            section_op = "R-Express"
        m = re.match(r"^-\s+\*\*(.+?)\*\*\s*[—–-]", line)
        if not m:
            continue
        raw = m.group(1)
        stars = parse_stars(raw)
        if stars == "n/a" and section_stars:
            stars = section_stars
        name = clean_hotel_name(raw)
        city = infer_city(name, section_city or line)
        ops = set()
        if section_op:
            ops.add(section_op)
        if "ANEX" in line or "anextour" in line.lower():
            ops.add("ANEX")
        if "Tez Tour" in line or "tez-tour" in line.lower():
            ops.add("TEZ")
        if "Russian Express" in line:
            ops.add("R-Express")
        usd = parse_usd_amount(line)
        price = usd_to_price_segment(usd) if usd else None
        if re.search(r"150,?000\+", line):
            price = max(price or 0, 8)
        merge_record(store, name, city, ops, stars, price)


def consolidate_store(store: dict[tuple[str, str], HotelRecord]) -> dict[tuple[str, str], HotelRecord]:
    """Merge same hotel across conflicting city keys; prefer inferred city."""
    by_name: dict[str, list[HotelRecord]] = {}
    for rec in store.values():
        by_name.setdefault(norm_key(rec.hotel_name), []).append(rec)

    merged: dict[tuple[str, str], HotelRecord] = {}
    for _, recs in by_name.items():
        primary = recs[0]
        for rec in recs[1:]:
            primary.operators.update(rec.operators)
            primary.hotel_stars.update(rec.hotel_stars)
            primary.price_segments.extend(rec.price_segments)
        primary.city = infer_city(primary.hotel_name, primary.city)
        merged[(norm_key(primary.hotel_name), norm_key(primary.city))] = primary
    return merged


def build_store() -> dict[tuple[str, str], HotelRecord]:
    store: dict[tuple[str, str], HotelRecord] = {}
    for path in SOURCES:
        text = path.read_text(encoding="utf-8")
        if "Make a research" in path.name:
            parse_perplexity_tables(text, store)
            parse_prose_inventory(text, store)
        elif "openai-research" in path.name:
            parse_openai_tables(text, store)
            parse_prose_inventory(text, store)
        else:
            parse_comprehensive_bullets(text, store)
            parse_prose_inventory(text, store)
    store = consolidate_store(store)
    enrich_store_metadata(store, build_metadata_index())
    return store


def to_rows(store: dict[tuple[str, str], HotelRecord]) -> list[dict]:
    rows = []
    for rec in store.values():
        ops = sorted(rec.operators, key=str.upper)
        stars = normalize_hotel_stars(rec.hotel_stars)
        price = round(sum(rec.price_segments) / len(rec.price_segments)) if rec.price_segments else None
        rows.append({
            "hotel_name": rec.hotel_name,
            "city": rec.city,
            "operator_mention_count": len(ops),
            "operators_confirmed_in_scan": ", ".join(ops) if ops else "n/a",
            "hotel_stars": stars if stars is not None else "",
            "price_segment_1_10": price if price is not None else "",
        })
    rows.sort(key=lambda r: (-(r["operator_mention_count"] or 0), r["hotel_name"].lower()))
    return rows


def write_json(rows: list[dict], path: Path):
    with path.open("w", encoding="utf-8") as f:
        json.dump(rows, f, indent=2, ensure_ascii=False)
        f.write("\n")


def write_md(rows: list[dict], path: Path):
    header = """# Aggregated Hotel Table

This table merges the 3 research files in this folder into one normalized list.

Assumptions used:
- `How many Travel operators mention this hotel` = unique operators explicitly named across the 3 source files.
- Generic OTA mentions and vague "aggregator" mentions were not counted as operators.
- Obvious duplicate hotel names were normalized into one row.
- Combined hotel entries (e.g. names joined with `/` or `,`) were split into separate rows.
- Long-tail and narrative hotel mentions from all 3 source files are parsed from prose paragraphs (FUN&SUN long tail, ANEX sitemap, ICS inventory, density candidates, conclusion lists).
- `Price segment` is a normalized 1-10 score consolidated from the source research.

| Hotel Name | City | How many Travel operators mention this hotel | Operators confirmed in scan | Hotel Stars | Price segment (1-10) |
|---|---|---:|---|---|---:|"""
    lines = [header]
    for r in rows:
        price = r["price_segment_1_10"] if r["price_segment_1_10"] != "" else ""
        lines.append(
            f"| {r['hotel_name']} | {r['city']} | {r['operator_mention_count']} | {r['operators_confirmed_in_scan']} | {r['hotel_stars']} | {price} |"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


GEOCODE_CACHE_PATH = BASE / "hotel-geocode-cache.json"
RESEARCHED_LOCATIONS_PATH = BASE / "researched-locations.json"


def load_researched_locations() -> dict:
    if RESEARCHED_LOCATIONS_PATH.exists():
        return json.loads(RESEARCHED_LOCATIONS_PATH.read_text(encoding="utf-8"))
    return {}


def researched_location_for(row: dict) -> dict | None:
    researched = load_researched_locations()
    for candidate in (row["hotel_name"], canonical_name(row["hotel_name"])):
        loc = researched.get(candidate)
        if not loc:
            continue
        if loc.get("latitude") and loc.get("longitude"):
            return {
                "latitude": float(loc["latitude"]),
                "longitude": float(loc["longitude"]),
                "geocoded_address": loc.get("address", ""),
                "geocode_query": f"researched-locations: {candidate}",
                "geocode_source": loc.get("source", "researched-locations"),
            }
        if loc.get("address"):
            return {
                "latitude": "",
                "longitude": "",
                "geocoded_address": loc["address"],
                "geocode_query": f"researched-locations: {candidate}",
                "geocode_source": loc.get("source", "researched-locations"),
            }
    return None


def load_geocode_cache() -> dict:
    if GEOCODE_CACHE_PATH.exists():
        return json.loads(GEOCODE_CACHE_PATH.read_text(encoding="utf-8"))
    return {}


def save_geocode_cache(cache: dict):
    GEOCODE_CACHE_PATH.write_text(json.dumps(cache, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


GEOCODE_USER_AGENT = "ExpatsTravelResearch/1.2 (hotel-map-generator)"
GEOCODE_SLEEP = 1.1
ADDRESS_MISMATCH_METERS = 350

WATER_TERMS_RE = re.compile(
    r"\b(sea|ocean|south china sea|đông biển|biển đông|river|sông|estuary|"
    r"cửa sông|lagoon|đầm|bay|vịnh|water|nước|maritime|offshore|channel|kênh)\b",
    re.I,
)
WRONG_POI_RE = re.compile(
    r"\b(pharmacy|nhà thuốc|caf[eé]|coffee|apartment(?! hotel)|b&m|giải khát)\b",
    re.I,
)
WATER_OK_NAME_RE = re.compile(
    r"\b(sea|ocean|river|beach|bay|retreat|wellness|riverside|water)\b",
    re.I,
)


def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    import math
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def address_tokens(text: str) -> set[str]:
    if not text:
        return set()
    text = text.lower()
    text = re.sub(r"[^\w\s]", " ", text)
    stop = {
        "vietnam", "viet", "nam", "hoi", "an", "danang", "da", "nang", "quang",
        "ward", "phuong", "phường", "city", "street", "st", "district", "thanh",
        "pho", "tp", "tinh", "province", "viet", "nam", "dong", "tay", "bac",
        "my", "ngu", "hanh", "son", "quan", "county", "town", "commune",
    }
    tokens: set[str] = set()
    for m in re.finditer(r"\b\d+\b", text):
        tokens.add(m.group(0))
    for w in text.split():
        if len(w) >= 3 and w not in stop:
            tokens.add(w)
    return tokens


def address_overlap_score(stored: str, other: str) -> int:
    if not stored or not other:
        return 0
    return len(address_tokens(stored) & address_tokens(other))


def resolve_stored_address(row: dict, geo: dict | None = None) -> str:
    researched = load_researched_locations()
    for candidate in (row["hotel_name"], canonical_name(row["hotel_name"])):
        loc = researched.get(candidate)
        if loc and loc.get("address"):
            return loc["address"]
    if geo and geo.get("geocoded_address"):
        return geo["geocoded_address"]
    return ""


def _http_json(url: str) -> list | dict:
    req = urllib.request.Request(url, headers={"User-Agent": GEOCODE_USER_AGENT})
    with urllib.request.urlopen(req, timeout=25) as resp:
        return json.loads(resp.read().decode())


def reverse_geocode(lat: float, lon: float) -> dict | None:
    params = urllib.parse.urlencode({
        "lat": lat, "lon": lon, "format": "json", "zoom": 18, "addressdetails": 1,
    })
    url = f"https://nominatim.openstreetmap.org/reverse?{params}"
    try:
        data = _http_json(url)
        return data if isinstance(data, dict) and data.get("lat") else None
    except Exception:
        return None


def geocode_nominatim(query: str) -> dict | None:
    params = urllib.parse.urlencode({
        "q": query, "format": "json", "limit": 3, "countrycodes": "vn", "addressdetails": 1,
    })
    url = f"https://nominatim.openstreetmap.org/search?{params}"
    try:
        data = _http_json(url)
    except Exception:
        return None
    if not data:
        return None
    for hit in data:
        addr = hit.get("address", {})
        state = (addr.get("state") or addr.get("province") or "").lower()
        if state and not any(x in state for x in ("đà nẵng", "da nang", "quảng nam", "quang nam")):
            continue
        return {
            "latitude": float(hit["lat"]),
            "longitude": float(hit["lon"]),
            "geocoded_address": hit.get("display_name", query),
            "geocode_query": f"nominatim: {query}",
            "geocode_source": "nominatim",
        }
    hit = data[0]
    return {
        "latitude": float(hit["lat"]),
        "longitude": float(hit["lon"]),
        "geocoded_address": hit.get("display_name", query),
        "geocode_query": f"nominatim: {query}",
        "geocode_source": "nominatim",
    }


def geocode_photon(query: str) -> dict | None:
    params = urllib.parse.urlencode({"q": query, "limit": 5, "lang": "en"})
    url = f"https://photon.komoot.io/api/?{params}"
    try:
        data = _http_json(url)
    except Exception:
        return None
    for feat in data.get("features", []):
        props = feat.get("properties", {})
        country = (props.get("country") or "").lower()
        if country and country not in ("vietnam", "việt nam"):
            continue
        coords = feat["geometry"]["coordinates"]
        name = props.get("name", "")
        street = props.get("street", "")
        city = props.get("city") or props.get("county") or ""
        display = ", ".join(x for x in (name, street, city, "Vietnam") if x)
        return {
            "latitude": coords[1],
            "longitude": coords[0],
            "geocoded_address": display or query,
            "geocode_query": f"photon: {query}",
            "geocode_source": "photon",
        }
    return None


def geocode_openmeteo(query: str) -> dict | None:
    """Third geocoder: Open-Meteo (free, no API key). Works best for named places."""
    params = urllib.parse.urlencode({"name": query, "count": 5, "language": "en", "format": "json"})
    url = f"https://geocoding-api.open-meteo.com/v1/search?{params}"
    try:
        data = _http_json(url)
    except Exception:
        return None
    for hit in data.get("results") or []:
        country = (hit.get("country") or "").lower()
        if country and country not in ("vietnam", "việt nam"):
            continue
        admin1 = (hit.get("admin1") or "").lower()
        if admin1 and not any(x in admin1 for x in ("đà nẵng", "da nang", "quảng nam", "quang nam")):
            continue
        name = hit.get("name", "")
        admin1s = hit.get("admin1", "")
        display = ", ".join(x for x in (name, admin1s, "Vietnam") if x)
        return {
            "latitude": float(hit["latitude"]),
            "longitude": float(hit["longitude"]),
            "geocoded_address": display or query,
            "geocode_query": f"openmeteo: {query}",
            "geocode_source": "openmeteo",
        }
    return None


def city_corridor_ok(row: dict, lat: float, lon: float) -> bool:
    """City-specific corridor rules beyond the general Da Nang / Hoi An bbox."""
    city = row.get("city", "").lower()
    if "hoi an" in city and "hoiana" not in city and "nam hoi an" not in city:
        if lat >= 15.98:
            return False
    if "hoiana" in city or "nam hoi an" in city:
        if lon < 108.35:
            return False
    return True


def _address_geocode_candidate(query: str, row: dict, label: str) -> dict | None:
    for fn, svc in (
        (geocode_nominatim, "nominatim-address"),
        (geocode_photon, "photon-address"),
        (geocode_openmeteo, "openmeteo-address"),
    ):
        result = fn(query)
        time.sleep(GEOCODE_SLEEP)
        if not result:
            continue
        if not geocode_quality_ok(row, result):
            continue
        if not city_corridor_ok(row, float(result["latitude"]), float(result["longitude"])):
            continue
        if WRONG_POI_RE.search(result.get("geocoded_address", "")):
            continue
        if coords_in_water(
            float(result["latitude"]), float(result["longitude"]),
            row["hotel_name"], result.get("geocoded_address", ""),
        ):
            continue
        result["geocode_source"] = f"{svc}:{label}"
        return result
    return None


def geocode_address_only(address: str, row: dict) -> dict | None:
    """Forward-geocode: hotel-qualified queries first, then bare address."""
    if not address or len(address) < 8:
        return None
    hotel = row.get("hotel_name", "")
    queries: list[str] = []
    if hotel:
        queries.append(f"{hotel}, {address}")
        queries.append(f"{hotel}, {address}, Vietnam")
    queries.append(address)
    if not address.lower().endswith("vietnam"):
        queries.append(f"{address}, Vietnam")

    seen: set[str] = set()
    candidates: list[dict] = []
    for query in queries:
        if not query or query in seen:
            continue
        seen.add(query)
        result = _address_geocode_candidate(query, row, "qualified" if hotel and hotel in query else "address")
        if result:
            candidates.append(result)

    if not candidates:
        return None
    if len(candidates) == 1:
        out = candidates[0]
        out["geocoded_address"] = address
        return out

    lats = [c["latitude"] for c in candidates]
    lons = [c["longitude"] for c in candidates]
    med_lat = sorted(lats)[len(lats) // 2]
    med_lon = sorted(lons)[len(lons) // 2]
    best = min(candidates, key=lambda c: haversine_meters(c["latitude"], c["longitude"], med_lat, med_lon))
    best["geocoded_address"] = address
    best["geocode_source"] = best.get("geocode_source", "address-consensus")
    return best


def address_fix_acceptable(
    row: dict,
    old_lat: float,
    old_lon: float,
    new_geo: dict,
    address: str,
    check: dict,
) -> tuple[bool, str]:
    """Reject address-verify fixes that worsen or barely change the pin."""
    new_lat = float(new_geo["latitude"])
    new_lon = float(new_geo["longitude"])

    if not geocode_quality_ok(row, new_geo):
        return False, "outside_bbox"
    if not city_corridor_ok(row, new_lat, new_lon):
        return False, "city_corridor_fail"

    old_overlap = check.get("reverse_overlap", 0) or 0
    new_reverse = reverse_geocode(new_lat, new_lon)
    time.sleep(GEOCODE_SLEEP)
    new_reverse_text = new_reverse.get("display_name", "") if new_reverse else ""
    new_overlap = address_overlap_score(address, new_reverse_text)

    if new_overlap < old_overlap:
        return False, f"reverse_overlap_worse({new_overlap}<{old_overlap})"

    if re.search(r"\d", address) and new_overlap < 2:
        return False, f"street_number_low_overlap({new_overlap})"

    move_m = haversine_meters(old_lat, old_lon, new_lat, new_lon)
    reasons = check.get("reasons", [])
    only_reverse = (
        reasons
        and all(r.startswith("reverse_address_mismatch") for r in reasons)
        and move_m < ADDRESS_MISMATCH_METERS
    )
    if only_reverse:
        return False, f"minor_reverse_only({move_m:.0f}m)"

    return True, ""


def verify_coords_against_address(row: dict, lat: float, lon: float, address: str) -> dict:
    """Cross-check pin vs stored address using reverse + forward geocoding."""
    reasons: list[str] = []
    reverse = reverse_geocode(lat, lon)
    time.sleep(GEOCODE_SLEEP)
    reverse_text = reverse.get("display_name", "") if reverse else ""
    overlap = address_overlap_score(address, reverse_text)

    if re.search(r"\d", address) and overlap < 2:
        reasons.append(f"reverse_address_mismatch(overlap={overlap})")

    addr_geo = geocode_address_only(address, row)
    distance_m = None
    if addr_geo:
        distance_m = haversine_meters(lat, lon, float(addr_geo["latitude"]), float(addr_geo["longitude"]))
        if distance_m > ADDRESS_MISMATCH_METERS:
            reasons.append(f"address_distance_{distance_m:.0f}m")

    return {
        "mismatch": bool(reasons),
        "reasons": reasons,
        "address_geo": addr_geo,
        "distance_m": distance_m,
        "reverse_overlap": overlap,
        "reverse_display": reverse_text[:120],
    }


def geocode_query(query: str):
    return geocode_nominatim(query)


def coords_in_water(lat: float, lon: float, hotel_name: str, display: str = "") -> bool:
    if WATER_OK_NAME_RE.search(hotel_name):
        return False
    text = display
    reverse = reverse_geocode(lat, lon)
    time.sleep(GEOCODE_SLEEP)
    if reverse:
        text += " " + reverse.get("display_name", "")
        text += " " + reverse.get("category", "") + " " + reverse.get("type", "")
    return bool(WATER_TERMS_RE.search(text))


def geocode_result_ok(row: dict, result: dict) -> bool:
    if not result or not geocode_quality_ok(row, result):
        return False
    display = result.get("geocoded_address", "")
    if WRONG_POI_RE.search(display):
        return False
    lat, lon = float(result["latitude"]), float(result["longitude"])
    if coords_in_water(lat, lon, row["hotel_name"], display):
        return False
    hotel_words = [w for w in re.split(r"[^a-z0-9]+", row["hotel_name"].lower()) if len(w) > 3]
    if hotel_words and not any(w in display.lower() for w in hotel_words[:2]):
        if not researched_location_for(row):
            return False
    return True


def cache_key_for_row(row: dict) -> str:
    return norm_key(canonical_name(row["hotel_name"]))


def geocode_hotel(row: dict, cache: dict) -> dict:
    key = cache_key_for_row(row)
    cached = cache.get(key, {})
    if not cached.get("latitude"):
        cached = cache.get(norm_key(row["hotel_name"]), {})
    if cached.get("latitude") and geocode_quality_ok(row, cached):
        if not WRONG_POI_RE.search(cached.get("geocoded_address", "")):
            conf = cached.get("geocode_confidence")
            if conf is None or float(conf) > 0.25:
                return {**row, **cached}

    researched = researched_location_for(row)
    if researched and researched.get("latitude"):
        if geocode_quality_ok(row, researched):
            cache[key] = researched
            return {**row, **researched}

    city = row["city"].replace(" / ", ", ")
    address_hint = researched.get("geocoded_address") if researched else ""
    queries = []
    if address_hint:
        queries.append(address_hint)
        queries.append(f"{address_hint}, Vietnam")
    queries.extend([
        f"{row['hotel_name']}, {city}, Vietnam",
        f"{row['hotel_name']}, Da Nang, Vietnam",
        f"{row['hotel_name']}, Hoi An, Quang Nam, Vietnam",
    ])
    seen = set()
    for q in queries:
        if not q or q in seen:
            continue
        seen.add(q)
        for geocoder in (geocode_nominatim, geocode_photon, geocode_openmeteo):
            result = geocoder(q)
            time.sleep(GEOCODE_SLEEP)
            if result and geocode_result_ok(row, result):
                if researched and researched.get("geocoded_address"):
                    result["geocoded_address"] = researched["geocoded_address"]
                cache[key] = result
                return {**row, **result}

    if cached.get("latitude") and geocode_quality_ok(row, cached):
        return {**row, **cached}

    cache[key] = {
        "latitude": "", "longitude": "",
        "geocoded_address": address_hint or "",
        "geocode_query": "",
        "geocode_source": "unresolved",
    }
    return {**row, **cache[key]}


PRICE_COLORS_HEX = {
    1: "#1B5E20",
    2: "#2E7D32",
    3: "#43A047",
    4: "#7CB342",
    5: "#C0CA33",
    6: "#FDD835",
    7: "#FB8C00",
    8: "#F4511E",
    9: "#E53935",
    10: "#B71C1C",
}

PRICE_TIER_LABELS = {
    1: "1 - Budget",
    2: "2 - Very cheap",
    3: "3 - Cheap",
    4: "4 - Value",
    5: "5 - Mid-range",
    6: "6 - Upper mid-range",
    7: "7 - Upscale",
    8: "8 - Premium",
    9: "9 - Luxury",
    10: "10 - Ultra luxury",
}


def parse_price_segment(value) -> int | None:
    if value in ("", None):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        nums = re.findall(r"\d+", str(value))
        return int(nums[0]) if nums else None


def price_style(segment: int | None) -> dict:
    if segment is None or segment not in PRICE_COLORS_HEX:
        return {
            "price_segment": "",
            "price_tier": "Unknown",
            "marker_color_hex": "#9E9E9E",
            "marker_color_kml": "ff9e9e9e",
        }
    return {
        "price_segment": segment,
        "price_tier": PRICE_TIER_LABELS[segment],
        "marker_color_hex": PRICE_COLORS_HEX[segment],
        "marker_color_kml": hex_to_kml_color(PRICE_COLORS_HEX[segment]),
    }


def hex_to_kml_color(hex_color: str, alpha: int = 255) -> str:
    hex_color = hex_color.lstrip("#")
    r = int(hex_color[0:2], 16)
    g = int(hex_color[2:4], 16)
    b = int(hex_color[4:6], 16)
    return f"{alpha:02x}{b:02x}{g:02x}{r:02x}"


def enrich_row_with_price_style(row: dict) -> dict:
    style = price_style(parse_price_segment(row.get("price_segment_1_10")))
    return {**row, **style}


def prepare_map_rows(rows: list[dict]) -> list[dict]:
    prepared = []
    for row in rows:
        enriched = enrich_row_with_price_style(row)
        city = enriched["city"].replace(" / ", ", ")
        search_address = f"{enriched['hotel_name']}, {city}, Vietnam"
        if geocode_quality_ok(enriched, enriched):
            enriched["address_for_map"] = enriched.get("geocoded_address") or search_address
        else:
            enriched["latitude"] = ""
            enriched["longitude"] = ""
            enriched["address_for_map"] = search_address
        prepared.append(enriched)
    return prepared


FALLBACK_COORDS = {
    (16.068, 108.212),
    (15.8880397, 108.3367883),
}


def geocode_quality_ok(row: dict, geo: dict) -> bool:
    if not geo or not geo.get("latitude"):
        return False
    lat, lon = float(geo["latitude"]), float(geo["longitude"])
    if (lat, lon) in FALLBACK_COORDS:
        return False
    # Central Vietnam coast: Da Nang, Hoi An, Hoiana / Nam Hoi An corridor
    return (15.75 <= lat <= 16.25 and 108.0 <= lon <= 108.45) or (
        15.78 <= lat <= 15.85 and 108.38 <= lon <= 108.42
    )


def write_mymaps_csv(rows: list[dict], path: Path):
    fieldnames = [
        "Name", "Address", "Latitude", "Longitude", "City",
        "Price Tier", "Price Segment (1-10)", "Marker Color",
        "Operator Mention Count", "Operators Confirmed", "Hotel Stars",
        "Description",
    ]
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in rows:
            desc = (
                f"Stars: {r['hotel_stars']}. "
                f"Price tier: {r['price_tier']}. "
                f"Price segment: {r.get('price_segment_1_10')}/10. "
                f"Operators ({r['operator_mention_count']}): {r['operators_confirmed_in_scan']}"
            )
            writer.writerow({
                "Name": r["hotel_name"],
                "Address": r["address_for_map"],
                "Latitude": r.get("latitude", ""),
                "Longitude": r.get("longitude", ""),
                "City": r["city"],
                "Price Tier": r["price_tier"],
                "Price Segment (1-10)": r.get("price_segment_1_10", ""),
                "Marker Color": r["marker_color_hex"],
                "Operator Mention Count": r["operator_mention_count"],
                "Operators Confirmed": r["operators_confirmed_in_scan"],
                "Hotel Stars": r["hotel_stars"],
                "Description": desc,
            })


def write_kml(rows: list[dict], path: Path):
    def esc(s):
        return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<kml xmlns="http://www.opengis.net/kml/2.2">',
        "<Document>",
        "<name>Russian Tour Operator Hotels - Da Nang &amp; Hoi An</name>",
        "<description>Marker colors: green = cheap, red = expensive (price segment 1-10)</description>",
    ]

    style_ids = set()
    for r in rows:
        if r.get("price_segment") != "":
            style_ids.add(int(r["price_segment"]))
        else:
            style_ids.add("unknown")

    for segment in sorted(s for s in style_ids if s != "unknown"):
        style = price_style(segment)
        parts.extend([
            f'<Style id="price-{segment}">',
            "<IconStyle>",
            f"<color>{style['marker_color_kml']}</color>",
            "<scale>1.1</scale>",
            "<Icon><href>http://maps.google.com/mapfiles/kml/paddle/wht-blank.png</href></Icon>",
            "</IconStyle>",
            "</Style>",
        ])
    unknown = price_style(None)
    parts.extend([
        '<Style id="price-unknown">',
        "<IconStyle>",
        f"<color>{unknown['marker_color_kml']}</color>",
        "<scale>1.0</scale>",
        "<Icon><href>http://maps.google.com/mapfiles/kml/paddle/wht-blank.png</href></Icon>",
        "</IconStyle>",
        "</Style>",
    ])

    for r in rows:
        lat, lon = r.get("latitude"), r.get("longitude")
        if not lat or not lon:
            continue
        segment = r.get("price_segment")
        style_id = f"price-{segment}" if segment != "" else "price-unknown"
        desc = esc(
            f"City: {r['city']}\\n"
            f"Price tier: {r['price_tier']}\\n"
            f"Price segment: {r.get('price_segment_1_10')}/10\\n"
            f"Stars: {r['hotel_stars']}\\n"
            f"Operators ({r['operator_mention_count']}): {r['operators_confirmed_in_scan']}"
        )
        parts.extend([
            "<Placemark>",
            f"<name>{esc(r['hotel_name'])}</name>",
            f"<description>{desc}</description>",
            f"<styleUrl>#{style_id}</styleUrl>",
            "<Point>",
            f"<coordinates>{lon},{lat},0</coordinates>",
            "</Point>",
            "</Placemark>",
        ])
    parts.extend(["</Document>", "</kml>"])
    path.write_text("\n".join(parts) + "\n", encoding="utf-8")


def main():
    store = build_store()
    rows = to_rows(store)
    write_json(rows, BASE / "aggregated-hotels-table.json")
    write_md(rows, BASE / "aggregated-hotels-table.md")

    cache = load_geocode_cache()
    geocoded = []
    for i, row in enumerate(rows):
        geocoded.append(geocode_hotel(row, cache))
        if (i + 1) % 10 == 0:
            print(f"Geocoded {i + 1}/{len(rows)}", flush=True)
            save_geocode_cache(cache)
    save_geocode_cache(cache)

    write_mymaps_csv(prepare_map_rows(geocoded), BASE / "aggregated-hotels-mymaps.csv")
    write_kml(prepare_map_rows(geocoded), BASE / "aggregated-hotels-mymaps.kml")
    prepared = prepare_map_rows(geocoded)
    geocoded_count = sum(1 for r in prepared if r.get("latitude") and r.get("longitude"))
    print(f"Hotels: {len(rows)}")
    print(f"Geocoded: {geocoded_count}/{len(rows)}")
    print(f"Bellerive present: {any('bellerive' in r['hotel_name'].lower() for r in rows)}")
    if geocoded_count < len(rows):
        print("Still need geocoding:")
        for r in prepared:
            if not r.get("latitude") or not r.get("longitude"):
                print(f"  - {r['hotel_name']} ({r['city']})")


if __name__ == "__main__":
    main()
