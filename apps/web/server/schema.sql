-- Run with an administrative database connection. Never expose this connection to clients.
BEGIN;
CREATE TABLE IF NOT EXISTS va_subscriptions (
  user_id uuid PRIMARY KEY,
  stripe_subscription_id text NOT NULL UNIQUE,
  stripe_customer_id text NOT NULL,
  status text NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL CHECK(period_end > period_start),
  event_created bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS va_usage (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES va_subscriptions(user_id),
  period_start timestamptz NOT NULL,
  credits integer NOT NULL CHECK(credits >= 0),
  cost_cents integer NOT NULL CHECK(cost_cents >= 0),
  status text NOT NULL CHECK(status IN ('reserved','complete','failed')),
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS va_usage_period ON va_usage(user_id,period_start);
CREATE INDEX IF NOT EXISTS va_usage_created ON va_usage(created_at);
CREATE TABLE IF NOT EXISTS va_stripe_events(id text PRIMARY KEY,created bigint NOT NULL);
-- Browser clients must never write entitlements, allowance, or Stripe events.
ALTER TABLE va_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE va_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE va_stripe_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON va_subscriptions,va_usage,va_stripe_events FROM PUBLIC;
COMMIT;
