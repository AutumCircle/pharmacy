VERDICT: PASS

Small visual change: a 429 message is shown in the orders view (src/app/tracking/page.tsx:188-189) using the same red #c62828, 14px, role="alert" pattern as the existing phone error at line 151. Centered with 20px padding like neighbouring empty/loading states. No new components, no overflow risk, calm tone. Error is cleared on "Сменить номер телефона" (line 167).

Notes
- The page uses inline hex colors rather than tokens; matches the file convention, so not blocking.
