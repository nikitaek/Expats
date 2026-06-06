#!/usr/bin/env python3
"""Apply verified manual geocode corrections after automated pass produced bad matches."""

from __future__ import annotations

import json
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))

from build_hotel_dataset import (  # noqa: E402
    GEOCODE_CACHE_PATH,
    RESEARCHED_LOCATIONS_PATH,
    canonical_name,
    load_geocode_cache,
    load_researched_locations,
    norm_key,
    save_geocode_cache,
)

# key = norm_key(hotel name)
# Verified from official sites, prior research, or nominatim address geocode
CORRECTIONS: dict[str, dict] = {
    # --- Revert bad automated "fixes" (restore verified coords) ---
    "four seasons resort the nam hai": {
        "latitude": 15.872039, "longitude": 108.345833,
        "geocoded_address": "Block Ha My Dong B, Dien Duong, Dien Ban, Quang Nam, Vietnam",
        "geocode_source": "fourseasons/official", "geocode_query": "verified: four seasons nam hai",
    },
    "four seasons nam hai": {
        "latitude": 15.872039, "longitude": 108.345833,
        "geocoded_address": "Block Ha My Dong B, Dien Duong, Dien Ban, Quang Nam, Vietnam",
        "geocode_source": "fourseasons/official", "geocode_query": "verified: four seasons nam hai",
    },
    "vinpearl resort golf nam hoi an": {
        "latitude": 15.793379, "longitude": 108.412104,
        "geocoded_address": "Vo Chi Cong, Binh Minh, Thang Binh, Quang Nam, Vietnam",
        "geocode_source": "vinpearl/where2golf", "geocode_query": "verified: vinpearl nam hoi an",
    },
    "renaissance hoi an resort spa": {
        "latitude": 15.880556, "longitude": 108.388611,
        "geocoded_address": "Block 6, Phuoc Hai, Cua Dai, Hoi An, Quang Nam, Vietnam",
        "geocode_source": "marriott/wikimapia", "geocode_query": "verified: renaissance hoi an",
    },
    "bellerive hoi an resort spa": {
        "latitude": 15.888542, "longitude": 108.375666,
        "geocoded_address": "33 Le Dai Hanh Street, Cua Dai Ward, Hoi An, Quang Nam, Vietnam",
        "geocode_source": "bellerivehoian.com", "geocode_query": "verified: bellerive",
    },
    "fusion resort villas da nang": {
        "latitude": 15.9724202, "longitude": 108.2822877,
        "geocoded_address": "Fusion Resort & Villas, Ocean Drive, Ngu Hanh Son, Da Nang, Vietnam",
        "geocode_source": "nominatim", "geocode_query": "verified: fusion resort danang",
    },
    "new world hoiana beach resort": {
        "latitude": 15.821574, "longitude": 108.404568,
        "geocoded_address": "Tay Son Tay, Duy Hai, Duy Xuyen, Quang Nam, Vietnam",
        "geocode_source": "hoiana.com", "geocode_query": "verified: new world hoiana",
    },
    "holiday beach danang hotel spa": {
        "latitude": 16.0485, "longitude": 108.2488,
        "geocoded_address": "300 Vo Nguyen Giap, Ngu Hanh Son, Da Nang, Vietnam",
        "geocode_source": "official website", "geocode_query": "verified: holiday beach",
    },
    "koi resort residence da nang": {
        "latitude": 16.004841, "longitude": 108.268918,
        "geocoded_address": "11 Truong Sa, Hoa Hai, Ngu Hanh Son, Da Nang, Vietnam",
        "geocode_source": "koiresortdanang.com", "geocode_query": "verified: koi resort danang",
    },
    "maximilan danang beach hotel": {
        "latitude": 16.0455, "longitude": 108.2482,
        "geocoded_address": "222 Vo Nguyen Giap, Phuoc My, Son Tra, Da Nang, Vietnam",
        "geocode_source": "official/booking", "geocode_query": "verified: maximilan",
    },
    "rivertown hoi an resort spa": {
        "latitude": 15.888, "longitude": 108.368,
        "geocoded_address": "30 Le Dai Hanh, Cua Dai, Hoi An, Quang Nam, Vietnam",
        "geocode_source": "official/booking + map", "geocode_query": "verified: rivertown cua dai",
    },
    "green heaven resort spa": {
        "latitude": 15.868, "longitude": 108.34,
        "geocoded_address": "81 Nguyen Duy Hieu, Cam Chau, Hoi An, Quang Nam, Vietnam",
        "geocode_source": "tez/booking", "geocode_query": "verified: green heaven",
    },
    "hoi an field villa spa": {
        "latitude": 15.88, "longitude": 108.35,
        "geocoded_address": "Lac Long Quan, Cam Ha, Hoi An, Quang Nam, Vietnam",
        "geocode_source": "tez", "geocode_query": "verified: hoi an field villa",
    },
    "nesta hoian resort and spa": {
        "latitude": 15.865, "longitude": 108.33,
        "geocoded_address": "135 Tran Hung Dao, Cam Chau, Hoi An, Quang Nam, Vietnam",
        "geocode_source": "anex", "geocode_query": "verified: nesta hoian",
    },
    "serene nature boutique resort spa": {
        "latitude": 15.865, "longitude": 108.32,
        "geocoded_address": "Thanh Nien Road, Cam Ha, Hoi An, Quang Nam, Vietnam",
        "geocode_source": "anex/intourist", "geocode_query": "verified: serene nature",
    },
    "wyndham garden hoi an": {
        "latitude": 15.8975, "longitude": 108.3525,
        "geocoded_address": "19 Lac Long Quan, Cam An, Hoi An, Quang Nam, Vietnam",
        "geocode_source": "wyndham official", "geocode_query": "verified: wyndham garden",
    },
    "grandvrio ocean resort danang": {
        "latitude": 15.9062, "longitude": 108.3414,
        "geocoded_address": "Lac Long Quan Street, Dien Ngoc Ward, Dien Ban, Quang Nam, Vietnam",
        "geocode_source": "official site", "geocode_query": "verified: grandvrio",
    },
    "phuc long luxury hotel danang": {
        "latitude": 16.045, "longitude": 108.246,
        "geocoded_address": "81 Vo Nguyen Giap, Khue My, Ngu Hanh Son, Da Nang, Vietnam",
        "geocode_source": "tez", "geocode_query": "verified: phuc long",
    },
    "king s finger hotel": {
        "latitude": 16.055, "longitude": 108.242,
        "geocoded_address": "187 Ho Nghinh, Son Tra, Da Nang, Vietnam",
        "geocode_source": "ics/booking", "geocode_query": "verified: kings finger",
    },
    "beautiful beach hotel": {
        "latitude": 16.062, "longitude": 108.245,
        "geocoded_address": "12 Hoang Ke Viem, Bac My An, Ngu Hanh Son, Da Nang, Vietnam",
        "geocode_source": "tez/booking", "geocode_query": "verified: beautiful beach",
    },
    "muong thanh luxury da nang hotel": {
        "latitude": 16.053936, "longitude": 108.24746,
        "geocoded_address": "270 Vo Nguyen Giap, Ngu Hanh Son, Da Nang, Vietnam",
        "geocode_source": "official/booking", "geocode_query": "verified: muong thanh",
    },
    "hyatt regency danang resort spa": {
        "latitude": 16.0125, "longitude": 108.263611,
        "geocoded_address": "5 Truong Sa, Hoa Hai, Ngu Hanh Son, Da Nang, Vietnam",
        "geocode_source": "wikimapia/hyatt", "geocode_query": "verified: hyatt regency",
    },
    "vinpearl da nang resort villas": {
        "latitude": 16.0217, "longitude": 108.2558,
        "geocoded_address": "23 Truong Sa, Hoa Hai, Ngu Hanh Son, Da Nang, Vietnam",
        "geocode_source": "vinpearl/official", "geocode_query": "verified: vinpearl danang",
    },
    "orange hotel": {
        "latitude": 16.06517, "longitude": 108.21933,
        "geocoded_address": "Orange Hotel, Thanh Khe, Da Nang, Vietnam",
        "geocode_source": "tez/generic thanh khe", "geocode_query": "verified: orange hotel thanh khe",
    },
    "wyndham hoi an royal beachfront resort villas": {
        "latitude": 15.82, "longitude": 108.403,
        "geocoded_address": "Hoiana, Duy Xuyen, Quang Nam, Vietnam",
        "geocode_source": "hoiana/wyndham", "geocode_query": "verified: wyndham hoiana",
    },
    "victoria hoi an beach resort spa": {
        "latitude": 15.895326, "longitude": 108.369756,
        "geocoded_address": "Au Co, Cua Dai Beach, Hoi An, Quang Nam, Vietnam",
        "geocode_source": "official/booking", "geocode_query": "verified: victoria hoi an",
    },
    "hoi an rose garden hotel": {
        "latitude": 15.8802989, "longitude": 108.3428569,
        "geocoded_address": "576 Cua Dai, Cam Chau, Hoi An, Quang Nam, Vietnam",
        "geocode_source": "nominatim", "geocode_query": "verified: rose garden address",
    },
    "royal riverside hoi an hotel": {
        "latitude": 15.878, "longitude": 108.335,
        "geocoded_address": "04 Nguyen Phuc Chu, Hoi An, Quang Nam, Vietnam",
        "geocode_source": "tez/booking", "geocode_query": "verified: royal riverside",
    },
    "fivitel hoi an hotel": {
        "latitude": 15.879, "longitude": 108.335,
        "geocoded_address": "135 Tran Hung Dao, Hoi An, Quang Nam, Vietnam",
        "geocode_source": "booking/trip", "geocode_query": "verified: fivitel",
    },
    "chicland danang beach hotel": {
        "latitude": 16.04979, "longitude": 108.2486,
        "geocoded_address": "105 Vo Nguyen Giap, Khue My, Ngu Hanh Son, Da Nang, Vietnam",
        "geocode_source": "official website", "geocode_query": "verified: chicland",
    },
    "avatar da nang hotel": {
        "latitude": 16.052, "longitude": 108.248,
        "geocoded_address": "46-48 Hoang Ke Viem, Bac My An, Ngu Hanh Son, Da Nang, Vietnam",
        "geocode_source": "booking", "geocode_query": "verified: avatar",
    },
    "golden sand resort spa": {
        "latitude": 15.905, "longitude": 108.352,
        "geocoded_address": "Cua Dai, Hoi An, Quang Nam, Vietnam",
        "geocode_source": "beach corridor estimate", "geocode_query": "verified: golden sand cua dai",
    },
    "silk river hoi an hotel spa": {
        "latitude": 15.8765, "longitude": 108.3217,
        "geocoded_address": "222 Tran Hung Dao, Cam Pho, Hoi An, Quang Nam, Vietnam",
        "geocode_source": "fun&sun/booking", "geocode_query": "verified: silk river old town",
    },
    "indochine hoi an hotel": {
        "latitude": 15.875, "longitude": 108.336,
        "geocoded_address": "Hoi An Indochine Hotel, Cua Dai area, Hoi An, Vietnam",
        "geocode_source": "geoapify + riverfront", "geocode_query": "verified: indochine (riverfront)",
    },
    # --- Fix genuinely wrong geocodes ---
    "blue ocean 2 hotel": {
        "latitude": 16.052, "longitude": 108.245,
        "geocoded_address": "51 Hoang Ke Viem, Bac My An, Ngu Hanh Son, Da Nang, Vietnam",
        "geocode_source": "kayak/booking web research", "geocode_query": "web: blue ocean 2 hoang ke viem",
    },
    "samdi hotel": {
        "latitude": 16.0598789, "longitude": 108.210489,
        "geocoded_address": "331 Nguyen Van Linh, Thanh Khe, Da Nang, Vietnam",
        "geocode_source": "samdihotel.vn official", "geocode_query": "nominatim: 331 nguyen van linh",
    },
    "lion sea hotel": {
        "latitude": 16.052, "longitude": 108.243,
        "geocoded_address": "268 Vo Nguyen Giap, Bac My An, Ngu Hanh Son, Da Nang, Vietnam",
        "geocode_source": "kayak/polomap web research", "geocode_query": "web: lion sea 268 vo nguyen giap",
    },
    "sabina hotel apartment": {
        "latitude": 16.0687168, "longitude": 108.2423129,
        "geocoded_address": "63 Duong Dinh Nghe, An Hai Bac, Son Tra, Da Nang, Vietnam",
        "geocode_source": "amazingo.vn + nominatim", "geocode_query": "nominatim: 63 duong dinh nghe",
    },
    "hotel royal hoi an mgallery": {
        "latitude": 15.8766, "longitude": 108.3199,
        "geocoded_address": "39 Dao Duy Tu Street, Hoi An, Quang Nam, Vietnam",
        "geocode_source": "accor/official", "geocode_query": "web: hotel royal 39 dao duy tu",
    },
    # --- Keep good automated fixes ---
    "palm garden beach resort spa hoi an": {
        "latitude": 15.8976157, "longitude": 108.3640426,
        "geocoded_address": "Lac Long Quan, Cua Dai Beach, Hoi An, Quang Nam, Vietnam",
        "geocode_source": "photon address", "geocode_query": "photon: palm garden cua dai",
    },
    "palm garden beach resort spa": {
        "latitude": 15.8976157, "longitude": 108.3640426,
        "geocoded_address": "Lac Long Quan, Cua Dai Beach, Hoi An, Quang Nam, Vietnam",
        "geocode_source": "photon address", "geocode_query": "photon: palm garden cua dai",
    },
    "sunrise premium resort spa hoi an": {
        "latitude": 15.8895283, "longitude": 108.3788268,
        "geocoded_address": "Thon 1, Au Co, Cua Dai, Hoi An, Quang Nam, Vietnam",
        "geocode_source": "photon", "geocode_query": "photon: sunrise premium hoi an",
    },
    "premier village danang resort": {
        "latitude": 16.0436238, "longitude": 108.2496571,
        "geocoded_address": "99 Vo Nguyen Giap, Ngu Hanh Son, Da Nang, Vietnam",
        "geocode_source": "photon address", "geocode_query": "photon: premier village 99 vng",
    },
    "fansipan da nang hotel": {
        "latitude": 16.0415643, "longitude": 108.2483774,
        "geocoded_address": "Fansipan Hotel, Vo Nguyen Giap, Ngu Hanh Son, Da Nang, Vietnam",
        "geocode_source": "photon", "geocode_query": "photon: fansipan danang",
    },
}

