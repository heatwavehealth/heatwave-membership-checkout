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
    const PRICE_IDS = {
      essence_monthly: 'price_1Sk9ksAQMgf0dKsAXrhMTJXr',
      essence_annual: 'price_1Sk9k7AQMgf0dKsAU4hlS5W5',
      radiance_monthly: 'price_1Sk9m9AQMgf0dKsAdr01j8Mw',
      radiance_annual: 'price_1Sk9lRAQMgf0dKsAdf1vcV8L',
      addon_nutrition: 'price_1Sk9neAQMgf0dKsA0BEYJ4T1',
      addon_metabolic: 'price_1Sk9nMAQMgf0dKsADQiUaD1K',
      addon_sexual: 'price_1Sk9mzAQMgf0dKsA1P266sR2',
      addon_skinhair: 'price_1Sk9mgAQMgf0dKsAnm5qBeeU'
    };
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
      line_items,
      success_url: `${FRONTEND_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/cancel.html`,
      billing_address_collection: 'auto',
      allow_promotion_codes: true
    });

    res.status(200).json({ id: session.id });
  } catch (err) {
    console.error('Error in create-checkout-session:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
};
