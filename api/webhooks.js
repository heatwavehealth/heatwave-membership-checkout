// api/webhooks.js

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-07-30.basil',
});

// Vercel serverless: must read raw body for Stripe signature verification
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('Missing STRIPE_WEBHOOK_SECRET env var');
      return res.status(500).send('Server misconfigured');
    }

    // ---- Read RAW body ----
    const rawBody = await getRawBody(req);

    const sig = req.headers['stripe-signature'];
    if (!sig) {
      return res.status(400).send('Missing Stripe signature header');
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err) {
      console.error('Stripe webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // ---- Handle events ----
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      // For subscription checkout, session.subscription should exist
      if (!session.subscription || !session.customer) {
        // Nothing to do (could be a one-time payment session)
        return res.status(200).json({ received: true, skipped: 'No subscription/customer on session' });
      }

      // Retrieve the subscription to read metadata and payment method
      const baseSub = await stripe.subscriptions.retrieve(session.subscription, {
        expand: ['default_payment_method', 'customer'],
      });

      const md = baseSub.metadata || {};
      const createLater = (md.create_addons_later || '').toLowerCase() === 'true';
      const addonsCsv = (md.addons || '').trim();

      if (!createLater) {
        return res.status(200).json({ received: true, skipped: 'No add-ons to create later' });
      }

      if (!addonsCsv || addonsCsv.toLowerCase() === 'none') {
        return res.status(200).json({ received: true, skipped: 'Add-ons metadata empty/None' });
      }

      const addonKeys = addonsCsv
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);

      // Map addon key -> env var price id
      const PRICE = {
        nutrition: process.env.PRICE_ADDON_NUTRITION,
        metabolic: process.env.PRICE_ADDON_METABOLIC,
        sexual: process.env.PRICE_ADDON_SEXUAL,
        skinhair: process.env.PRICE_ADDON_SKINHAIR,
      };

      // Validate addon price env vars
      for (const k of addonKeys) {
        if (!PRICE[k]) {
          console.error(`Missing PRICE for add-on key: ${k}`);
          return res.status(500).send(`Missing env var for add-on price: ${k}`);
        }
      }

      // Build items for the add-on subscription
      const items = addonKeys.map(k => ({ price: PRICE[k], quantity: 1 }));

      const customerId = typeof baseSub.customer === 'string' ? baseSub.customer : baseSub.customer.id;

      // ---- Idempotency / duplicate protection ----
      // 1) First check if we already created an add-on subscription for this base subscription
      const existing = await stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 50,
      });

      const alreadyCreated = existing.data.some(s =>
        s.metadata &&
        s.metadata.parent_subscription === baseSub.id &&
        s.metadata.source === 'annual-base-addons'
      );

      if (alreadyCreated) {
        return res.status(200).json({ received: true, skipped: 'Add-on subscription already exists' });
      }

      // ---- Find a payment method we can charge without another checkout ----
      // Best: base subscription default_payment_method
      let defaultPmId = baseSub.default_payment_method && baseSub.default_payment_method.id
        ? baseSub.default_payment_method.id
        : null;

      // Fallback: customer invoice_settings.default_payment_method
      if (!defaultPmId && baseSub.customer && baseSub.customer.invoice_settings) {
        const cpm = baseSub.customer.invoice_settings.default_payment_method;
        defaultPmId = typeof cpm === 'string' ? cpm : (cpm && cpm.id ? cpm.id : null);
      }

      // If still missing, try retrieving customer explicitly (covers cases where expand didn't include)
      if (!defaultPmId) {
        const customer = await stripe.customers.retrieve(customerId);
        const cpm = customer?.invoice_settings?.default_payment_method;
        defaultPmId = typeof cpm === 'string' ? cpm : (cpm && cpm.id ? cpm.id : null);
      }

      if (!defaultPmId) {
        console.error('No default payment method found to create add-on subscription.');
        // You could also notify internally via Make at this point (optional), but don’t silently fail.
        return res.status(500).send('No default payment method available for add-on subscription.');
      }

      // ---- Create the add-on subscription (monthly add-ons) ----
      const addonSub = await stripe.subscriptions.create(
        {
          customer: customerId,
          default_payment_method: defaultPmId,
          items,
          metadata: {
            parent_subscription: baseSub.id,
            parent_checkout_session: session.id,
            source: 'annual-base-addons',
            plan: md.plan || '',
            billing: md.billing || '',
            addons: addonsCsv,
            service_state: md.service_state || '',
          },
        },
        {
          // Extra idempotency protection in case Stripe retries the webhook
          idempotencyKey: `addons-${session.id}`,
        }
      );

      return res.status(200).json({
        received: true,
        created: true,
        addon_subscription_id: addonSub.id,
      });
    }

    // For all other event types, acknowledge
    return res.status(200).json({ received: true, ignored: event.type });

  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(500).send(err.message || 'Webhook server error');
  }
};

// ---- Helper: read raw request body ----
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
