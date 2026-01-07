// api/create-checkout-session.js

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-07-30.basil',
});

// This is the backend function Vercel runs for /api/create-checkout-session
// It expects JSON like:
// { "plan": "essence"|"radiance", "billing": "monthly"|"annual", "addons": ["nutrition","metabolic","sexual","skinhair"] }

module.exports = async (req, res) => {
  try {
    // Only allow POST
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // Handle body whether it's already parsed or still a string
    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : (req.body || {});

    const { plan, billing, addons, service_state } = body;
    // WA/OR eligibility enforcement (server-side)
const allowedStates = ['WA', 'OR'];

if (!allowedStates.includes(service_state)) {
  return res.status(400).json({ error: 'Heat Wave Health currently provides care only in WA and OR.' });
}

    // Human-readable labels for metadata + emails
const planLabel =
  plan === 'essence' ? 'Essence' :
  plan === 'radiance' ? 'Radiance' :
  'Unknown';

const billingLabel =
  billing === 'monthly' ? 'Monthly' :
  billing === 'annual' ? 'Annual' :
  'Unknown';

    // ====== EDIT THIS BLOCK WITH YOUR REAL STRIPE PRICE IDS ======
 const PRICE_MAP = {
  essence_monthly: process.env.PRICE_ESSENCE_MONTHLY,
  essence_annual: process.env.PRICE_ESSENCE_ANNUAL,
  radiance_monthly: process.env.PRICE_RADIANCE_MONTHLY,
  radiance_annual: process.env.PRICE_RADIANCE_ANNUAL,
  addon_nutrition: process.env.PRICE_ADDON_NUTRITION,
  addon_metabolic: process.env.PRICE_ADDON_METABOLIC,
  addon_sexual: process.env.PRICE_ADDON_SEXUAL,
  addon_skinhair: process.env.PRICE_ADDON_SKINHAIR,
};
    const PRICE_IDS = PRICE_MAP;
    for (const [k, v] of Object.entries(PRICE_MAP)) {
  if (!v) {
    throw new Error(`Missing env var for PRICE_MAP.${k}. Check Vercel env vars.`);
  }
}
    // ====== STOP EDITING HERE – REST OF FILE STAYS AS-IS ======

    const line_items = [];

    // Base membership
    if (plan === 'essence') {
      if (billing === 'monthly') {
        line_items.push({ price: PRICE_IDS.essence_monthly, quantity: 1 });
      } else if (billing === 'annual') {
        line_items.push({ price: PRICE_IDS.essence_annual, quantity: 1 });
      } else {
        throw new Error('Invalid billing option for Essence');
      }
    } else if (plan === 'radiance') {
      if (billing === 'monthly') {
        line_items.push({ price: PRICE_IDS.radiance_monthly, quantity: 1 });
      } else if (billing === 'annual') {
        line_items.push({ price: PRICE_IDS.radiance_annual, quantity: 1 });
      } else {
        throw new Error('Invalid billing option for Radiance');
      }
    } else {
      throw new Error('Invalid plan selected');
    }

    // Add-ons
    const selectedAddons = Array.isArray(addons) ? addons : [];

    if (selectedAddons.includes('nutrition')) {
      line_items.push({ price: PRICE_IDS.addon_nutrition, quantity: 1 });
    }
    if (selectedAddons.includes('metabolic')) {
      line_items.push({ price: PRICE_IDS.addon_metabolic, quantity: 1 });
    }
    if (selectedAddons.includes('sexual')) {
      line_items.push({ price: PRICE_IDS.addon_sexual, quantity: 1 });
    }
    if (selectedAddons.includes('skinhair')) {
      line_items.push({ price: PRICE_IDS.addon_skinhair, quantity: 1 });
    }

    if (line_items.length === 0) {
      throw new Error('No line items created');
    }

    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

  const session = await stripe.checkout.sessions.create({
  mode: 'subscription',

  // Allows annual base + monthly add-ons (flexible billing)
subscription_data: {
  billing_mode: { type: 'flexible' },
  metadata: {
    plan: String(plan || ''),
    billing: (billing === 'monthly') ? 'Monthly' : 'Annual',
    addons: (selectedAddons && selectedAddons.length) ? selectedAddons.join(', ') : 'None',
    service_state: String(service_state || ''),
    state_attestation: 'true'
  }
},

  line_items,

  success_url: `${FRONTEND_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `${FRONTEND_URL}/cancel.html`,

  billing_address_collection: 'required',
  allow_promotion_codes: true
});
    res.status(200).json({ id: session.id });

  // 👇 HUMAN-READABLE METADATA FOR MAKE
metadata: {
  plan: plan === 'essence' ? 'Essence' : 'Radiance',
  billing: billing === 'monthly' ? 'Monthly' : 'Annual',
  addons: selectedAddons.length ? selectedAddons.join(', ') : 'None', 
  service_state: service_state,
}
});

    res.status(200).json({ id: session.id });
  } catch (err) {
    console.error('Error in create-checkout-session:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
};