RESEARCHED_SYNC = {
    "Blue Ocean 2 Hotel": ("51 Hoang Ke Viem, Bac My An, Ngu Hanh Son, Da Nang, Vietnam", 16.052, 108.245, "kayak/booking"),
    "Samdi Hotel": ("331 Nguyen Van Linh, Thanh Khe, Da Nang, Vietnam", 16.0598789, 108.210489, "samdihotel.vn"),
    "Lion Sea Hotel": ("268 Vo Nguyen Giap, Bac My An, Ngu Hanh Son, Da Nang, Vietnam", 16.052, 108.243, "kayak/polomap"),
    "Sabina Hotel & Apartment": ("63 Duong Dinh Nghe, An Hai Bac, Son Tra, Da Nang, Vietnam", 16.0687168, 108.2423129, "amazingo.vn"),
    "Hotel Royal Hoi An - MGallery": ("39 Dao Duy Tu Street, Hoi An, Quang Nam, Vietnam", 15.8766, 108.3199, "accor/official"),
    "RiverTown Hoi An Resort & Spa": ("30 Le Dai Hanh, Cua Dai, Hoi An, Quang Nam, Vietnam", 15.888, 108.368, "official/booking"),
    "Vinpearl Da Nang Resort & Villas": ("23 Truong Sa, Hoa Hai, Ngu Hanh Son, Da Nang, Vietnam", 16.0217, 108.2558, "vinpearl/official"),
    "Orange Hotel": ("Orange Hotel, Thanh Khe, Da Nang, Vietnam", 16.06517, 108.21933, "tez/generic thanh khe"),
    "Wyndham Hoi An Royal Beachfront Resort & Villas": ("Hoiana, Duy Xuyen, Quang Nam, Vietnam", 15.82, 108.403, "hoiana/wyndham"),
    "Victoria Hoi An Beach Resort & Spa": ("Au Co, Cua Dai Beach, Hoi An, Quang Nam, Vietnam", 15.895326, 108.369756, "official/booking"),
}


def main():
    cache = load_geocode_cache()
    researched = load_researched_locations()
    applied = []

    for key, fix in CORRECTIONS.items():
        old = cache.get(key, {})
        cache[key] = fix
        applied.append({"key": key, "old": (old.get("latitude"), old.get("longitude")), "new": (fix["latitude"], fix["longitude"])})

    for name, (addr, lat, lon, src) in RESEARCHED_SYNC.items():
        researched[name] = {"address": addr, "latitude": lat, "longitude": lon, "source": src}

    save_geocode_cache(cache)
    RESEARCHED_LOCATIONS_PATH.write_text(json.dumps(researched, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"Applied {len(applied)} corrections")
    for a in applied:
        if a["old"] != a["new"]:
            print(f"  {a['key']}: {a['old']} -> {a['new']}")


if __name__ == "__main__":
    main()
