-- MarkOS's server talks to the database with the service_role key only, and the browser
-- never talks to it. A request with no key, or with the anon key, runs as `anon`, so
-- `anon` and `authenticated` get nothing: no schema, no tables, no sequences.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke usage on schema public from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
