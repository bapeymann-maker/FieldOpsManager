const targets = ['1309550', '5464383'] // both planters
const results: any[] = []

for (const id of targets) {
  const m = allMachines.find((m: any) => m.id === id)
  const platformId = m?.principalId || id
  const res = await fetch(
    `${JD_BASE}/machines/${platformId}/deviceStateReports?itemLimit=5`,
    { headers }
  )
  const data = await res.json()
  results.push({ id, name: m?.name, status: res.status, sample: data.values?.[0] })
}
return NextResponse.json({ results })