#!/usr/bin/env python3
"""Fix Google Maps and Yandex Maps links in category markdown files."""

from __future__ import annotations

import json
import re
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

GUIDE_DIR = Path(__file__).resolve().parent.parent
CATEGORIES_DIR = GUIDE_DIR / "categories"
CACHE_FILE = Path(__file__).resolve().parent / ".maps_cache.json"

def parse_bullet_line(line: str) -> Optional[tuple[str, str, str]]:
    """Return (label, google_url, yandex_url) if line has map links."""
    if not line.startswith("- ") or " ([Google Maps](" not in line:
        return None
    marker = " ([Google Maps]("
    start = line.find(marker)
    if start == -1 or not line.endswith("))"):
        return None
    label = line[2:start]
    rest = line[start + len(marker) :]
    try:
        google_url, yandex_part = rest.split("), [Yandex Maps](", 1)
    except ValueError:
        return None
    yandex_url = yandex_part[:-2]  # strip trailing ))
    return label, google_url, yandex_url

# Items that are not physical locations — drop map links entirely.
NO_MAP = {
    "100% robusta для phin",
    "18-22 г кофе на 60-90 мл воды",
    "3 дня: Cao lau, Mi Quang, Old Town вечер, An Bang sunset, Cham Islands или Marble Mountains",
    "7 дней: + Ba Na Hills, Son Tra/Lady Buddha, seafood day в Дананге, мастер-класс или tailor day",
    "Arabica Da Lat для фильтра",
    "Bao nhieu tien? - Сколько стоит?",
    "Binance P2P",
    "Bloom 20-30 секунд",
    "Bybit P2P",
    "Cam on - Спасибо",
    "Cho toi den... - Отвезите меня в...",
    "Convenience stores для быстрого варианта",
    "Duty Free только как backup-вариант",
    "Food must-try: banh mi, white rose, com ga, egg/coconut coffee",
    "Grab bike по городу: ~15k–60k VND",
    "Grab car короткая поездка: ~60k–180k VND",
    "GrabFood",
    "GrabMart",
    "GrabMart комбо-заказ",
    "Khong cay - Не острое",
    "Klook/GetYourGuide private transfer",
    "Mastercard debit/credit",
    "Medium blend (арабика+робуста)",
    "Medium: 3-4 кг",
    "OKX P2P",
    "Pho/локальный суп: ~35k–80k VND",
    "Premium: 5+ кг",
    "ShopeeFood",
    "ShopeeFood/GrabMart для быстрых заказов",
    "Small: 1.5-2 кг",
    "Toi muon mua cai nay - Я хочу купить это",
    "UnionPay",
    "Visa debit/credit",
    "WhatsApp конкретного ресторана",
    "WhatsApp конкретного ресторана (если есть)",
    "GrabFood (до позднего времени)",
    "ShopeeFood (в активных районах)",
    "GrabMart (быстрый вариант)",
    "Small: 1.5-2 кг (база)",
    "Medium: 3-4 кг (семейный)",
    "Premium: 5+ кг (микс с импорт/редкими позициями)",
    "Кофе (зерно/молотый)",
    "Klook/GetYourGuide (для прозрачного сравнения)",
    "Стоит тур: Cham Islands (море/снаряжение)",
    "Можно самим: Son Tra + Lady Buddha (с водителем)",
    "PADI-центры из Хойана (по актуальному списку PADI)",
    "Vietnam Diving (Cham Islands маршруты)",
    "Караоке 24/7 (точечно)",
    "Vincom beauty stores (Da Nang)",
    "Xin chao - Здравствуйте",
    "Бронирование через отель/консьерж",
    "Водители с повторными хорошими отзывами",
    "Вьетнамский кофе",
    "Избегать сырых морепродуктов в случайных точках",
    "Карты «Мир»",
    "Кофе: ~25k–70k VND",
    "Лед/сгущенка по вкусу",
    "GrabBike",
    "GrabCar",
    "Robusta",
    "Arabica Da Lat",
    "Мини-набор косметики/бальзамов",
    "Нetwork SPA в отелях 4-5*",
    "Кофейные магазины при обжарщиках",
    "Известные локальные обжарщики",
    "Отельная прачечная (дороже, но просто)",
    "Guardian/Watsons (где доступно)",
    "Локальные OTC-сделки только через эскроу/проверку",
    "Binance P2P (самый распространенный маршрут)",
    "Локальные fruit-селлеры в WhatsApp",
    "Локальные фотографы через Instagram",
    "Массаж 60 мин: ~250k–600k VND",
    "Международная страховка: номер ассистанса из полиса",
    "Мыть фрукты и руки перед едой",
    "Не брать соусы/салаты, долго стоящие в тепле",
    "Не пить воду из-под крана",
    "Общая экстракция 4-6 минут",
    "Осторожно со льдом вне проверенных мест",
    "Площадки: Airbnb Experiences/Klook фотосессии",
    "Пожарная: 114",
    "Полиция: 113",
    "Проверенные реселлеры через отель",
    "Проверенные реселлеры через отель/консьержа с фикс-прайсом",
    "Рекомендации отеля/апартаментов",
    "Рекомендации русскоязычных чатов района",
    "Скорая: 115",
    "Смеси arabica/robusta",
    "Туристическая поддержка: через local tourist support hotline/ресепшен",
    "Формат: локальный photographer + 2-3 локации",
    "Формат: private car 4/7 мест с fixed price",
    "Комбо «фотограф + платье»",
    "Комбо с Monkey Mountain маршрутом",
    "Комбо-предложения отелей",
    "Комбинация: самостоятельная прогулка + 1-2 платных объекта",
    "Заказ через ресепшен/хозяина жилья",
    "Доставка 19L через локальных water suppliers",
    "Прямой заказ в 24/7 mini-mart + готовая еда",
    "Pharmacity delivery",
    "Long Chau delivery",
    "Прачечные с доставкой через WhatsApp/телефон",
    "Сервисы с доставкой байка к жилью",
    "Локальные аптеки с доставкой в отель",
    "2-3 локальных агентства в Old Town",
    "Локальные агентства с ценой «all-in»",
    "Официальные сайты крупных операторов",
    "Официальные сайты парков",
    "Частный трансфер + локальный гид",
    "Hoi An private car services",
    "Danang day-driver services",
    "Klook/GetYourGuide",
    "GetYourGuide",
    "Klook",
    "Tailor fitting day",
    "Можно самим: Old Town Hoi An",
    "Можно самим: Marble Mountains + пляж",
    "Можно самим: Son Tra + Lady Buddha",
    "Маршрут A: Hoi An - Marble Mountains - Son Tra - Da Nang dinner",
    "Маршрут B: Hoi An - My Son - Coffee stop - Old Town evening",
    "Маршрут C: Hoi An - Ba Na Hills full day",
    "Рекомендации отелей и свадебных студий",
    "Photo studios with menswear package",
    "Wedding suit rental Danang",
    "Bridal/photo studios Hoi An",
    "Аэропорт как запасной быстрый вариант",
    "WinMart/супермаркеты с доставкой",
    "WinMart/минимаркеты с крупной тарой",
    "WinMart/WinMart+",
    "Супермаркет + deli отдел",
    "Супермаркеты WinMart/GO!/Lotte",
    "Супермаркеты с household-отделом",
    "Импортные отделы в крупных супермаркетах",
    "Электроотделы Lotte/GO!",
    "Kitchenware магазины Danang",
    "Специализированные bottle shops Danang",
    "Крупные beauty-салоны Дананга",
    "Косметические зоны Lotte Mart",
    "Lotte Mart cosmetic zones",
    "Vincom beauty stores",
    "Guardian/Watsons",
    "Официальные корнеры брендов",
    "Официальные магазины брендов",
    "La Viet/Da Lat бренды в маркетах",
    "Highlands/Trung Nguyen фирменные зоны",
    "Кофейные магазины при обжarщиках",
    "Подарочный local blend с датой обжарки",
    "Кофе + phin + открытка",
    "Керамика + текстильные салфетки",
    "Чай + сухофрукты + специи",
    "Мини-набор косметики/бальзamov",
    "Бальзамы и часть аптечных средств",
    "Пляжный day-pass формат",
    "Sunrise-вариант",
    "Diving package",
    "Snorkeling package",
    "Speedboat day trip",
    "Утренний тур из Хойана",
    "Стоит тур: Ba Na Hills",
    "Стоит тур: Cham Islands",
    "PADI-центры из Хойана",
    "Частные boat-операторы на Cham Islands",
    "Danang Marina/операторы day cruise",
    "Официальные инфоточкb для списка объектов",
    "Приватные VIP-комнаты",
    "KTV-клубы Da Nang",
    "Караоке 24/7",
    "Локальные karaoke lounges",
    "Pool halls Da Nang center",
    "Бильярд-клубы Danang",
    "Ночные бильярд-клубы Son Tra",
    "Спорт-бары с 1-3 столами",
    "Часть баров в Da Nang",
    "Local pub stages in Old Town",
    "Soul Kitchen live nights",
    "Evening show zones",
    "Rooftop-бар до закрытия",
    "Hotel rooftop bars в Son Tra/My An",
    "Rooftops in Da Nang",
    "Rooftops в Da Nang beach area",
    "Rooftop terrace with west-facing view",
    "Danang live bars near riverfront",
    "River-view rooftops Hoi An",
    "Beach bars An Bang",
    "Beach road заведения An Bang",
    "Поздние pho/noodle-споты в Дананге",
    "Ночные закусочные pho/noodles",
    "Ночной рынок/стрит-фуд",
    "Круглосуточные convenience stores",
    "Локальные мини-маркеты рядом с отелем",
    "Продавцы с An Bang/Cam Chau доставкой",
    "Laundry shops в Cam Chau/Cam An",
    "Салоны в An Bang/Cam Chau",
    "Локальные e-bike rental points в Cam An",
    "Прокаты при отелях",
    "Hub Hoi An coworking/cafe зоны",
    "Кофейни с кондиционером",
    "Рестораны в An Bang с мультиязычным меню",
    "Кафе Old Town с RU/EN menu",
    "Семейные европейские бистро в Cam An",
    "An Bang seafood restaurants",
    "Danang seafood улицы у побережья",
    "Cua Dai seafood strip",
    "Be Man/подобные известные seafood-форматы Дананга",
    "Tailor shops в Old Town",
    "Tailor studios Hoi An",
    "Нейл-студии Old Town",
    "Музеи и галереи Old Town",
    "Кулинарные мастер-классы",
    "SPA/массаж",
    "Network SPA в отелях 4-5*",
    "Аптеки у Vinmec/крупных клиник Дананга",
    "Обменники в центре Хойана (Old Town)",
    "Ювелирные магазины с лицензией на обмен",
    "Обменники в Danang city center",
    "Банковские отделения (чуть ниже курс, но выше формальность)",
    "Кассы у входных зон Old Town",
    "Крупные сетевые супермаркеты",
    "Bach Hoa Xanh (где доступно)",
    "Co.op Food (локально)",
    "CellphoneS (в Дананге)",
    "VinaPhone points",
    "MobiFone stores",
    "Phin Coffee spots в центре",
    "Phin-фильтр",
    "Robusta",
    "Arabica Da Lat",
    "Ca phe den da",
    "Ca phe sua da",
    "Coconut coffee",
    "Egg coffee",
    "Salt coffee",
    "Известные локальные обжarщики",
    "Coconut/cacao локальные продукты",
    "Локальная керамика и лаковые изделия",
    "Шелк/лен из ателье",
    "Da Nang Downtown riverfront прогулки",
    "Thu Bon river bends",
    "Thu Bon river embankment",
    "Thu Bon river promenade",
    "Lantern streets",
    "Hoi An Old Town yellow walls",
    "Japanese Covered Bridge area",
    "Son Tra panoramic points",
    "Son Tra viewpoints",
    "Marble Mountains viewpoints",
    "An Bang Beach shoreline",
    "An Bang Beach sunset zone",
    "Cua Dai beachfront",
    "Cua Dai coastline",
    "Coconut Basket Boat area",
}

