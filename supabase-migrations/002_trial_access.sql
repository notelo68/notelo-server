-- Accès test gratuit (10 SMS ou 14 jours, carte bancaire requise via Stripe)
-- Ajoute le suivi Stripe + compteur SMS sur la table clients existante
-- À exécuter UNE FOIS dans Supabase > SQL Editor

alter table clients add column if not exists stripe_customer_id text;
alter table clients add column if not exists stripe_subscription_id text;
alter table clients add column if not exists trial_sms_count int default 0;
alter table clients add column if not exists trial_ends_at timestamptz;
alter table clients add column if not exists trial_reminder_sent boolean default false;

create index if not exists clients_stripe_subscription_id_idx on clients (stripe_subscription_id);
