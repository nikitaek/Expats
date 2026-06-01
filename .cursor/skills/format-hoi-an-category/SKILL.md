---
name: format-hoi-an-category
description: >-
  Formats Russian in Hoi An guide category markdown files (headings, spacing,
  location bullets, Google/Yandex map icon links). Use when formatting or fixing
  files under Russian in Hoi An/categories/, when the user mentions category
  guide formatting, map icons, or Hoi An guide structure.
---

# Format Hoi An Category Guides

Apply this workflow to markdown files in `Russian in Hoi An/categories/*.md`.

## Document structure

| Element | Rule |
|---------|------|
| Page title | Single `## Title` at top (not `#`) |
| Sections | `### Section title` — no numbering (`1.`, `2.`, …) |
| After `###` | Exactly **one** blank line, then the intro paragraph |
| Between sections | **Two** blank lines after the last list item before the next `###` |
| Navigation | Remove lines like `[← Категории](../categories.md) · [Обзор](../overview.md)` |
| Indentation | **No** leading spaces on paragraphs or list items (4-space indent breaks rendering) |

## Section pattern

```markdown
## Category title

### Section title

Intro paragraph with practical advice (one or more sentences).

- **Place name** — short description. MAP_ICONS
- **Another place** — description. MAP_ICONS


### Next section title

Next intro paragraph...
```

## Location bullets

Each concrete place (beach, pier, restaurant, dive center, marina, etc.) gets:

1. Bold name + em dash + description
2. Clickable map icons at the end of the line

**With maps** (physical location):

```markdown
- **An Bang Beach (Hoi An)** — calm water, good for beginners. [![Google Maps](../images/google-maps-icon.png)](GOOGLE_URL) [![Yandex Maps](../images/yandex-maps-icon.png)](YANDEX_URL)
```

**Without maps** (abstract / directory / “ask hotel” — not a pin):

```markdown
- **PADI centers in Hoi An** — check the official PADI site for accredited centers.
```

Skip map links for labels listed in `NO_MAP` inside `Russian in Hoi An/build/fix_maps_links.py`.

## Map icons (required)

Icons live **inside the guide project**, not the vault root:

```
Russian in Hoi An/images/google-maps-icon.png
Russian in Hoi An/images/yandex-maps-icon.png
```

From `categories/*.md`, always use:

```
../images/google-maps-icon.png
../images/yandex-maps-icon.png
```

If `images/` is missing, copy from `Images/Google_Maps_icon.png` and `Images/Yandex_Maps_icon.png` at the Expats vault root, then rename to kebab-case filenames above.

Never use emoji placeholders, `LINK_TO_GOOGLE_MAPS`, or paths outside `Russian in Hoi An/` (e.g. `../../Images/...`).

## Resolving map URLs

1. Prefer coordinates from `PLACES` in `Russian in Hoi An/build/fix_maps_links.py`.
2. Build URLs with the same logic as `PlaceLink` in that script:
   - Google: `https://www.google.com/maps/place/{encoded_query}/@{lat},{lng},17z`
   - Yandex: `https://yandex.com/maps/?ll={lng},{lat}&z=17&pt={lng},{lat},pm2d`
3. For unknown labels, use `search_query_for_label()` behavior (append `, Hoi An, Vietnam` or `, Da Nang, Vietnam` as appropriate) and geocode if needed.
4. Do **not** leave placeholder URLs.

Optional helper (from `Russian in Hoi An/`):

```bash
python3 build/fix_maps_links.py
```

That script updates **text** map links on `- label ([Google Maps](url), [Yandex Maps](url))` lines only. After running it, convert text links to **image icon** links using the template above.

## Quality checklist

Before finishing, verify:

- [ ] Title is `##`, sections are `###`, no numbered section headings
- [ ] Spacing: 1 blank line after `###`; 2 blank lines between sections
- [ ] No navigation footer to categories/overview
- [ ] Lists use `- ` at column 0; no broken `**bold**` wrapping map links
- [ ] Every physical place has both icon links with working URLs
- [ ] Icon paths are `../images/google-maps-icon.png` and `../images/yandex-maps-icon.png`
- [ ] Non-locations have no map links

## Common fixes

| Problem | Fix |
|---------|-----|
| Broken layout / no lists | Remove 4-space line prefixes |
| Images not showing | Use `../images/...` from `categories/`; confirm files exist in `Russian in Hoi An/images/` |
| Maps inside bold | Put description in bold; map icons **after** the description, outside `**` |
| Triple blank lines | Normalize to exactly 2 between sections |

## Scope

- **In scope**: `Russian in Hoi An/categories/*.md`, shared `images/` icons, map URL helpers in `build/fix_maps_links.py`
- **Out of scope**: Changing guide content meaning, editing `overview.md` structure unless asked, committing without user request
