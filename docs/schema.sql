-- =====================================================================
-- Логическая схема БД «ИС учёта комплектующих» (ТЗ, раздел 6.5)
-- Диалект: PostgreSQL. Кодировка: UTF-8.
--
-- В веб-версии для GitHub Pages те же таблицы хранятся в браузере
-- (IndexedDB/localStorage, файл js/db.js), а ограничения CHECK/UNIQUE/FK
-- проверяются в слое бизнес-логики (js/api.js). Скрипт приведён для
-- документации и возможного переноса на сервер Flask + PostgreSQL.
-- =====================================================================

CREATE TABLE roles (
    id   SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL
);

CREATE TABLE users (
    id                   SERIAL PRIMARY KEY,
    login                VARCHAR(50)  UNIQUE NOT NULL,
    password_hash        VARCHAR(255) NOT NULL,
    full_name            VARCHAR(150) NOT NULL,
    role_id              INTEGER      NOT NULL REFERENCES roles(id),
    is_active            BOOLEAN      NOT NULL DEFAULT TRUE,
    must_change_password BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at           TIMESTAMP    NOT NULL DEFAULT now(),
    last_login_at        TIMESTAMP
);

CREATE TABLE categories (
    id        SERIAL PRIMARY KEY,
    name      VARCHAR(100) UNIQUE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE units (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(20) UNIQUE NOT NULL,
    allows_fraction BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE locations (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE components (
    id          SERIAL PRIMARY KEY,
    sku         VARCHAR(50)  UNIQUE NOT NULL,
    name        VARCHAR(255) NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    unit_id     INTEGER NOT NULL REFERENCES units(id),
    min_stock   NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE operations (
    id             SERIAL PRIMARY KEY,
    number         VARCHAR(50) NOT NULL,
    type           VARCHAR(20) NOT NULL CHECK (type IN ('receipt','issue','return','writeoff','transfer','inventory')),
    status         VARCHAR(20) NOT NULL CHECK (status IN ('draft','posted')),
    operation_date TIMESTAMP NOT NULL,
    created_by     INTEGER NOT NULL REFERENCES users(id),
    created_at     TIMESTAMP NOT NULL DEFAULT now(),
    posted_at      TIMESTAMP,
    comment        TEXT,
    reason         VARCHAR(255),
    receiver       VARCHAR(150),
    issue_id       INTEGER REFERENCES operations(id),      -- исходная выдача для возврата
    reversal_of_id INTEGER UNIQUE REFERENCES operations(id), -- UNIQUE: повторное сторно невозможно
    CHECK (type <> 'writeoff' OR status = 'draft' OR reason IS NOT NULL),
    CHECK (type <> 'issue'    OR status = 'draft' OR receiver IS NOT NULL)
);

CREATE TABLE operation_details (
    id                      SERIAL PRIMARY KEY,
    operation_id            INTEGER NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
    component_id            INTEGER NOT NULL REFERENCES components(id),
    quantity                NUMERIC(14,3) NOT NULL CHECK (quantity >= 0), -- > 0 для всех типов, кроме инвентаризации без расхождения
    unit_price              NUMERIC(14,2) CHECK (unit_price >= 0),
    source_location_id      INTEGER REFERENCES locations(id),
    destination_location_id INTEGER REFERENCES locations(id),
    actual_quantity         NUMERIC(14,3) CHECK (actual_quantity >= 0),
    book_quantity           NUMERIC(14,3)
);

CREATE TABLE stock (
    id           SERIAL PRIMARY KEY,
    component_id INTEGER NOT NULL REFERENCES components(id),
    location_id  INTEGER NOT NULL REFERENCES locations(id),
    quantity     NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    UNIQUE (component_id, location_id)
);

CREATE TABLE audit_log (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER REFERENCES users(id),
    action      VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id   INTEGER,
    created_at  TIMESTAMP NOT NULL DEFAULT now(),
    details     JSONB
);

CREATE INDEX idx_operations_date   ON operations(operation_date);
CREATE INDEX idx_details_component ON operation_details(component_id);
CREATE INDEX idx_audit_created     ON audit_log(created_at);

INSERT INTO roles(name) VALUES ('Администратор'), ('Кладовщик'), ('Руководитель');
