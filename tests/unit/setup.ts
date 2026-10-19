// Placeholder config so modules that check their env at import time load.
// Unit tests replace Supabase and Google with fakes; these values are never used to connect.
process.env.SUPABASE_URL ??= 'http://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';
process.env.GOOGLE_CLIENT_ID ??= 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET ??= 'test-client-secret';
process.env.GOOGLE_CALENDAR_ID_PUBLIC ??= 'public@test';
process.env.GOOGLE_CALENDAR_ID_PRIVATE ??= 'private@test';
