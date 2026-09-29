/**
 * Historical demo-data seeder for The Living Canvas PMS.
 *
 * Backfills ~120 days of realistic booking history onto the EXISTING first
 * property so the analytics charts (revenue / occupancy / ADR / RevPAR by
 * month) have real, self-consistent data to render. Drives the real API
 * exactly as the UI would, so every validation / authz / transaction / audit
 * rule applies. Throwaway ops helper, NOT application code.
 *
 * Run: node scripts/demo-history-seed.mjs
 */

const API = process.env.API_URL ?? 'http://localhost:4000';
const EMAIL = process.env.SEED_EMAIL ?? 'owner@grandpalace.com';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Password123';
const DAYS_BACK = Number(process.env.DAYS_BACK ?? 120);
const DAYS_FWD = 21;

let token = null;

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.error?.message ?? json?.raw ?? res.statusText;
    const err = new Error(`${method} ${path} → ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (base, n) => { const d = new Date(base); d.setUTCDate(d.getUTCDate() + n); return d; };
const rupees = (r) => r * 100;
const pick = (arr, i) => arr[i % arr.length];
// seeded pseudo-random for reproducibility
let _s = 1337;
const rand = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; };

// base nightly rate by room-type code (rupees)
const BASE_RATE = { STDQ: 4500, DLXK: 7500, EXEC: 14000, PRES: 32000 };
// seasonality multiplier by calendar month (0=Jan): winter high season in India
const MONTH_MULT = [1.15, 1.1, 1.0, 0.9, 0.82, 0.8, 0.85, 0.9, 0.95, 1.05, 1.2, 1.3];

async function main() {
  console.log(`\n▶ Backfilling ${DAYS_BACK} days of history into ${API}\n`);

  const auth = await call('POST', '/api/v1/auth/login', { email: EMAIL, password: PASSWORD });
  token = auth.accessToken;
  console.log('✓ Logged in as', EMAIL);

  const props = await call('GET', '/api/v1/properties?pageSize=1');
  const property = (props.properties ?? [])[0];
  if (!property) throw new Error('No property found — run demo-seed.mjs first.');
  const pid = property.id;
  const P = (p) => `/api/v1/properties/${pid}${p}`;
  console.log('✓ Property:', property.name);

  // Room types + their rate plans + rooms
  const rtResp = await call('GET', P('/room-types?pageSize=50'));
  const roomTypes = rtResp.roomTypes ?? [];
  const roomsResp = await call('GET', P('/rooms?pageSize=100'));
  const allRooms = roomsResp.rooms ?? [];
  const roomsByType = {};
  for (const r of allRooms) {
    const rtId = r.roomType?.id ?? r.roomTypeId;
    (roomsByType[rtId] ??= []).push(r);
  }
  const types = [];
  for (const rt of roomTypes) {
    const rpResp = await call('GET', P(`/room-types/${rt.id}/rate-plans`));
    const rp = (rpResp.ratePlans ?? [])[0];
    if (!rp) { console.warn('  ! no rate plan for', rt.code); continue; }
    types.push({ ...rt, ratePlanId: rp.id, rooms: roomsByType[rt.id] ?? [] });
  }
  console.log(`✓ ${types.length} room types with rate plans; ${allRooms.length} rooms`);

  const today = new Date(`${iso(new Date())}T00:00:00.000Z`);
  const start = addDays(today, -DAYS_BACK);

  // 1) Set nightly rates across the whole window (past + future) with
  //    seasonality + weekend uplift, so every booking night is priced.
  for (const rt of types) {
    const base = BASE_RATE[rt.code] ?? 5000;
    const rates = [];
    for (let i = -DAYS_BACK; i < DAYS_FWD; i++) {
      const d = addDays(today, i);
      const dow = d.getUTCDay();
      const weekend = dow === 5 || dow === 6;
      const season = MONTH_MULT[d.getUTCMonth()];
      const amt = Math.round((base * season * (weekend ? 1.18 : 1)) / 100) * 100;
      rates.push({ date: iso(d), amountMinor: rupees(amt) });
    }
    // chunk to keep payloads reasonable
    for (let i = 0; i < rates.length; i += 60) {
      await call('PUT', P(`/room-types/${rt.id}/rate-plans/${rt.ratePlanId}/rates`), { rates: rates.slice(i, i + 60) });
    }
  }
  console.log(`✓ Nightly rates set for ${DAYS_BACK + DAYS_FWD} nights per type`);

  // 2) More guests for variety
  const extraGuests = [
    ['Kabir', 'Malhotra', 'CORPORATE'], ['Ananya', 'Iyer', 'REPEAT'], ['Devan', 'Rao', ''],
    ['Meera', 'Kapoor', 'HONEYMOON'], ['Yash', 'Agarwal', 'VIP'], ['Tara', 'Bose', 'LOYALTY'],
    ['Zoya', 'Ahmed', 'CORPORATE'], ['Nikhil', 'Verma', 'REPEAT'], ['Sana', 'Mirza', ''],
    ['Aditya', 'Chauhan', 'VIP'], ['Riya', 'Sen', ''], ['Kunal', 'Bhatt', 'CORPORATE'],
  ];
  const guestList = (await call('GET', '/api/v1/guests?pageSize=100')).guests ?? [];
  const guests = [...guestList];
  for (const [fn, ln, tag] of extraGuests) {
    try {
      const created = await call('POST', '/api/v1/guests', {
        firstName: fn, lastName: ln,
        email: `${fn.toLowerCase()}.${ln.toLowerCase()}@example.com`,
        phone: `+91 98${Math.floor(100000000 + rand() * 899999999)}`,
      });
      const g = created.guest ?? created;
      if (tag) await call('PUT', `/api/v1/guests/${g.id}/tags`, { tags: [tag] });
      guests.push(g);
    } catch (e) { if (e.status !== 409) console.warn('  ! guest skip:', e.message); }
  }
  console.log(`✓ ${guests.length} guests total`);

  // 3) Historical reservations with realistic occupancy.
  //    For each past day, start a number of bookings scaled by seasonality.
  //    Past+completed stays are checked in then out; recent ongoing left in-house.
  let created = 0, checkedOut = 0, inHouse = 0, failed = 0;
  const stayLenWeights = [1, 2, 2, 3, 3, 3, 4, 5]; // typical nights distribution

  for (let day = -DAYS_BACK; day < DAYS_FWD - 2; day++) {
    const ci = addDays(today, day);
    const season = MONTH_MULT[ci.getUTCMonth()];
    const dow = ci.getUTCDay();
    const weekendBoost = dow === 5 || dow === 6 ? 1.4 : 1;
    // arrivals per day, scaled to inventory (~26 rooms) and season
    const arrivals = Math.max(0, Math.round((2.2 * season * weekendBoost) + (rand() * 2 - 0.6)));

    for (let a = 0; a < arrivals; a++) {
      const rt = pick(types, Math.floor(rand() * types.length));
      if (!rt.rooms.length) continue;
      const nights = pick(stayLenWeights, Math.floor(rand() * stayLenWeights.length));
      const guest = pick(guests, Math.floor(rand() * guests.length));
      const body = {
        guestId: guest.id, roomTypeId: rt.id, ratePlanId: rt.ratePlanId,
        checkIn: iso(ci), checkOut: iso(addDays(ci, nights)), adults: 1 + Math.floor(rand() * 2),
      };
      let resv;
      try { resv = (await call('POST', P('/reservations'), body)).reservation; }
      catch (e) { failed++; continue; } // no room available / priced — skip silently
      created++;

      const room = pick(rt.rooms, created);
      const checkoutDay = day + nights;
      try {
        if (checkoutDay <= 0) {
          // fully in the past → check in then out (completed, realised revenue)
          await call('POST', P(`/reservations/${resv.id}/check-in`), { roomId: room.id });
          await call('POST', P(`/reservations/${resv.id}/check-out`), {});
          checkedOut++;
        } else if (day <= 0 && checkoutDay > 0) {
          // straddles today → currently in-house
          await call('POST', P(`/reservations/${resv.id}/check-in`), { roomId: room.id });
          inHouse++;
        }
        // future arrivals: leave as CONFIRMED
      } catch (e) {
        // room clash on check-in is fine; booking still counts for pipeline
      }
    }
  }
  console.log(`✓ ${created} reservations created (${checkedOut} completed, ${inHouse} in-house, ${failed} skipped for no-availability)`);

  console.log('\n✅ History backfill complete.\n');
  console.log(`   Property : ${property.name}`);
  console.log(`   Window   : ${iso(start)} → ${iso(addDays(today, DAYS_FWD))}`);
  console.log(`   Open     : http://localhost:5173\n`);
}

main().catch((e) => { console.error('\n✗ Seed failed:', e.message, '\n'); process.exitCode = 1; });
