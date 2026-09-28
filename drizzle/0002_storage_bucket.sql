-- Private Supabase Storage bucket for documents (COA, TDS, MSDS, certificates — roadmap).
-- No storage policies are created, so only the service role can read/write for now; the
-- future documents module will add org-scoped policies and serve files via signed URLs.
-- No-op where the storage schema doesn't exist (local Postgres used for tests).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('documents', 'documents', false, 20971520)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;
