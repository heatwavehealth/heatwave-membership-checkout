// api/create-checkout-session.js

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Parse body safely
    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : (req.body || {});

    const { plan, billing, service_state } = body;

    // Minimal validation (keep it forgiving for now)
    if (!plan || !billing) {
      return res.status(400).json({ error: 'Missing plan or billing.' });
    }

    // OPTIONAL state gate (does not break checkout if frontend isn’t sending it yet)
    const allowedStates = ['WA', 'OR'];
    if (service_state && !allowedStates.includes(String(service_state).toUpperCase())) {
      return res.status(400).json({ error: 'Heat Wave Health currently provides care only in WA and OR.' });
    }

    // Price IDs (base plans ONLY — add-ons disabled for now)
    const PRICE_MAP = {
      essence_monthly: process.env.PRICE_ESSENCE_MONTHLY,
      essence_annual: process.env.PRICE_ESSENCE_ANNUAL,
      radiance_monthly: process.env.PRICE_RADIANCE_MONTHLY,
      radiance_annual: process.env.PRICE_RADIANCE_ANNUAL,
    };

    for (const [k, v] of Object.entries(PRICE_MAP)) {
      if (!v) {
        throw new Error(`Missing env var for ${k}. Check Vercel Environment Variables.`);
      }
    }

    // Build line items
    const key = `${plan}_${billing}`; // e.g. essence_monthly
    const priceId = PRICE_MAP[key];

    if (!priceId) {
      return res.status(400).json({ error: `Invalid plan/billing combo: ${key}` });
    }

    const line_items = [{ price: priceId, quantity: 1 }];

    // Build origin dynamically (kills FRONTEND_URL confusion)
    const proto = (req.headers['x-forwarded-proto'] || 'https');
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const origin = host ? `${proto}://${host}` : 'http://localhost:3000';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items,
      billing_address_collection: 'required',
      allow_promotion_codes: true,

      // Helpful metadata for Make / internal ops
      metadata: {
        plan: String(plan),
        billing: String(billing),
        service_state: service_state ? String(service_state).toUpperCase() : '',
      },

      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cancel.html`,
    });

    return res.status(200).json({ id: session.id });

  } catch (err) {
    console.error('Error in create-checkout-session:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};
