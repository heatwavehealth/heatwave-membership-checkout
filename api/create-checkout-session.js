// api/create-checkout-session.js

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-07-30.basil',
});

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : (req.body || {});

    const { plan, billing, addons, service_state } = body;

    // ===== WA/OR enforcement (server-side hard block) =====
    const allowedStates = ['WA', 'OR'];
    if (!allowedStates.includes(service_state)) {
      return res.status(400).json({
        error: 'Heat Wave Health currently provides care only in WA and OR.',
      });
    }

    // ===== Labels for metadata (human readable) =====
    const planLabel =
      plan === 'essence' ? 'Essence' :
      plan === 'radiance' ? 'Radiance' :
      'Unknown';

    const billingLabel =
      billing === 'monthly' ? 'Monthly' :
      billing === 'annual' ? 'Annual' :
      'Unknown';

    // ===== Price IDs from Vercel env vars =====
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

    for (const [k, v] of Object.entries(PRICE_MAP)) {
      if (!v) throw new Error(`Missing env var for PRICE_MAP.${k}. Check Vercel env vars.`);
    }

    // ===== Build line items =====
    const line_items = [];

    // Base plan (monthly OR annual)
    if (plan === 'essence') {
      if (billing === 'monthly') line_items.push({ price: PRICE_MAP.essence_monthly, quantity: 1 });
      else if (billing === 'annual') line_items.push({ price: PRICE_MAP.essence_annual, quantity: 1 });
      else throw new Error('Invalid billing option for Essence');
    } else if (plan === 'radiance') {
      if (billing === 'monthly') line_items.push({ price: PRICE_MAP.radiance_monthly, quantity: 1 });
      else if (billing === 'annual') line_items.push({ price: PRICE_MAP.radiance_annual, quantity: 1 });
      else throw new Error('Invalid billing option for Radiance');
    } else {
      throw new Error('Invalid plan selected');
    }

    // Add-ons (always monthly prices)
    const selectedAddons = Array.isArray(addons) ? addons : [];

    if (selectedAddons.includes('nutrition')) line_items.push({ price: PRICE_MAP.addon_nutrition, quantity: 1 });
    if (selectedAddons.includes('metabolic')) line_items.push({ price: PRICE_MAP.addon_metabolic, quantity: 1 });
    if (selectedAddons.includes('sexual')) line_items.push({ price: PRICE_MAP.addon_sexual, quantity: 1 });
    if (selectedAddons.includes('skinhair')) line_items.push({ price: PRICE_MAP.addon_skinhair, quantity: 1 });

    if (line_items.length === 0) {
      throw new Error('No line items created');
    }

    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

    // ===== Create Checkout Session =====
   const session = await stripe.checkout.sessions.create({
  mode: 'subscription',

  // ✅ Enable flexible billing on the CHECKOUT SESSION
  billing_mode: { type: 'flexible' },

  // Keep metadata here (no billing_mode inside subscription_data)
  subscription_data: {
    metadata: {
      plan: planLabel,
      billing: billingLabel,
      addons: selectedAddons.length ? selectedAddons.join(', ') : 'None',
      service_state: String(service_state || ''),
    },
  },

  line_items,

  success_url: `${FRONTEND_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `${FRONTEND_URL}/cancel.html`,

  billing_address_collection: 'required',
  allow_promotion_codes: true,
});

    return res.status(200).json({ id: session.id });
  } catch (err) {
    console.error('Error in create-checkout-session:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};
