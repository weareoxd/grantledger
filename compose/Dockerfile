FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    POETRY_VERSION=2.1.1 \
    POETRY_HOME=/opt/poetry \
    POETRY_VIRTUALENVS_CREATE=false

ARG PROJECT_DIR=/var/www/
RUN mkdir -p $PROJECT_DIR
WORKDIR $PROJECT_DIR

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    libpq-dev \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/* \
    && curl -sSL https://install.python-poetry.org | python

ENV PATH="/opt/poetry/bin:${PATH}"

# Dependencies (the lock file is generated on first build if absent).
COPY ./backend/pyproject.toml ./backend/poetry.lock* /
RUN cd / && (test -f poetry.lock || poetry lock) && poetry install --no-interaction --no-ansi

COPY ./compose/start.sh ./compose/start_mcp.sh /
RUN sed -i 's/\r$//g' /start.sh /start_mcp.sh && chmod +x /start.sh /start_mcp.sh

EXPOSE 8000 8082
STOPSIGNAL SIGINT
