// api/create-checkout-session.js

const Stripe = require('stripe');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// This is the backend function Vercel runs for /api/create-checkout-session
// It expects JSON like:
// { "plan": "essence"|"radiance", "billing": "monthly"|"annual", "service_state": "WA"|"OR" }

module.exports = async (req, res) => {
  try {
    // Only allow POST
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Parse body (Vercel sometimes gives a string, sometimes an object)
    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : (req.body || {});

    const { plan, billing, service_state } = body;

    // ---- Basic validation ----
    if (!plan || !billing) {
      return res.status(400).json({ error: 'Missing plan or billing.' });
    }

    // ---- WA/OR eligibility enforcement (server-side) ----
    const allowedStates = ['WA', 'OR'];
    if (!service_state || !allowedStates.includes(String(service_state).toUpperCase())) {
      return res.status(400).json({
        error: 'Heat Wave Health currently provides care only in WA and OR.'
      });
    }

    // ---- Price IDs from env vars ----
    // Required:
    // PRICE_ESSENCE_MONTHLY, PRICE_ESSENCE_ANNUAL,
    // PRICE_RADIANCE_MONTHLY, PRICE_RADIANCE_ANNUAL
    const PRICE = {
      essence_monthly: process.env.PRICE_ESSENCE_MONTHLY,
      essence_annual: process.env.PRICE_ESSENCE_ANNUAL,
      radiance_monthly: process.env.PRICE_RADIANCE_MONTHLY,
      radiance_annual: process.env.PRICE_RADIANCE_ANNUAL,
    };

    // Ensure required env vars exist (fail fast with a clear message)
    for (const [k, v] of Object.entries(PRICE)) {
      if (!v) {
        throw new Error(`Missing env var: PRICE_${k.toUpperCase()}`);
      }
    }

    // ---- Choose the correct price based on plan + billing ----
    const planKey = String(plan).toLowerCase();
    const billingKey = String(billing).toLowerCase();

    let selectedPriceId = null;

    if (planKey === 'essence') {
      if (billingKey === 'monthly') selectedPriceId = PRICE.essence_monthly;
      else if (billingKey === 'annual') selectedPriceId = PRICE.essence_annual;
    } else if (planKey === 'radiance') {
      if (billingKey === 'monthly') selectedPriceId = PRICE.radiance_monthly;
      else if (billingKey === 'annual') selectedPriceId = PRICE.radiance_annual;
    }

    if (!selectedPriceId) {
      return res.status(400).json({ error: 'Invalid plan or billing option.' });
    }

    // ---- FRONTEND_URL ----
    // Must be set in Vercel env vars for each environment you test (Preview/Production),
    // e.g. https://heatwave-membership-checkout.vercel.app
    const FRONTEND_URL = process.env.FRONTEND_URL;
    if (!FRONTEND_URL) {
      throw new Error('Missing env var: FRONTEND_URL');
    }

    // ---- Create Checkout Session (subscription) ----
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: selectedPriceId, quantity: 1 }],

      success_url: `${FRONTEND_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/cancel.html`,

      billing_address_collection: 'required',
      allow_promotion_codes: true,

      // Helpful for Make + internal alerts later
      metadata: {
        plan: planKey === 'essence' ? 'Essence' : 'Radiance',
        billing: billingKey === 'monthly' ? 'Monthly' : 'Annual',
        service_state: String(service_state).toUpperCase(),
        state_attestation: 'true',
      },
    });

    return res.status(200).json({ id: session.id });
  } catch (err) {
    console.error('Error in create-checkout-session:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};
