/**
 * Demo data seeder for The Living Canvas PMS — drives the REAL API exactly
 * as the UI would (login → create through public endpoints), so every
 * validation / authz / transaction / audit rule applies and the data is
 * self-consistent. This is a throwaway ops helper, NOT application code.
 *
 * Run: node scripts/demo-seed.mjs
 * Assumes backend on :4000 and the Grand Palace owner account exists.
 */

const API = process.env.API_URL ?? 'http://localhost:4000';
const EMAIL = process.env.SEED_EMAIL ?? 'owner@grandpalace.com';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Password123';

let token = null;

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg = json?.error?.message ?? json?.raw ?? res.statusText;
    throw new Error(`${method} ${path} → ${res.status}: ${msg}`);
  }
  return json;
}

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (base, n) => {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
};
const rupees = (r) => r * 100; // → paise

async function main() {
  console.log(`\n▶ Seeding demo data into ${API}\n`);

  // 1. Auth
  const auth = await call('POST', '/api/v1/auth/login', { email: EMAIL, password: PASSWORD });
  token = auth.accessToken;
  console.log('✓ Logged in as', EMAIL);

  // 2. Property
  const propResp = await call('POST', '/api/v1/properties', {
    name: 'Grand Palace — Mumbai',
    slug: `grand-palace-mumbai-${Date.now().toString(36)}`,
    timezone: 'Asia/Kolkata',
    addressLine1: 'Marine Drive',
    city: 'Mumbai',
    region: 'Maharashtra',
    postalCode: '400020',
    country: 'India',
  });
  const property = propResp.property ?? propResp;
  const pid = property.id;
  console.log('✓ Property:', property.name, `(${pid})`);
  const P = (p) => `/api/v1/properties/${pid}${p}`;

  // 3. Room types
  const roomTypeDefs = [
    { name: 'Standard Queen', code: 'STDQ', description: 'Cozy queen room with city view.', rate: 4500 },
    { name: 'Deluxe King', code: 'DLXK', description: 'Spacious king room with sea view.', rate: 7500 },
    { name: 'Executive Suite', code: 'EXEC', description: 'Separate living area, premium amenities.', rate: 14000 },
    { name: 'Presidential Suite', code: 'PRES', description: 'Top-floor suite, butler service.', rate: 32000 },
  ];
  const roomTypes = [];
  for (const rt of roomTypeDefs) {
    const r = await call('POST', P('/room-types'), { name: rt.name, code: rt.code, description: rt.description });
    roomTypes.push({ ...(r.roomType ?? r), rate: rt.rate });
  }
  console.log(`✓ ${roomTypes.length} room types`);

  // 4. Rate plans (one per type) + nightly rates for the next 60 nights
  const today = new Date(`${iso(new Date())}T00:00:00.000Z`);
  const ratePlans = [];
  for (const rt of roomTypes) {
    const rp = await call('POST', P(`/room-types/${rt.id}/rate-plans`), {
      name: 'Best Available Rate',
      code: 'BAR',
      description: 'Flexible, refundable rate.',
      isRefundable: true,
    });
    const ratePlan = rp.ratePlan ?? rp;
    // set 60 nights of rates (small weekend uplift for realism)
    const rates = [];
    for (let i = -5; i < 60; i++) {
      const d = addDays(today, i);
      const dow = d.getUTCDay();
      const weekend = dow === 5 || dow === 6;
      rates.push({ date: iso(d), amountMinor: rupees(Math.round((rt.rate * (weekend ? 1.15 : 1)) / 100) * 100) });
    }
    await call('PUT', P(`/room-types/${rt.id}/rate-plans/${ratePlan.id}/rates`), { rates });
    ratePlans.push({ ...ratePlan, roomTypeId: rt.id });
  }
  console.log(`✓ ${ratePlans.length} rate plans, 65 nights of rates each`);

  // 5. Rooms — a few floors per type
  const roomCounts = { STDQ: 12, DLXK: 8, EXEC: 4, PRES: 2 };
  const roomsByType = {};
  let roomTotal = 0;
  for (const rt of roomTypes) {
    const count = roomCounts[rt.code] ?? 4;
    roomsByType[rt.id] = [];
    for (let i = 1; i <= count; i++) {
      const floor = String(Math.ceil(i / 4) + (rt.code === 'PRES' ? 20 : rt.code === 'EXEC' ? 15 : 1));
      const num = `${floor}${String(i).padStart(2, '0')}`;
      const r = await call('POST', P('/rooms'), {
        name: `${rt.code}-${num}`,
        roomTypeId: rt.id,
        floor,
        capacity: rt.code === 'PRES' ? 4 : rt.code === 'EXEC' ? 3 : 2,
      });
      roomsByType[rt.id].push(r.room ?? r);
      roomTotal++;
    }
  }
  console.log(`✓ ${roomTotal} rooms`);

  // 6. Guests (with segmentation tags)
  const guestDefs = [
    { firstName: 'Aarav', lastName: 'Sharma', email: 'aarav.sharma@example.com', phone: '+91 98200 11111', tags: ['VIP', 'REPEAT'] },
    { firstName: 'Priya', lastName: 'Menon', email: 'priya.menon@example.com', phone: '+91 98200 22222', tags: ['CORPORATE'] },
    { firstName: 'Rohan', lastName: 'Gupta', email: 'rohan.gupta@example.com', phone: '+91 98200 33333', tags: ['REPEAT'] },
    { firstName: 'Sara', lastName: 'Khan', email: 'sara.khan@example.com', phone: '+91 98200 44444', tags: ['HONEYMOON'] },
    { firstName: 'Vikram', lastName: 'Reddy', email: 'vikram.reddy@example.com', phone: '+91 98200 55555', tags: ['VIP', 'CORPORATE'] },
    { firstName: 'Neha', lastName: 'Joshi', email: 'neha.joshi@example.com', phone: '+91 98200 66666', tags: [] },
    { firstName: 'Arjun', lastName: 'Nair', email: 'arjun.nair@example.com', phone: '+91 98200 77777', tags: ['LOYALTY'] },
    { firstName: 'Isha', lastName: 'Patel', email: 'isha.patel@example.com', phone: '+91 98200 88888', tags: ['CORPORATE'] },
  ];
  const guests = [];
  for (const g of guestDefs) {
    const created = await call('POST', '/api/v1/guests', {
      firstName: g.firstName,
      lastName: g.lastName,
      email: g.email,
      phone: g.phone,
    });
    const guest = created.guest ?? created;
    if (g.tags.length) {
      await call('PUT', `/api/v1/guests/${guest.id}/tags`, { tags: g.tags });
    }
    guests.push(guest);
  }
  console.log(`✓ ${guests.length} guests (tagged)`);

  // 7. Reservations — mix of arrivals today, in-house, upcoming, past
  //    Each booking needs an available room type + rate plan + dates.
  const rpByType = Object.fromEntries(ratePlans.map((rp) => [rp.roomTypeId, rp.id]));
  const plan = [
    { g: 0, rt: 1, ci: 0, nights: 3, action: 'checkin' }, // arrival today → in-house
    { g: 1, rt: 0, ci: -2, nights: 4, action: 'checkin' }, // already in-house
    { g: 2, rt: 2, ci: -1, nights: 2, action: 'checkin' }, // in-house, departs tomorrow
    { g: 3, rt: 1, ci: 0, nights: 5, action: 'assign' }, // arrival today, not yet checked in
    { g: 4, rt: 3, ci: 2, nights: 3, action: 'none' }, // upcoming
    { g: 5, rt: 0, ci: 1, nights: 2, action: 'none' }, // upcoming
    { g: 6, rt: 0, ci: -5, nights: 3, action: 'checkout' }, // completed stay
    { g: 7, rt: 2, ci: 5, nights: 4, action: 'none' }, // future
  ];
  let inHouse = 0;
  let resCount = 0;
  const roomCharge = []; // {reservationId, roomTypeIdx}
  for (const b of plan) {
    const rt = roomTypes[b.rt];
    const body = {
      guestId: guests[b.g].id,
      roomTypeId: rt.id,
      ratePlanId: rpByType[rt.id],
      checkIn: iso(addDays(today, b.ci)),
      checkOut: iso(addDays(today, b.ci + b.nights)),
      adults: 2,
    };
    let created;
    try {
      created = await call('POST', P('/reservations'), body);
    } catch (e) {
      console.warn('  ! reservation skipped:', e.message);
      continue;
    }
    const reservation = created.reservation ?? created;
    resCount++;

    // pick a free room of the type
    const freeRoom = roomsByType[rt.id][resCount % roomsByType[rt.id].length];
    try {
      if (b.action === 'assign') {
        await call('POST', P(`/reservations/${reservation.id}/assign-room`), { roomId: freeRoom.id });
      } else if (b.action === 'checkin') {
        await call('POST', P(`/reservations/${reservation.id}/check-in`), { roomId: freeRoom.id });
        inHouse++;
        roomCharge.push({ reservationId: reservation.id, rt: b.rt });
      } else if (b.action === 'checkout') {
        await call('POST', P(`/reservations/${reservation.id}/check-in`), { roomId: freeRoom.id });
        await call('POST', P(`/reservations/${reservation.id}/check-out`), {});
      }
    } catch (e) {
      console.warn(`  ! ${b.action} skipped for res ${reservation.id}:`, e.message);
    }
  }
  console.log(`✓ ${resCount} reservations (${inHouse} in-house)`);

  // 8. POS — outlets, products, and some orders (direct + room-charge)
  const outletDefs = [
    {
      name: 'The Terrace Restaurant',
      type: 'RESTAURANT',
      products: [
        { name: 'Butter Chicken', category: 'Mains', price: 650 },
        { name: 'Paneer Tikka', category: 'Starters', price: 480 },
        { name: 'Garlic Naan', category: 'Breads', price: 90 },
        { name: 'Gulab Jamun', category: 'Desserts', price: 220 },
      ],
    },
    {
      name: 'Skyline Bar',
      type: 'BAR',
      products: [
        { name: 'Old Fashioned', category: 'Cocktails', price: 750 },
        { name: 'House Red (glass)', category: 'Wine', price: 550 },
        { name: 'Craft Lager', category: 'Beer', price: 400, trackStock: true, stockQty: 120 },
      ],
    },
    {
      name: 'Serenity Spa',
      type: 'SPA',
      products: [
        { name: 'Swedish Massage (60m)', category: 'Massage', price: 3500 },
        { name: 'Aromatherapy Facial', category: 'Facial', price: 2800 },
      ],
    },
  ];
  const outlets = [];
  for (const o of outletDefs) {
    const oc = await call('POST', P('/pos/outlets'), { name: o.name, type: o.type });
    const outlet = oc.outlet ?? oc;
    const products = [];
    for (const p of o.products) {
      const pc = await call('POST', P(`/pos/outlets/${outlet.id}/products`), {
        name: p.name,
        category: p.category,
        priceMinor: rupees(p.price),
        ...(p.trackStock ? { trackStock: true, stockQty: p.stockQty } : {}),
      });
      products.push(pc.product ?? pc);
    }
    outlets.push({ ...outlet, products });
  }
  console.log(`✓ ${outlets.length} POS outlets with products`);

  // A few direct-paid orders
  let orderCount = 0;
  const methods = ['CASH', 'CARD', 'UPI'];
  for (let i = 0; i < 5; i++) {
    const outlet = outlets[i % outlets.length];
    const items = [
      { productId: outlet.products[0].id, quantity: 1 + (i % 3) },
      { productId: outlet.products[1 % outlet.products.length].id, quantity: 1 + (i % 2) },
    ];
    try {
      await call('POST', P('/pos/orders'), {
        outletId: outlet.id,
        items,
        settlement: 'DIRECT',
        paymentMethod: methods[i % methods.length],
      });
      orderCount++;
    } catch (e) {
      console.warn('  ! direct order skipped:', e.message);
    }
  }
  // Room-charge orders for in-house guests
  for (const rc of roomCharge.slice(0, 2)) {
    const outlet = outlets[0];
    try {
      await call('POST', P('/pos/orders'), {
        outletId: outlet.id,
        items: [{ productId: outlet.products[0].id, quantity: 2 }, { productId: outlet.products[2].id, quantity: 2 }],
        settlement: 'ROOM_CHARGE',
        reservationId: rc.reservationId,
      });
      orderCount++;
    } catch (e) {
      console.warn('  ! room-charge order skipped:', e.message);
    }
  }
  console.log(`✓ ${orderCount} POS orders`);

  // 9. Folio payments — collect a deposit on a couple of in-house stays
  for (const rc of roomCharge.slice(0, 2)) {
    try {
      await call('POST', P(`/reservations/${rc.reservationId}/folio/payments`), {
        method: 'CARD',
        amountMinor: rupees(5000),
        reference: 'Deposit',
      });
    } catch (e) {
      console.warn('  ! folio payment skipped:', e.message);
    }
  }
  console.log('✓ Folio deposits recorded');

  console.log('\n✅ Demo seed complete.\n');
  console.log(`   Property : ${property.name}`);
  console.log(`   Login    : ${EMAIL} / ${PASSWORD}`);
  console.log(`   Open     : http://localhost:5173\n`);
}

main().catch((e) => {
  console.error('\n✗ Seed failed:', e.message, '\n');
  process.exitCode = 1;
});
