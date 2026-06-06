#!/usr/bin/env python3
"""Verify hotel geocodes: address-first cross-check + multi-service re-geocoding."""

from __future__ import annotations

import json
import re
import subprocess
import sys
import time
from collections import defaultdict
from pathlib import Path

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))

from build_hotel_dataset import (  # noqa: E402
    ADDRESS_MISMATCH_METERS,
    GEOCODE_CACHE_PATH,
    RESEARCHED_LOCATIONS_PATH,
    FALLBACK_COORDS,
    address_fix_acceptable,
    build_store,
    cache_key_for_row,
    canonical_name,
    geocode_address_only,
    geocode_quality_ok,
    haversine_meters,
    load_geocode_cache,
    load_researched_locations,
    norm_key,
    resolve_stored_address,
    reverse_geocode,
    save_geocode_cache,
    to_rows,
    verify_coords_against_address,
)

SLEEP = 1.15

WATER_RE = re.compile(
    r"\b(sea|ocean|south china sea|đông biển|biển đông|river|sông|estuary|"
    r"cửa sông|lagoon|đầm|bay|vịnh|water|nước|maritime|offshore|channel|kênh)\b",
    re.I,
)
WRONG_POI_RE = re.compile(
    r"\b(pharmacy|nhà thuốc|caf[eé]|coffee|apartment(?! hotel)|"
    r"b&m|giải khát|bar\b|restaurant(?! hotel)|shop|store)\b",
    re.I,
)
ESTIMATE_SOURCES = re.compile(r"map estimate|estimate", re.I)


def is_water_location(reverse: dict | None, display: str = "") -> bool:
    text = display
    if reverse:
        text += " " + reverse.get("display_name", "")
        cat = reverse.get("category", "") + " " + reverse.get("type", "")
        text += " " + cat
        for v in (reverse.get("address") or {}).values():
            text += " " + str(v)
    return bool(WATER_RE.search(text))


def is_wrong_poi(display: str, hotel_name: str) -> bool:
    if WRONG_POI_RE.search(display):
        return True
    lower = display.lower()
    if not any(w in lower for w in ("hotel", "resort", "villa", "retreat", "spa", "suites", "inn")):
        hotel_words = [w for w in re.split(r"[^a-z0-9]+", hotel_name.lower()) if len(w) > 3]
        if hotel_words and not any(w in lower for w in hotel_words[:2]):
            return True
    return False


def basic_suspicion(row: dict, geo: dict, reverse: dict | None) -> list[str]:
    reasons = []
    if not geo.get("latitude"):
        return ["missing_coords"]
    lat, lon = float(geo["latitude"]), float(geo["longitude"])
    display = geo.get("geocoded_address", "")

    if (lat, lon) in FALLBACK_COORDS or (round(lat, 3), round(lon, 3)) == (16.068, 108.212):
        reasons.append("fallback_city_center")
    if not geocode_quality_ok(row, geo):
        reasons.append("outside_corridor_bbox")
    conf = geo.get("geocode_confidence")
    if conf is not None and float(conf) <= 0.25:
        reasons.append(f"low_confidence({conf})")
    src = geo.get("geocode_source", "")
    if ESTIMATE_SOURCES.search(src) or ESTIMATE_SOURCES.search(geo.get("geocode_query", "")):
        reasons.append("map_estimate")
    if is_wrong_poi(display, row["hotel_name"]):
        reasons.append(f"wrong_poi:{display[:60]}")
    if is_water_location(reverse, display):
        reasons.append(f"water_or_river:{reverse.get('display_name', '')[:60] if reverse else display[:60]}")
    return reasons


