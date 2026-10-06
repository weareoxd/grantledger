#!/bin/bash
set -o errexit
set -o pipefail
set -o nounset

echo 'Migrating'
python manage.py migrate

echo 'Creating cache table'
python manage.py createcachetable

echo 'Ensuring fiscal years'
python manage.py ensure_fiscal_years

echo 'Creating superuser (no-op if it exists)'
python manage.py createsuperuser --noinput --email "$DJANGO_SUPERUSER_EMAIL" 2>/dev/null || true

echo 'Starting Django admin on :8000'
python manage.py runserver 0.0.0.0:8000
