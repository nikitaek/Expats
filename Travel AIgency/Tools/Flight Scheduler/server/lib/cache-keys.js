/** Cache scope: calendar date (YYYY-MM-DD) + arrival airport IATA */
export function scopeKey(date, arrIata) {
  return `${date}_${arrIata.toUpperCase()}`;
}

export function rawCacheFilename(date, arrIata) {
  return `${scopeKey(date, arrIata)}.json`;
}

export function normalizedFilename(date, arrIata) {
  return `${scopeKey(date, arrIata)}.json`;
}
