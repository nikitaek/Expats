CREATE TABLE flights (
  id TEXT PRIMARY KEY,
  fr24_id TEXT,
  flight_number TEXT NOT NULL,
  airline_iata TEXT,
  route TEXT NOT NULL,
  origin_iata TEXT NOT NULL,
  destination_iata TEXT NOT NULL,
  flight_date TEXT NOT NULL,
  data_kind TEXT NOT NULL DEFAULT 'actual',
  scheduled_departure_at TEXT,
  actual_departure_at TEXT,
  scheduled_arrival_at TEXT,
  actual_arrival_at TEXT,
  aircraft_code TEXT,
  aircraft_registration TEXT,
  pax_est INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_flights_date_dest
  ON flights (flight_date, destination_iata);

CREATE INDEX idx_flights_route_date
  ON flights (route, flight_date);

CREATE INDEX idx_flights_origin_date
  ON flights (origin_iata, flight_date);

CREATE INDEX idx_flights_data_kind_date
  ON flights (data_kind, flight_date);

CREATE UNIQUE INDEX idx_flights_dedupe
  ON flights (
    flight_number,
    origin_iata,
    destination_iata,
    data_kind,
    COALESCE(actual_departure_at, scheduled_departure_at, flight_date)
  );
