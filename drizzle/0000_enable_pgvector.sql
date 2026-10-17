-- Enables pgvector. Safe on docker-compose (already enabled by docker/init.sql) and on Neon.
CREATE EXTENSION IF NOT EXISTS vector;
