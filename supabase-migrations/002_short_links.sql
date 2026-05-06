-- Table short_links : raccourcis d'URL pour les SMS
-- (remplace links.json qui n'est pas persistant entre redéploiements Render)
-- À exécuter UNE FOIS dans Supabase > SQL Editor

create table if not exists short_links (
  code        text primary key,
  url         text not null,
  created_at  timestamptz default now()
);

-- Index pour la recherche par URL (déduplication dans /shorten)
create index if not exists short_links_url_idx on short_links (url);
