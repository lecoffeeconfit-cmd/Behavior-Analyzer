import Stripe from "stripe";
import { ApiError, billingReady, settings, trustedHttpsUrl } from "./config";
import { inTransaction } from "./db";
import type { User } from "./auth";
export function stripeClient() {
  // Phase two is intentionally test-only. A live key cannot activate live charges.
  if (!billingReady()) throw new ApiError(503, "Stripe test billing is not configured. Live charges are disabled.");
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}
export async function createTestCheckout(user: User) {
  const stripe = stripeClient(), price = await stripe.prices.retrieve(process.env.STRIPE_PRICE_ID!);
  if (price.livemode || !price.active || price.currency !== "usd" || price.unit_amount !== settings().priceCents || price.recurring?.interval !== "month" || price.recurring.interval_count !== 1) throw new ApiError(503, "The Stripe test price does not match the configured monthly Pro plan.");
  const origin = trustedHttpsUrl(process.env.WEB_ORIGIN).origin;
  const session = await stripe.checkout.sessions.create({ mode: "subscription", line_items: [{ price: price.id, quantity: 1 }], customer_email: user.email, client_reference_id: user.id, subscription_data: { metadata: { userId: user.id } }, success_url: `${origin}/?checkout=test-success`, cancel_url: `${origin}/?checkout=test-cancelled` });
  return { url: session.url, testMode: true };
}
export async function handleStripeWebhook(raw: string, signature: string) {
  const stripe = stripeClient();
  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(raw, signature, process.env.STRIPE_WEBHOOK_SECRET!); }
  catch { throw new ApiError(400, "Invalid Stripe webhook signature."); }
  if (event.livemode) throw new ApiError(400, "Live billing events are disabled in this implementation phase.");
  if (!["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) return;
  const sub = event.data.object as Stripe.Subscription;
  const userId = sub.metadata.userId;
  const item = sub.items.data[0];
  if (!/^[a-f\d-]{36}$/i.test(userId || "") || !item || sub.items.data.length !== 1 || item.price.id !== process.env.STRIPE_PRICE_ID || item.quantity !== 1) throw new ApiError(400, "Subscription metadata or price is invalid.");
  await inTransaction(async (client) => {
    const inserted = await client.query("INSERT INTO va_stripe_events(id,created) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id", [event.id, event.created]);
    if (!inserted.rowCount) return;
    await client.query(`INSERT INTO va_subscriptions(user_id,stripe_subscription_id,stripe_customer_id,status,period_start,period_end,event_created)
      VALUES($1,$2,$3,$4,to_timestamp($5),to_timestamp($6),$7)
      ON CONFLICT(user_id) DO UPDATE SET stripe_subscription_id=EXCLUDED.stripe_subscription_id,stripe_customer_id=EXCLUDED.stripe_customer_id,status=EXCLUDED.status,period_start=EXCLUDED.period_start,period_end=EXCLUDED.period_end,event_created=EXCLUDED.event_created
      WHERE va_subscriptions.event_created <= EXCLUDED.event_created`, [userId, sub.id, typeof sub.customer === "string" ? sub.customer : sub.customer.id, event.type === "customer.subscription.deleted" ? "canceled" : sub.status, item.current_period_start, item.current_period_end, event.created]);
  });
}