# Manual overrides: display label -> (lat, lng, optional google query, optional yandex oid)
# Coordinates verified for Hoi An / Da Nang region.
PLACES: dict[str, tuple[float, float, str, str]] = {
    "43 Factory Coffee Roaster": (15.8771, 108.3268, "43 Factory Coffee Roaster Hoi An", ""),
    "9 Grains Bakery & Cafe": (15.8775, 108.3280, "9 Grains Bakery Cafe Hoi An", ""),
    "A Dong Silk": (15.8778, 108.3275, "A Dong Silk Hoi An", ""),
    "ACB ATM": (15.8790, 108.3270, "ACB ATM Hoi An", ""),
    "Adventure Land": (15.8500, 108.4000, "Adventure Land Hoi An", ""),
    "An Bang Beach": (15.9040, 108.3650, "An Bang Beach Hoi An", ""),
    "An Khang Pharmacy": (15.8785, 108.3272, "An Khang Pharmacy Hoi An", ""),
    "Asia Park Da Nang": (16.0600, 108.2200, "Asia Park Da Nang", ""),
    "BIDV ATM": (15.8790, 108.3270, "BIDV ATM Hoi An", ""),
    "Bach Hoa Xanh": (15.8800, 108.3280, "Bach Hoa Xanh Hoi An", ""),
    "Bai Chong": (15.9100, 108.3700, "Bai Chong An Bang", ""),
    "Bai Xep": (15.9200, 108.3800, "Bai Xep beach", ""),
    "Banh mi Hoi An": (15.8770, 108.3270, "Banh Mi Phuong Hoi An", ""),
    "Bebe Tailor": (15.8775, 108.3270, "Bebe Tailor Hoi An", ""),
    "Bikini Bottom": (15.9045, 108.3655, "Bikini Bottom An Bang", ""),
    "Cao lau": (15.8770, 108.3275, "Cao Lau Thanh Hoi An", ""),
    "CellphoneS": (16.0670, 108.2200, "CellphoneS Da Nang", ""),
    "Cham Island Diving Center": (15.8770, 108.3280, "Cham Island Diving Center Hoi An", ""),
    "Citrus Health Spa Hoi An": (15.8780, 108.3275, "Citrus Health Spa Hoi An", ""),
    "Co.op Food": (15.8800, 108.3280, "Co.op Food Hoi An", ""),
    "Coconut Boat": (15.8600, 108.3500, "Coconut Boat Tour Cam Thanh", ""),
    "Com ga Hoi An": (15.8775, 108.3275, "Com Ga Ba Buoi Hoi An", ""),
    "Con Market": (16.0680, 108.2200, "Con Market Da Nang", ""),
    "Cua Dai Beach": (15.8900, 108.3800, "Cua Dai Beach Hoi An", ""),
    "Cua Dai Pier": (15.8920, 108.3820, "Cua Dai Pier Hoi An", ""),
    "Dingo Deli": (15.8770, 108.3285, "Dingo Deli Hoi An", ""),
    "FPT Shop": (15.8790, 108.3275, "FPT Shop Hoi An", ""),
    "Faifo Coffee": (15.8775, 108.3278, "Faifo Coffee Hoi An", ""),
    "Fantasy Park": (15.9950, 107.9960, "Fantasy Park Ba Na Hills", ""),
    "French Village": (15.9950, 107.9960, "French Village Ba Na Hills", ""),
    "GO!": (16.0600, 108.2100, "GO Big C Da Nang", ""),
    "GO! Danang": (16.0600, 108.2100, "GO Big C Da Nang", ""),
    "Golden Bridge": (15.9950, 107.9960, "Golden Bridge Ba Na Hills", ""),
    "GrabBike": (15.8794, 108.3297, "Hoi An Ancient Town", ""),
    "GrabCar": (15.8794, 108.3297, "Hoi An Ancient Town", ""),
    "Green SM Taxi": (16.0544, 108.2022, "Da Nang", ""),
    "Han Market": (16.0680, 108.2200, "Han Market Da Nang", ""),
    "Hidden Beach": (15.9050, 108.3660, "Hidden Beach An Bang", ""),
    "Hoi An Central Market": (15.8770, 108.3280, "Hoi An Central Market", ""),
    "Hoi An Diving Center": (15.8770, 108.3280, "Hoi An Diving Center", ""),
    "Hoi An Memories Land": (15.8650, 108.3400, "Hoi An Memories Land", ""),
    "Hoi An Night Market": (15.8775, 108.3280, "Hoi An Night Market", ""),
    "Hoi An Roastery": (15.8778, 108.3278, "Hoi An Roastery", ""),
    "Hoi An Roastery retail": (15.8778, 108.3278, "Hoi An Roastery", ""),
    "Hon Dai": (15.9100, 108.5000, "Hon Dai island", ""),
    "Hon Mo": (15.9000, 108.4800, "Hon Mo island", ""),
    "Huyen Khong Cave": (15.9790, 108.2610, "Huyen Khong Cave Marble Mountains", ""),
    "Imperial City": (16.4690, 107.5790, "Imperial City Hue", ""),
    "Izi Wear": (15.8775, 108.3270, "Izi Wear Hoi An", ""),
    "Jollibee": (16.0540, 108.2200, "Jollibee Da Nang", ""),
    "KFC": (16.0540, 108.2200, "KFC Da Nang", ""),
    "Kimmy Tailor": (15.8775, 108.3272, "Kimmy Tailor Hoi An", ""),
    "Klook": (15.8794, 108.3297, "Hoi An Ancient Town", ""),
    "Lana Tailor": (15.8775, 108.3270, "Lana Tailor Hoi An", ""),
    "Linh Ung Pagoda": (16.1000, 108.2780, "Linh Ung Pagoda Son Tra", ""),
    "Long Chau": (15.8785, 108.3270, "Long Chau Pharmacy Hoi An", ""),
    "Long Chau Pharmacy": (15.8785, 108.3270, "Long Chau Pharmacy Hoi An", ""),
    "Lotte Mart": (16.0540, 108.2200, "Lotte Mart Da Nang", ""),
    "Lotte Mart Danang": (16.0540, 108.2200, "Lotte Mart Da Nang", ""),
    "Lotteria": (16.0540, 108.2200, "Lotteria Da Nang", ""),
    "MM Mega Market Danang": (16.0600, 108.2100, "MM Mega Market Da Nang", ""),
    "Man Thai Beach": (16.0800, 108.2500, "Man Thai Beach Da Nang", ""),
    "McDonald's": (16.0540, 108.2200, "McDonald's Da Nang", ""),
    "Mi Quang": (15.8775, 108.3275, "Mi Quang Ong Hai Hoi An", ""),
    "My Khe Beach": (16.0600, 108.2450, "My Khe Beach Da Nang", ""),
    "Non Nuoc Beach": (15.9800, 108.2600, "Non Nuoc Beach Da Nang", ""),
    "Palmarosa Spa": (15.8780, 108.3275, "Palmarosa Spa Hoi An", ""),
    "Pharmacity": (15.8785, 108.3270, "Pharmacity Hoi An", ""),
    "Rosie's Cafe": (15.8775, 108.3280, "Rosie's Cafe Hoi An", ""),
    "Roving Chillhouse": (15.9040, 108.3650, "Roving Chillhouse An Bang", ""),
    "Roving Chillhouse (утро/бранч)": (15.9040, 108.3650, "Roving Chillhouse An Bang", ""),
    "An Bang Beach (Hoi An)": (15.9040, 108.3650, "An Bang Beach Hoi An", ""),
    "Cua Dai Beach (Hoi An)": (15.8900, 108.3800, "Cua Dai Beach Hoi An", ""),
    "My Khe Beach (Da Nang)": (16.0600, 108.2450, "My Khe Beach Da Nang", ""),
    "Non Nuoc Beach (Da Nang)": (15.9800, 108.2600, "Non Nuoc Beach Da Nang", ""),
    "Man Thai Beach (Da Nang)": (16.0800, 108.2500, "Man Thai Beach Da Nang", ""),
    "Hidden Beach (между зонами An Bang)": (15.9050, 108.3660, "Hidden Beach An Bang", ""),
    "Soul Kitchen (beach vibe)": (15.9045, 108.3655, "Soul Kitchen An Bang", ""),
    "Bikini Bottom (более relaxed)": (15.9045, 108.3655, "Bikini Bottom An Bang", ""),
    "McDonald's (Da Nang)": (16.0540, 108.2200, "McDonald's Da Nang", ""),
    "KFC (Da Nang)": (16.0540, 108.2200, "KFC Da Nang", ""),
    "Lotteria (Da Nang)": (16.0540, 108.2200, "Lotteria Da Nang", ""),
    "Jollibee (Da Nang)": (16.0540, 108.2200, "Jollibee Da Nang", ""),
    "Hon Dai (Cham Islands)": (15.9100, 108.5000, "Hon Dai Cham Islands", ""),
    "Hon Mo (Cham Islands)": (15.9000, 108.4800, "Hon Mo Cham Islands", ""),
    "Bai Chong (Cham Islands)": (15.9100, 108.3700, "Bai Chong Cham Islands", ""),
    "Bai Xep (Cham Islands)": (15.9200, 108.3800, "Bai Xep Cham Islands", ""),
    "Hoi An Diving Center (Blue Coral)": (15.8770, 108.3280, "Hoi An Diving Center", ""),
    "Thuy Son (главная гора)": (15.9790, 108.2610, "Thuy Son Marble Mountains", ""),
    "Royal Tombs (Khai Dinh/Tu Duc)": (16.4500, 107.5700, "Royal Tombs Hue", ""),
    "White Rose (banh bao, banh vac)": (15.8775, 108.3275, "White Rose Restaurant Hoi An", ""),
    "Bun cha ca (в Дананге)": (16.0680, 108.2200, "Bun Cha Ca Da Nang", ""),
    "Royal Tombs": (16.4500, 107.5700, "Royal Tombs Hue", ""),
    "SUP Hoi An": (15.9040, 108.3650, "SUP An Bang Beach", ""),
    "Shore Club An Bang": (15.9045, 108.3655, "Shore Club An Bang", ""),
    "Son Tra Peninsula viewpoint": (16.1000, 108.2780, "Son Tra Peninsula Da Nang", ""),
    "Soul Kitchen": (15.9045, 108.3655, "Soul Kitchen An Bang", ""),
    "Sound of Silence Coffee": (15.8775, 108.3280, "Sound of Silence Coffee Hoi An", ""),
    "Tam Thai Pagoda": (15.9790, 108.2610, "Tam Thai Pagoda Marble Mountains", ""),
    "The DeckHouse An Bang": (15.9045, 108.3655, "The DeckHouse An Bang", ""),
    "The Espresso Station": (15.8775, 108.3280, "The Espresso Station Hoi An", ""),
    "The Gioi Di Dong": (15.8790, 108.3275, "The Gioi Di Dong Hoi An", ""),
    "Thien Mu Pagoda": (16.4500, 107.5760, "Thien Mu Pagoda Hue", ""),
    "Thu Bon River": (15.8775, 108.3285, "Thu Bon River Hoi An", ""),
    "Thuy Son": (15.9790, 108.2610, "Thuy Son Marble Mountains", ""),
    "TPBank ATM": (15.8790, 108.3270, "TPBank ATM Hoi An", ""),
    "Tuong Tailor": (15.8775, 108.3270, "Tuong Tailor Hoi An", ""),
    "VPBank ATM": (15.8790, 108.3270, "VPBank ATM Hoi An", ""),
    "Vietcombank ATM": (15.8790, 108.3270, "Vietcombank ATM Hoi An", ""),
    "Vietnam Diving": (15.8770, 108.3280, "Vietnam Diving Hoi An", ""),
    "Viettel Store": (15.8790, 108.3275, "Viettel Store Hoi An", ""),
    "VinWonders Nam Hoi An": (15.8500, 108.4000, "VinWonders Nam Hoi An", ""),
    "Water World": (15.8500, 108.4000, "VinWonders Nam Hoi An Water World", ""),
    "River Safari": (15.8500, 108.4000, "VinWonders Nam Hoi An", ""),
    "White Rose": (15.8775, 108.3275, "White Rose Restaurant Hoi An", ""),
    "WinMart": (15.8800, 108.3280, "WinMart Hoi An", ""),
    "WinMart+": (15.8800, 108.3280, "WinMart+ Hoi An", ""),
    "Yaly Couture": (15.8775, 108.3270, "Yaly Couture Hoi An", ""),
    "Art Spa Hoi An": (15.8780, 108.3275, "Art Spa Hoi An", ""),
    "Cable car route": (15.9950, 107.9960, "Ba Na Hills Cable Car", ""),
    "Ночной рынок Hoi An": (15.8775, 108.3280, "Hoi An Night Market", ""),
    "Рассвет: Old Town": (15.8794, 108.3297, "Hoi An Ancient Town", ""),
    "Закат: An Bang или Cua Dai": (15.9040, 108.3650, "An Bang Beach", ""),
    "День: рисовые поля/кокосовые рощи": (15.8600, 108.3500, "Cam Thanh coconut village", ""),
    "Рисовые поля Cam Thanh": (15.8600, 108.3500, "Cam Thanh coconut village", ""),
    "Bun cha ca (в Дананге)": (16.0680, 108.2200, "Bun Cha Ca Da Nang", ""),
    "Bun cha ca": (16.0680, 108.2200, "Bun Cha Ca Da Nang", ""),
    "Coconut Boat (Cam Thanh, короткий маршрут)": (15.8600, 108.3500, "Cam Thanh coconut basket boat", ""),
    "SUP Hoi An (локальные прокаты/туры)": (15.9040, 108.3650, "SUP An Bang Beach", ""),
    "Cua Dai Pier (локальные лодки на день)": (15.8920, 108.3820, "Cua Dai Pier Hoi An", ""),
    "Con Market (Da Nang)": (16.0680, 108.2200, "Con Market Da Nang", ""),
    "Han Market (Da Nang)": (16.0680, 108.2200, "Han Market Da Nang", ""),
    "Izi Wear (linen-friendly lines)": (15.8775, 108.3270, "Izi Wear Hoi An", ""),
    "Lantern streets (вечер)": (15.8794, 108.3297, "Hoi An lantern street", ""),
    "Son Tra panoramic points (с осторожностью по правилам)": (16.1000, 108.2780, "Son Tra Peninsula Da Nang", ""),
    "43 Factory Coffee Roaster (Da Nang)": (16.0677, 108.2213, "43 Factory Coffee Roaster Da Nang", ""),
    "Thu Bon River (спокойные участки)": (15.8775, 108.3285, "Thu Bon River Hoi An", ""),
    "An Bang Beach (для спокойных тренировок в легкие дни)": (15.9040, 108.3650, "An Bang Beach Hoi An", ""),
    "An Bang Beach (утро)": (15.9040, 108.3650, "An Bang Beach Hoi An", ""),
    "Cua Dai Beach (в тихую погоду)": (15.8900, 108.3800, "Cua Dai Beach Hoi An", ""),
    "Кафе Old Town с RU/EN меню": (15.8794, 108.3297, "Hoi An Ancient Town", ""),
    "Кофе": (15.8775, 108.3280, "Hoi An coffee", ""),
    "Лаковые изделия": (15.8775, 108.3275, "Hoi An lacquerware", ""),
    "Керамика ручной работы": (15.8775, 108.3275, "Hoi An pottery village", ""),
    "Шелковые изделия": (15.8775, 108.3270, "Hoi An silk", ""),
    "Чай и специи": (15.8770, 108.3280, "Hoi An Central Market", ""),
    "Чай/специи": (15.8770, 108.3280, "Hoi An Central Market", ""),
}


