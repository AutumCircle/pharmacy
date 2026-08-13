-- Editable homepage banners. Stores metadata and HTTPS image URLs, not binary files.
BEGIN;

CREATE TABLE homepage_banners (
    slot VARCHAR(30) PRIMARY KEY,
    title VARCHAR(120) NOT NULL,
    subtitle VARCHAR(240),
    image_url TEXT,
    link_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT homepage_banners_slot_check CHECK (slot IN ('left', 'center', 'right_top', 'right_bottom')),
    CONSTRAINT homepage_banners_image_url_check CHECK (image_url IS NULL OR image_url ~ '^https://'),
    CONSTRAINT homepage_banners_link_url_check CHECK (
        link_url IS NULL OR link_url ~ '^https://' OR (link_url LIKE '/%' AND link_url NOT LIKE '//%')
    )
);

INSERT INTO homepage_banners (slot, title, subtitle)
VALUES
    ('left', 'Витамины, минералы и добавки', NULL),
    ('center', 'Скидка на все виды лекарств', 'Без выходных · Работаем днём и ночью · Доставим быстро'),
    ('right_top', 'Лучшие цены на лекарства', NULL),
    ('right_bottom', 'Бонус к чеку', NULL)
ON CONFLICT (slot) DO NOTHING;

COMMIT;
