#!/bin/bash
# Corre una sola vez, cuando el volumen de Postgres está vacío.
# Crea el usuario con el que entra la aplicación: no es dueño de las tablas, así que RLS sí lo filtra.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE ROLE aycha_app WITH LOGIN PASSWORD '${AYCHA_APP_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO aycha_app;
  GRANT USAGE ON SCHEMA public TO aycha_app;
  ALTER DATABASE ${POSTGRES_DB} SET timezone TO 'America/Lima';
  -- Base para las pruebas automáticas (php artisan test): misma estructura, datos aparte.
  CREATE DATABASE ${POSTGRES_DB}_test OWNER ${POSTGRES_USER};
EOSQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "${POSTGRES_DB}_test" -c "GRANT USAGE ON SCHEMA public TO aycha_app; ALTER DATABASE ${POSTGRES_DB}_test SET timezone TO 'America/Lima';"
