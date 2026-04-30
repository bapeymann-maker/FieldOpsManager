const since = '2026-04-11T00:00:00Z'
const until = '2026-04-12T23:59:59Z'
const res = await fetch(
  `${JD_BASE}/machines/751937/deviceStateReports?startDate=${encodeURIComponent(since)}&endDate=${encodeURIComponent(until)}&itemLimit=100`,
  { headers }
)