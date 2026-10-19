-- First-party landing events for UTM links that point directly to products or other public pages.
-- Additive and safe to re-run.
BEGIN;

CREATE TABLE IF NOT EXISTS utm_link_events (
    id BIGSERIAL PRIMARY KEY,
    visitor_id VARCHAR(64) NOT NULL,
    path VARCHAR(500) NOT NULL,
    product_id INTEGER,
    utm_source VARCHAR(100),
    utm_medium VARCHAR(100),
    utm_campaign VARCHAR(100),
    utm_content VARCHAR(100),
    referrer VARCHAR(500),
    user_agent VARCHAR(300),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT utm_link_events_path_check CHECK (length(path) BETWEEN 1 AND 500 AND path LIKE '/%'),
    CONSTRAINT utm_link_events_utm_check CHECK (
        utm_source IS NOT NULL OR utm_medium IS NOT NULL
        OR utm_campaign IS NOT NULL OR utm_content IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS utm_link_events_created
    ON utm_link_events (created_at);
CREATE INDEX IF NOT EXISTS utm_link_events_campaign_content_created
    ON utm_link_events (utm_campaign, utm_content, created_at);

COMMIT;
