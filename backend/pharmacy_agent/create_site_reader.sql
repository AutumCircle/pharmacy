-- Read-only Oracle account for the pharmacy mirror agent.
-- Run ONCE in SQL*Plus as SYSTEM:  sqlplus SYSTEM@127.0.0.1:1521/xe @create_site_reader.sql
-- It creates a new user and grants SELECT only. It does not change any «Алгоритм» table.
ACCEPT reader_password CHAR PROMPT 'New password for SITE_READER: ' HIDE

CREATE USER site_reader IDENTIFIED BY "&reader_password";
GRANT CREATE SESSION TO site_reader;

GRANT SELECT ON organiz.t_product        TO site_reader;
GRANT SELECT ON organiz.t_sklad_state    TO site_reader;
GRANT SELECT ON organiz.t_income         TO site_reader;
GRANT SELECT ON organiz.t_income_head    TO site_reader;
GRANT SELECT ON organiz.t_vendor         TO site_reader;
GRANT SELECT ON organiz.t_country        TO site_reader;
GRANT SELECT ON organiz.t_product_mnn    TO site_reader;
GRANT SELECT ON organiz.t_product_group  TO site_reader;
GRANT SELECT ON organiz.t_product_sostav TO site_reader;
GRANT SELECT ON organiz.t_sklad          TO site_reader;
GRANT SELECT ON organiz.t_measure        TO site_reader;
GRANT SELECT ON organiz.t_product_type   TO site_reader;

-- Check: must print 12.
SELECT COUNT(*) AS granted_tables FROM dba_tab_privs WHERE grantee = 'SITE_READER';
EXIT
