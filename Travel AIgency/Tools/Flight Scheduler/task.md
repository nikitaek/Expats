Build a Flight Scheduler module for Vietnam inbound flights.

Requirements:
1. Create a local JSON seed file for the 15 largest Vietnamese airports with fields:
   `city`, `airportName`, `iata`, `icao`, `priority`
   Priority should reflect popularity among Russian tourists.

2. Create a local JSON seed file for Russian-speaking origin countries. Use this list later to filter flights by departure country.

3. Add API integration for Aviation Edge schedules:
   https://aviation-edge.com/developers/
   Load incoming flights for selected Vietnamese airports. Use the appropriate endpoint by date:
   - **Today:** [Real-time Flight Schedules API](https://aviation-edge.com/developers/) (`/v2/public/timetable`, `type=arrival`)
   - **Past dates:** [Historical Schedules API](https://aviation-edge.com/historical-flight-schedules-api/) (`/v2/public/flightsHistory`)
   - **Future dates:** [Future Schedules API](https://aviation-edge.com/future-flight-schedules-and-timetables-of-airports-api/) (`/v2/public/flightsFuture`)

4. Before calling the API, check whether raw cached data already exists locally for the same query scope:
   `date` + `incoming airport`
   If cached raw data exists, use it and skip the API call.
   If not, allow manual loading from the UI and save the raw response.

5. From the loaded schedule data, display only flights whose origin country is in the Russian-speaking countries list.

6. Store normalized flight records in a local JSON file with short field names, only for flights that are comming from russian speaking countries:
   `date`
   `eta`
   `fromCountry`
   `fromCity`
   `fromAirport`
   `toCity`
   `toAirport`
   `airline`
   `flightNo`
   `aircraft`
   `paxEst`

7. Build a dashboard/calendar UI that supports:
   - selecting date
   - selecting incoming city / airport
   - showing total incoming flights
   - showing filtered flight list
   - showing estimated incoming tourists total
   - showing a “Load from API” button only when data for that selection is missing locally

Implementation notes:
- Keep raw API responses and normalized data separate.
- Design the code so airport seeds, country seeds, caching, normalization, and UI are modular.
- Passenger count is not provided by the API, fill `paxEst` from aircraft type with a simple mapping table.
- Resolve departure country via Aviation Edge [Airport Database API](https://aviation-edge.com/developers/) (`/v2/public/airportDatabase`), with local cache per IATA.