def write_report_md(report: dict, path: Path):
    lines = [
        "# Geocode verification report (address-first)",
        "",
        f"- Checked: **{report['checked']}**",
        f"- Address cross-checks: **{report['address_checked']}**",
        f"- Address mismatches: **{report['address_mismatches']}**",
        f"- Fixed: **{report['fixed']}**",
        f"- Still uncertain: **{report['still_uncertain']}**",
        "",
        "## Fixes applied",
        "",
        "| Hotel | Issue | Old coords | New coords | Source |",
        "|---|---|---|---|---|",
    ]
    for fix in report.get("fixes", []):
        old = fix.get("old")
        new = fix.get("new")
        lines.append(
            f"| {fix['hotel']} | {', '.join(fix.get('reasons', []))} | "
            f"{old[0]:.5f}, {old[1]:.5f} | {new[0]:.5f}, {new[1]:.5f} | {fix.get('source', '')} |"
        )
    if report.get("still_bad"):
        lines.extend(["", "## Still uncertain", ""])
        for item in report["still_bad"]:
            lines.append(f"- **{item['hotel']}**: {', '.join(item.get('reasons', []))}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    researched = load_researched_locations()
    cache = load_geocode_cache()
    rows = to_rows(build_store())

    print(f"Checking {len(rows)} hotels (address-first + reverse)...\n")

    address_checks = 0
    address_mismatches: list[tuple[dict, dict, dict]] = []
    other_suspicious: list[tuple[dict, dict, list[str]]] = []
    coord_stacks: dict[tuple, list[str]] = defaultdict(list)

    for row in rows:
        key = cache_key_for_row(row)
        geo = cache.get(key, cache.get(norm_key(row["hotel_name"]), {}))
        if not geo.get("latitude"):
            other_suspicious.append((row, geo, ["missing_coords"]))
            continue

        lat, lon = float(geo["latitude"]), float(geo["longitude"])
        coord_stacks[(round(lat, 4), round(lon, 4))].append(key)

        address = resolve_stored_address(row, geo)
        addr_check = None
        if address and len(address) >= 12:
            address_checks += 1
            print(f"Address check: {row['hotel_name'][:45]}...", flush=True)
            addr_check = verify_coords_against_address(row, lat, lon, address)
            if addr_check["mismatch"]:
                address_mismatches.append((row, geo, addr_check))
                print(f"  ADDRESS MISMATCH: {addr_check['reasons']} (dist={addr_check.get('distance_m')})")
            else:
                print(f"  address OK (overlap={addr_check['reverse_overlap']})")
        else:
            print(f"Reverse only: {row['hotel_name'][:45]}...", flush=True)
            reverse = reverse_geocode(lat, lon)
            time.sleep(SLEEP)
            reasons = basic_suspicion(row, geo, reverse)
            if reasons:
                other_suspicious.append((row, geo, reasons))
                print(f"  SUSPICIOUS: {reasons}")
            else:
                print("  OK")

    fixes: list[dict] = []
    still_bad: list[dict] = []
    fixed_hotels: set[str] = set()
    pending_fix_coords: dict[tuple[float, float], str] = {}

    def try_apply_fix(
        row: dict,
        old_geo: dict,
        new_geo: dict,
        address: str,
        reasons: list[str],
        check: dict | None = None,
    ) -> bool:
        key = cache_key_for_row(row)
        old = (float(old_geo["latitude"]), float(old_geo["longitude"]))
        new = (float(new_geo["latitude"]), float(new_geo["longitude"]))
        coord_key = (round(new[0], 4), round(new[1], 4))

        if check is not None:
            ok, reject = address_fix_acceptable(row, old[0], old[1], new_geo, address, check)
            if not ok:
                still_bad.append({
                    "hotel": row["hotel_name"],
                    "reasons": reasons + [f"fix_rejected:{reject}"],
                    "coords": old,
                })
                print(f"REJECTED (address): {row['hotel_name']} — {reject}")
                return False

        if coord_key in pending_fix_coords and pending_fix_coords[coord_key] != row["hotel_name"]:
            dup = pending_fix_coords[coord_key]
            still_bad.append({
                "hotel": row["hotel_name"],
                "reasons": reasons + [f"duplicate_coord_stack:{dup}"],
                "coords": old,
            })
            print(f"REJECTED (duplicate): {row['hotel_name']} -> {new} already assigned to {dup}")
            return False

        new_geo["geocoded_address"] = address
        new_geo["geocode_query"] = f"address-verify: {address[:100]}"
        new_geo["geocode_source"] = new_geo.get("geocode_source", "address-verify")
        new_geo["address_verified"] = True
        cache[key] = new_geo
        pending_fix_coords[coord_key] = row["hotel_name"]
        fixed_hotels.add(row["hotel_name"])

        for candidate in (row["hotel_name"], canonical_name(row["hotel_name"])):
            if candidate in researched:
                researched[candidate]["latitude"] = new_geo["latitude"]
                researched[candidate]["longitude"] = new_geo["longitude"]
                researched[candidate]["source"] = new_geo.get("geocode_source", "address-verify")
                break

        fix_entry = {
            "hotel": row["hotel_name"],
            "city": row["city"],
            "reasons": reasons,
            "old": old,
            "new": new,
            "address": address,
            "source": new_geo.get("geocode_source"),
        }
        if check:
            fix_entry["distance_m"] = check.get("distance_m")
            fix_entry["reverse_overlap"] = check.get("reverse_overlap")
        fixes.append(fix_entry)
        print(f"FIXED (address): {row['hotel_name']} {old} -> {new}")
        return True

    # Fix address mismatches first — trust address geocode over pin
    for row, old_geo, check in address_mismatches:
        address = resolve_stored_address(row, old_geo)
        new_geo = check.get("address_geo")
        if not new_geo:
            new_geo = geocode_address_only(address, row)
            time.sleep(SLEEP)
        if new_geo:
            try_apply_fix(row, old_geo, new_geo, address, check["reasons"], check)
        else:
            still_bad.append({
                "hotel": row["hotel_name"],
                "reasons": check["reasons"] + ["no_address_geocode"],
                "coords": (old_geo.get("latitude"), old_geo.get("longitude")),
            })

    # Fix other suspicious (water, wrong POI) via address-first if possible
    for row, old_geo, reasons in other_suspicious:
        if any(r.startswith("duplicate_stack") for r in reasons):
            continue
        if row["hotel_name"] in fixed_hotels:
            continue
        address = resolve_stored_address(row, old_geo)
        print(f"\nRe-geocoding (other): {row['hotel_name']} ({reasons})")
        new_geo = None
        if address:
            new_geo = geocode_address_only(address, row)
            time.sleep(SLEEP)
        if new_geo:
            try_apply_fix(row, old_geo, new_geo, address, reasons)
        else:
            still_bad.append({
                "hotel": row["hotel_name"],
                "reasons": reasons,
                "coords": (old_geo.get("latitude"), old_geo.get("longitude")),
            })

    save_geocode_cache(cache)
    RESEARCHED_LOCATIONS_PATH.write_text(json.dumps(researched, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    report = {
        "checked": len(rows),
        "address_checked": address_checks,
        "address_mismatches": len(address_mismatches),
        "suspicious_other": len(other_suspicious),
        "fixed": len(fixes),
        "still_uncertain": len(still_bad),
        "address_mismatch_threshold_m": ADDRESS_MISMATCH_METERS,
        "fixes": fixes,
        "still_bad": still_bad,
    }
    json_path = BASE / "geocode-verification-report.json"
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    write_report_md(report, BASE / "geocode-verification-report.md")

    print(f"\nRegenerating CSV/KML...")
    subprocess.run([sys.executable, str(BASE / "build_hotel_dataset.py")], check=True)

    print(f"\nReport: {json_path}")
    print(f"Checked: {len(rows)}, address checks: {address_checks}, mismatches: {len(address_mismatches)}")
    print(f"Fixed: {len(fixes)}, Still uncertain: {len(still_bad)}")


if __name__ == "__main__":
    main()