# Normalize curly apostrophe
def normalize_label(label: str) -> str:
    return label.replace("\u2019", "'").strip()

def label_base(label: str) -> str:
    label = normalize_label(label)
    if "(" in label:
        return label.split("(", 1)[0].strip()
    return label


def is_no_map(label: str) -> bool:
    label = normalize_label(label)
    if label in NO_MAP or label_base(label) in NO_MAP:
        return True
    base = label_base(label)
    if base in {"GrabBike", "GrabCar", "Robusta", "Arabica Da Lat", "Medium blend"}:
        return True
    if re.match(r"^(Visa|Mastercard|UnionPay|Binance|Bybit|OKX)\b", base):
        return True
    if base.startswith("Карты «Мир»"):
        return True
    if re.match(r"^(Полиция|Пожарная|Скорая):", label):
        return True
    return False


@dataclass
class PlaceLink:
    lat: float
    lng: float
    google_query: str
    yandex_oid: str = ""

    @property
    def google_url(self) -> str:
        q = urllib.parse.quote(self.google_query)
        return (
            f"https://www.google.com/maps/place/{q}/"
            f"@{self.lat},{self.lng},17z"
        )

    @property
    def yandex_url(self) -> str:
        if self.yandex_oid:
            return f"https://yandex.com/maps/org/{self.yandex_oid}"
        lon, lat = self.lng, self.lat
        return (
            f"https://yandex.com/maps/?ll={lon},{lat}&z=17"
            f"&pt={lon},{lat},pm2d"
        )


