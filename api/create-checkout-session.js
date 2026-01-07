// api/create-checkout-session.js

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY, {
  // Keep apiVersion optional unless you intentionally pinned it elsewhere.
  // apiVersion: '2025-07-30.basil',
});

module.exports = async (req, res) => {
  try {
    // Only allow POST
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Parse body safely (Vercel may give string or object)
    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : (req.body || {});

    const { plan, billing, service_state } = body;

    // --- 1) HARD GATE: WA / OR only ---
    const allowedStates = ['WA', 'OR'];
    if (!service_state || !allowedStates.includes(String(service_state).toUpperCase())) {
      return res.status(400).json({
        error: 'Heat Wave Health currently provides care only in WA and OR.'
      });
    }

    // --- 2) Validate plan/billing ---
    const validPlans = ['essence', 'radiance'];
    const validBilling = ['monthly', 'annual'];

    if (!validPlans.includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan selected.' });
    }
    if (!validBilling.includes(billing)) {
      return res.status(400).json({ error: 'Invalid billing option selected.' });
    }

    // --- 3) Price IDs from env ---
    const PRICE_MAP = {
      essence_monthly: process.env.PRICE_ESSENCE_MONTHLY,
      essence_annual: process.env.PRICE_ESSENCE_ANNUAL,
      radiance_monthly: process.env.PRICE_RADIANCE_MONTHLY,
      radiance_annual: process.env.PRICE_RADIANCE_ANNUAL,
    };

    for (const [k, v] of Object.entries(PRICE_MAP)) {
      if (!v) throw new Error(`Missing env var for ${k}. Check Vercel Environment Variables.`);
    }

    const priceKey = `${plan}_${billing}`;
    const priceId = PRICE_MAP[priceKey];
    if (!priceId) {
      return res.status(400).json({ error: 'Pricing configuration error.' });
    }

    // --- 4) Build success/cancel URLs (no FRONTEND_URL guessing) ---
    // Prefer Vercel-provided headers so preview + prod both work correctly.
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl = (proto && host) ? `${proto}://${host}` : (process.env.FRONTEND_URL || 'http://localhost:3000');

    // --- 5) Create Checkout Session (BASE MEMBERSHIP ONLY) ---
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],

      success_url: `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/cancel.html`,

      billing_address_collection: 'required',
      allow_promotion_codes: true,

      // Helpful for Make/email alerts later (safe + simple)
      metadata: {
        plan,
        billing,
        service_state: String(service_state).toUpperCase(),
        addons: 'disabled', // makes it obvious during debugging
      },
    });

    return res.status(200).json({ id: session.id });
  } catch (err) {
    console.error('Error in create-checkout-session:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};
