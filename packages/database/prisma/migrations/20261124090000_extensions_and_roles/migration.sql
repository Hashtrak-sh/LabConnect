-- Extensions (INDEXES_AND_CONSTRAINTS.md section 3) and database roles
-- (MIGRATION_AND_SEED_STRATEGY.md section 1). Hand-written.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Roles are created without LOGIN and without passwords. Each environment's
-- infrastructure creates the login users and grants them membership of these roles.
--   app_rw      the API
--   app_worker  the worker and SYSTEM jobs
--   app_ro      reporting (no grants yet)
-- The role that runs migrations (app_owner in deployed environments) owns every object.
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['app_rw', 'app_worker', 'app_ro'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT', r);
    END IF;
  END LOOP;
END
$$;
