// api/create-checkout-session.js

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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

    const { plan, billing, addons } = body;

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

   const isAnnual = billing === 'annual';
const hasAddons = selectedAddons.length > 0;

const session = await stripe.checkout.sessions.create({
  mode: 'subscription',
  line_items,
  success_url: `${FRONTEND_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `${FRONTEND_URL}/cancel.html`,
  billing_address_collection: 'required',
  allow_promotion_codes: true,

  // IMPORTANT: metadata must live here so the webhook can read it from the Subscription
  subscription_data: {
    metadata: {
      plan: plan === 'essence' ? 'Essence' : plan === 'radiance' ? 'Radiance' : String(plan || ''),
      billing: isAnnual ? 'Annual' : 'Monthly',
      addons: hasAddons ? selectedAddons.join(', ') : 'None',

      // This is the switch the webhook uses
      addons_deferred: (isAnnual && hasAddons) ? 'true' : 'false',

      // Optional (only include if you’re collecting them on frontend)
      // service_state: String(service_state || ''),
      // state_attestation: 'true'
    }
  }
});
