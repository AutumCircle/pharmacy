-- Category image URLs and a dedicated smartphone homepage banner.
-- Existing emoji strings and all four desktop banners are preserved.
BEGIN;
ALTER TABLE categories ALTER COLUMN icon TYPE TEXT;
ALTER TABLE homepage_banners DROP CONSTRAINT IF EXISTS homepage_banners_slot_check;
ALTER TABLE homepage_banners ADD CONSTRAINT homepage_banners_slot_check
    CHECK (slot IN ('left', 'center', 'right_top', 'right_bottom', 'mobile'));
INSERT INTO homepage_banners (slot, title, is_active)
VALUES ('mobile', NULL, FALSE)
ON CONFLICT (slot) DO NOTHING;
COMMIT;
