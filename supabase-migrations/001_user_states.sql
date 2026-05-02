-- Table user_states : stockage persistant de l'état dashboard de chaque client
-- (remplace user_states.json qui n'est pas persistant entre redéploiements Render)
-- À exécuter UNE FOIS dans Supabase > SQL Editor

create table if not exists user_states (
  email                text primary key,
  sent_this_month      int default 0,
  sent_month           text,
  sms_template         text,
  use_custom_template  boolean default false,
  nom_pro              text,
  lien_google          text,
  history              jsonb default '[]'::jsonb,
  lock_pin             text,
  lock_enabled         boolean default false,
  updated_at           timestamptz default now()
);

-- Index sur updated_at pour audit éventuel
create index if not exists user_states_updated_at_idx on user_states (updated_at desc);
