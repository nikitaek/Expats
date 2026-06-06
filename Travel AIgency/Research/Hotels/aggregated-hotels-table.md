# Aggregated Hotel Table

This table merges the 3 research files in this folder into one normalized list.

Assumptions used:
- `How many Travel operators mention this hotel` = unique operators explicitly named across the 3 source files.
- Generic OTA mentions and vague "aggregator" mentions were not counted as operators.
- Obvious duplicate hotel names were normalized into one row.
- Combined hotel entries (e.g. names joined with `/` or `,`) were split into separate rows.
- Long-tail and narrative hotel mentions from all 3 source files are parsed from prose paragraphs (FUN&SUN long tail, ANEX sitemap, ICS inventory, density candidates, conclusion lists).
- `Price segment` is a normalized 1-10 score consolidated from the source research.

| Hotel Name | City | How many Travel operators mention this hotel | Operators confirmed in scan | Hotel Stars | Price segment (1-10) |
|---|---|---:|---|---|---:|
| Palm Garden Beach Resort & Spa Hoi An | Hoi An | 11 | ANEX, Art Tour, BG, Coral, FUN&SUN, PACS, Pegas, PSG, R-Express, Sunmar, TEZ | 5 | 7 |
| Sheraton Grand Danang Resort | Da Nang | 10 | ANEX, Art Tour, Coral, FUN&SUN, PACS, Pegas, PSG, R-Express, Sunmar, TEZ | 5 | 8 |
| Furama Resort Danang | Da Nang | 9 | ANEX, Coral, FUN&SUN, PACS, Pegas, Planeta Travel, R-Express, Sunmar, TEZ | 5 | 8 |
| Hoi An Beach Resort | Hoi An | 9 | ANEX, Coral, FUN&SUN, PACS, Pegas, Planeta Travel, R-Express, Sunmar, TEZ | 4 | 6 |
| Hyatt Regency Danang Resort & Spa | Da Nang | 9 | ANEX, Coral, FUN&SUN, ICS, PACS, Pegas, R-Express, Sunmar, TEZ | 5 | 9 |
| Pullman Danang Beach Resort | Da Nang | 9 | ANEX, Coral, FUN&SUN, Pegas, Planeta Travel, PSG, Space Travel, Sunmar, TEZ | 5 | 7 |
| Muong Thanh Luxury Da Nang Hotel | Da Nang | 8 | ANEX, BG, Coral, FUN&SUN, PACS, Pegas, Sunmar, TEZ | 4 | 5 |
| New World Hoiana Beach & Resort | Hoiana | 8 | ANEX, Coral, FUN&SUN, Pegas, PSG, R-Express, Sunmar, TEZ | 5 | 7 |
| Radisson Hotel Danang | Da Nang | 8 | ANEX, Art Tour, Coral, FUN&SUN, ICS, Pegas, Sunmar, TEZ | 5 | 7 |
| Vinpearl Resort & Golf Nam Hoi An | Hoiana / Nam Hoi An | 8 | ANEX, Coral, FUN&SUN, Pegas, PSG, R-Express, Sunmar, TEZ | 5 | 8 |
| Wyndham Hoi An Royal Beachfront Resort & Villas | Hoiana | 8 | ANEX, Coral, FUN&SUN, Pegas, PSG, R-Express, Sunmar, TEZ | 5 | 6 |
| Anantara Hoi An Resort | Hoi An | 7 | ANEX, Coral, FUN&SUN, PACS, Pegas, Space Travel, TEZ | 4 | 9 |
| Holiday Beach Danang Hotel & Spa | Da Nang | 7 | ANEX, BG, Coral, FUN&SUN, Pegas, Sunmar, TEZ | 4 | 4 |
| TMS Hotel Da Nang Beach | Da Nang | 7 | ANEX, Coral, FUN&SUN, Pegas, PSG, Sunmar, TEZ | 4 | 6 |
| Four Seasons Resort The Nam Hai | Ha My / Dien Duong | 6 | ANEX, Art Tour, BG, ICS, R-Express, TEZ | 5 | 9 |
| InterContinental Danang Sun Peninsula Resort | Da Nang | 5 | ANEX, Coral, PACS, Pegas, PSG | 5 | 10 |
| Maximilan Danang Beach Hotel | Da Nang | 5 | ANEX, BG, PACS, Pegas, PSG | 4 | 5 |
| Premier Village Danang Resort Managed by Accor | Da Nang | 5 | BG, Coral, ICS, Pegas, R-Express | 5 | 9 |
| Bliss Hoi An Beach Resort & Wellness | Hoi An | 4 | ANEX, FUN&SUN, PSG, Space Travel | 5 | 8 |
| Danang Marriott Resort & Spa | Da Nang | 4 | ANEX, Art Tour, PSG, R-Express | 5 | 8 |
| DLG Hotel Danang | Da Nang | 4 | ANEX, FUN&SUN, ICS, R-Express | 5 | 6 |
| Hoiana Residences | Hoiana | 4 | ANEX, Pegas, PSG, R-Express | 5 | 7 |
| Koi Resort & Residence Da Nang | Da Nang | 4 | ANEX, BG, PACS, PSG | 5 | 6 |
| M Hotel Danang | Da Nang | 4 | ANEX, FUN&SUN, Pegas, R-Express | 5 | 6 |
| Mandila Beach Hotel | Da Nang | 4 | ANEX, BG, PACS, PSG | 4 | 4 |
| Minh Toan Safi Ocean Hotel | Da Nang | 4 | ANEX, BG, PACS, PSG | 4 | 3 |
| Non Nuoc Beach Villas | Da Nang | 4 | ANEX, Art Tour, PSG, R-Express | 5 | 9 |
| Victoria Hoi An Beach Resort & Spa | Hoi An | 4 | ANEX, BG, PACS, PSG | 5 | 7 |
| Wyndham Garden Hoi An | Hoi An | 4 | ANEX, BG, PACS, PSG | 4 | 5 |
| A La Carte Danang Beach | Da Nang | 3 | ANEX, PSG, R-Express | 5 | 7 |
| Angel Hotel | Da Nang | 3 | FUN&SUN, ICS, PSG | 3 | 1 |
| Avatar Da Nang Hotel | Da Nang | 3 | FUN&SUN, ICS, PSG | 4 | 2 |
| Blue Ocean 2 Hotel | Da Nang | 3 | FUN&SUN, ICS, PSG | 3 | 1 |
| King's Finger Hotel | Da Nang | 3 | FUN&SUN, ICS, PSG | 3 | 1 |
| Renaissance Hoi An Resort & Spa | Hoi An | 3 | Art Tour, PSG, R-Express | 5 | 7 |
| Belle Maison Parosand Danang | Da Nang | 2 | Coral, Pegas | 4 | 3 |
| Fivitel Hoi An Hotel | Hoi An | 2 | ANEX, PSG | 4 | 4 |
| Four Seasons Nam Hai | Hoi An | 2 | ANEX, TEZ | 4 | 10 |
| Naman Retreat | Hoi An | 2 | KOMPAS, Pegas | 5 | 8 |
| Serene Nature Boutique Resort & Spa | Hoi An | 2 | ANEX, R-Express | 4 | 6 |
| Wyndham Danang Golden Bay | Da Nang | 2 | ANEX, Pegas | 5 | 5 |
| Ancient House Resort Hoi An | Hoi An | 1 | FUN&SUN | 4 | 5 |
| Bamboo Green Central Hotel | Da Nang | 1 | TEZ | 3 | 1 |
| Beautiful Beach Hotel | Da Nang | 1 | TEZ | 3 | 3 |
| Bellerive Hoi An Resort & Spa | Hoi An | 1 | FUN&SUN | 5 | 7 |
| Centara Sandy Beach Resort Danang | Da Nang | 1 | TEZ | 4 | 7 |
| Centre Point Hotel and Residence | Da Nang | 1 | ANEX | 5 | 5 |
| Century Hotel Da Nang | Da Nang | 1 | ANEX | 4 | 4 |
| Chicland Danang Beach Hotel | Da Nang | 1 | Pegas | 4 | 7 |
| Diamond Sea Hotel | Da Nang | 1 | ANEX | 4 | 6 |
| Dylan Hotel Da Nang | Da Nang | 1 | TEZ | 3 | 3 |
| Fansipan Da Nang Hotel | Da Nang | 1 | TEZ | 3 | 1 |
| Furama Villas Danang | Da Nang | 1 | China Travel | 5 | 9 |
| Fusion Resort & Villas Da Nang | Da Nang | 1 | ANEX | 5 | 7 |
| Golden Sand Resort & Spa | Hoi An | 1 | TEZ | 5 | 4 |
| Grand Mercure Danang | Da Nang | 1 | China Travel | 5 | 6 |
| Grandvrio Ocean Resort Danang | Da Nang | 1 | ANEX | 5 | 5 |
| Green Heaven Resort & Spa | Hoi An | 1 | TEZ | 4 | 2 |
| Green Hotel Danang | Da Nang | 1 | TEZ | 3 | 4 |
| Hoi An Field Villa & Spa | Hoi An | 1 | R-Express | 3 | 1 |
| Hoi An Memories Land | Hoi An | 1 | ANEX | 5 | 7 |
| Hoi An Odyssey Hotel | Hoi An | 1 | FUN&SUN | 4 | 4 |
| Hoi An Rose Garden Hotel | Hoi An | 1 | R-Express | 3 | 1 |
| Hotel Royal Hoi An - MGallery | Hoi An | 1 | R-Express | 5 | 8 |
| Hyatt Regency Danang | Da Nang | 1 | China Travel | 5 | 7 |
| Indochine Hoi An Hotel | Hoi An | 1 | TEZ | 3 | 3 |
| Kay Hotel | Da Nang | 1 | TEZ | 3 | 1 |
| Koi Resort & Spa Hoi An | Hoi An | 1 | TEZ | 5 | 5 |
| La Charm Hoi An Hotel & Spa | Hoi An | 1 | FUN&SUN | 4 | 5 |
| Laluna Riverside Hoi An | Hoi An | 1 | FUN&SUN | 4 | 5 |
| Lion Sea Hotel | Da Nang | 1 | TEZ | 3 | 1 |
| Melia Danang Beach Resort | Da Nang | 1 | Pegas | 5 | 7 |
| Namia River Retreat | Hoi An | 1 | ANEX | 5 | 9 |
| Nesta Hoian Resort and Spa | Hoi An | 1 | ANEX | 5 | 5 |
| Orange Hotel | Da Nang | 1 | TEZ | 3 | 3 |
| Palm Garden Beach Resort & Spa | Hoi An | 1 | TEZ | 5 | 8 |
| Peninsula Hotel Danang | Da Nang | 1 | ANEX | 5 | 6 |
| Phuc Long Luxury Hotel Danang | Da Nang | 1 | TEZ | 4 | 8 |
| Pulchra Resort Danang | Da Nang | 1 | China Travel | 5 | 8 |
| River Suites Hoi An | Hoi An | 1 | TEZ | 4 | 2 |
| RiverTown Hoi An Resort & Spa | Hoi An | 1 | FUN&SUN | 4 | 5 |
| Royal Lotus Hotel Danang | Da Nang | 1 | ANEX | 4 | 5 |
| Royal Riverside Hoi An Hotel | Hoi An | 1 | TEZ | 4 | 2 |
| Sabina Hotel & Apartment | Da Nang | 1 | TEZ | 3 | 3 |
| Samdi Hotel | Da Nang | 1 | TEZ | 4 | 3 |
| Sandy Beach Non Nuoc Resort Danang | Da Nang | 1 | Pegas | 4 | 5 |
| Shilla Monogram Danang | Da Nang | 1 | ANEX | 5 | 8 |
| Silk River Hoi An Hotel & Spa | Hoi An | 1 | FUN&SUN | 4 | 5 |
| Sunrise Premium Resort & Spa Hoi An | Hoi An | 1 | TEZ | 5 | 5 |
| The Nature Villas & Resort | Da Nang | 1 | TEZ | 3 | 3 |
| TIA Wellness Resort | Da Nang | 1 | PSG | 5 | 9 |
| Vinpearl Da Nang Resort & Villas | Da Nang | 1 | China Travel | 5 | 8 |
| Boutique Hoi An Resort | Hoi An | 0 | n/a | 4 | 6 |
| Four Points by Sheraton Danang | Da Nang | 0 | n/a | 5 | 6 |
| New Orient Hotel Danang | Da Nang | 0 | n/a | 4 | 4 |
| Wyndham Soleil Danang | Da Nang | 0 | n/a | 5 | 6 |
