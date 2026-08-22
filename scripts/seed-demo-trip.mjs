/**
 * Seeds one complete, realistic itinerary through the public API.
 *
 * Goes through HTTP rather than SQL on purpose: this exercises auth, the
 * hybrid search, the transactional stop writes and the cost engine exactly as
 * the browser does, so a green run here means the whole chain is connected.
 *
 *   node scripts/seed-demo-trip.mjs [baseUrl]
 */

const BASE = process.argv[2] ?? 'http://127.0.0.1:3000/api/v1'

/**
 * Cities are chosen from the seeded catalogue, not invented. It carries 61
 * cities, so "Seville" and "Granada" do not resolve — a plausible-looking
 * itinerary of cities that do not exist would fail at the first search.
 */
const ITINERARY = [
  { city: 'lisbon',    arrive: '2026-09-01', depart: '2026-09-06', mode: 'flight', travel: '210.00', lodging: '540.00' },
  { city: 'madrid',    arrive: '2026-09-06', depart: '2026-09-10', mode: 'train',  travel: '68.00',  lodging: '400.00' },
  { city: 'barcelona', arrive: '2026-09-10', depart: '2026-09-14', mode: 'train',  travel: '52.00',  lodging: '460.00' },
  { city: 'paris',     arrive: '2026-09-14', depart: '2026-09-18', mode: 'train',  travel: '119.00', lodging: '620.00' },
  { city: 'amsterdam', arrive: '2026-09-18', depart: '2026-09-21', mode: 'train',  travel: '87.00',  lodging: '450.00' },
]

let token = null

async function call(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token !== null) headers.Authorization = `Bearer ${token}`

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let parsed = null
  try {
    parsed = text === '' ? null : JSON.parse(text)
  } catch {
    parsed = null
  }
  if (!response.ok) {
    const detail = parsed?.detail ?? parsed?.title ?? text.slice(0, 200)
    throw new Error(`${method} ${path} → ${String(response.status)}: ${detail}`)
  }
  return parsed
}

const money = (value, currency) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)

const email = `demo${String(Date.now())}@globetrotter.test`
const password = 'correct-horse-battery-staple'

console.log('1. signup')
const session = await call('/auth/signup', {
  method: 'POST',
  body: { email, password, displayName: 'Hem Patel' },
})
token = session.data.accessToken
console.log(`   ${session.data.user.displayName} <${session.data.user.email}>`)

console.log('2. create trip')
const trip = (
  await call('/trips', {
    method: 'POST',
    body: {
      name: 'Lisbon to Amsterdam, three weeks',
      description: 'Five cities, overland the whole way, one budget.',
      startDate: '2026-09-01',
      endDate: '2026-09-21',
      baseCurrency: 'EUR',
      budgetCap: '3200.00',
    },
  })
).data
console.log(`   ${trip.name} — ${trip.startDate} to ${trip.endDate}, cap ${trip.budgetCap} ${trip.baseCurrency}`)

console.log('3. search + add stops')
for (const leg of ITINERARY) {
  const found = await call(`/search?q=${leg.city}&kind=city&limit=1`)
  const hit = found.data.hits[0]
  if (hit === undefined) throw new Error(`no city matched "${leg.city}"`)

  await call(`/trips/${trip.id}/stops`, {
    method: 'POST',
    body: {
      cityId: hit.id,
      arrivesAt: `${leg.arrive}T10:00:00Z`,
      departsAt: `${leg.depart}T10:00:00Z`,
      arrivalMode: leg.mode,
      arrivalCost: leg.travel,
      lodgingCost: leg.lodging,
    },
  })
  console.log(`   ${hit.name.padEnd(12)} ${leg.arrive} → ${leg.depart}  ${leg.mode}`)
}

console.log('4. verify the overlap constraint still bites')
const clash = ITINERARY[0]
const cityForClash = (await call(`/search?q=${clash.city}&kind=city&limit=1`)).data.hits[0]
try {
  await call(`/trips/${trip.id}/stops`, {
    method: 'POST',
    body: {
      cityId: cityForClash.id,
      arrivesAt: '2026-09-03T10:00:00Z',
      departsAt: '2026-09-08T10:00:00Z',
      arrivalMode: 'car',
      arrivalCost: '10.00',
      lodgingCost: '10.00',
    },
  })
  throw new Error('an overlapping stop was ACCEPTED — the constraint is not working')
} catch (error) {
  if (!/409/.test(error.message)) throw error
  console.log('   rejected with 409, as it must')
}

console.log('5. cost breakdown')
const cost = (await call(`/trips/${trip.id}/cost`)).data
console.log(`   total      ${money(cost.total, cost.currency)}`)
console.log(`   cap        ${money(cost.budgetCap, cost.currency)}`)
console.log(`   remaining  ${money(cost.remaining, cost.currency)}`)
console.log(`   per day    ${money(cost.perDayAverage, cost.currency)} over ${String(cost.totalDays)} days`)
console.log(`   category   ${Object.entries(cost.byCategory).map(([k, v]) => `${k} ${money(v, cost.currency)}`).join(' · ')}`)
console.log(`   route      ${cost.stops.map((s) => `${s.city} (${String(s.nights)}n)`).join(' → ')}`)
console.log(`   warnings   ${String(cost.warnings.length)}`)

console.log('\nSign in with:')
console.log(`  ${email}`)
console.log(`  ${password}`)
console.log(`  trip: ${trip.id}`)