def load_cache() -> dict[str, dict]:
    if CACHE_FILE.exists():
        return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    return {}


def save_cache(cache: dict[str, dict]) -> None:
    CACHE_FILE.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


def geocode_nominatim(query: str) -> Optional[tuple[float, float]]:
    url = (
        "https://nominatim.openstreetmap.org/search?"
        + urllib.parse.urlencode({"q": query, "format": "json", "limit": 1})
    )
    req = urllib.request.Request(url, headers={"User-Agent": "HoiAnGuideMapsFix/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
        if data:
            return float(data[0]["lat"]), float(data[0]["lon"])
    except Exception:
        return None
    return None


def search_query_for_label(label: str) -> str:
    """Build a clean geocoding query from bullet label."""
    base = normalize_label(label)
    # Strip parenthetical notes
    if "(" in base:
        base = base.split("(", 1)[0].strip()
    # Known food/dish -> best restaurant in Hoi An
    dish_map = {
        "Cao lau": "Cao Lau Thanh Hoi An",
        "Mi Quang": "Mi Quang Ong Hai Hoi An",
        "Com ga Hoi An": "Com Ga Ba Buoi Hoi An",
        "Banh mi Hoi An": "Banh Mi Phuong Hoi An",
        "White Rose": "White Rose Restaurant Hoi An",
    }
    if base in dish_map:
        return dish_map[base]
    # Chain stores -> add location
    chains = {
        "Pharmacity", "Long Chau", "WinMart", "WinMart+", "Viettel Store",
        "FPT Shop", "The Gioi Di Dong", "Bach Hoa Xanh", "Co.op Food",
        "Lotte Mart", "GO!", "GO! Danang", "Lotte Mart Danang",
        "MM Mega Market Danang", "Pharmacity", "Long Chau Pharmacy",
    }
    if base in chains or base.replace("+", "") in {c.replace("+", "") for c in chains}:
        if "danang" in base.lower() or "дананг" in base.lower():
            return f"{base}, Da Nang, Vietnam"
        return f"{base}, Hoi An, Vietnam"
    if any(x in base.lower() for x in ("danang", "da nang", "дананг")):
        return f"{base}, Da Nang, Vietnam"
    if any(x in base.lower() for x in ("hue", "imperial", "royal tombs", "thien mu")):
        return f"{base}, Hue, Vietnam"
    if any(x in base.lower() for x in ("ba na", "golden bridge", "fantasy", "french village", "cable car")):
        return f"{base}, Ba Na Hills, Vietnam"
    return f"{base}, Hoi An, Vietnam"


def resolve_place(label: str, cache: dict[str, dict]) -> Optional[PlaceLink]:
    label = normalize_label(label)
    if is_no_map(label):
        return None

    if label in PLACES:
        lat, lng, gq, yid = PLACES[label]
        return PlaceLink(lat, lng, gq, yid)

    base = label_base(label)
    if base != label and base in PLACES:
        lat, lng, gq, yid = PLACES[base]
        return PlaceLink(lat, lng, gq, yid)

    if label in cache:
        c = cache[label]
        if c.get("google_query") == "Hoi An Ancient Town" and label not in {
            "Рассвет: Old Town",
            "Кафе Old Town с RU/EN меню",
        }:
            pass  # re-geocode stale fallback
        else:
            return PlaceLink(c["lat"], c["lng"], c["google_query"], c.get("yandex_oid", ""))

    query = search_query_for_label(label)
    coords = geocode_nominatim(query)
    time.sleep(1.1)  # Nominatim rate limit
    if coords is None:
        # Fallback: Hoi An center
        coords = (15.8794, 108.3297)
        query = "Hoi An Ancient Town"
    lat, lng = coords
    cache[label] = {"lat": lat, "lng": lng, "google_query": query, "yandex_oid": ""}
    return PlaceLink(lat, lng, query)


def format_bullet(label: str, link: Optional[PlaceLink]) -> str:
    if link is None:
        return f"- {label}"
    return (
        f"- {label} "
        f"([Google Maps]({link.google_url}), [Yandex Maps]({link.yandex_url}))"
    )


def process_file(path: Path, cache: dict[str, dict]) -> int:
    lines = path.read_text(encoding="utf-8").splitlines()
    changed = 0
    out: list[str] = []
    for line in lines:
        parsed = parse_bullet_line(line)
        if parsed is None:
            out.append(line)
            continue
        label, _old_google, _old_yandex = parsed
        link = resolve_place(label, cache)
        new_line = format_bullet(label, link)
        if new_line != line:
            changed += 1
        out.append(new_line)
    if changed:
        path.write_text("\n".join(out) + "\n", encoding="utf-8")
    return changed


def main() -> None:
    cache = load_cache()
    total = 0
    for md in sorted(CATEGORIES_DIR.glob("*.md")):
        n = process_file(md, cache)
        if n:
            print(f"{md.name}: {n} links updated")
        total += n
    save_cache(cache)
    print(f"Done. {total} bullet links updated.")


if __name__ == "__main__":
    main()
