-- P3-06 (files): a file's identity and scan outcome cannot be rewritten. Hand-written.
--
-- Why: CLAUDE.md section 5 makes released report versions immutable, and a report version
-- points at its files (`report_version.original_file_id`, `stamped_file_id`) together with
-- the hash recorded when the file was validated. The grants on `file_object` allow UPDATE for
-- both application roles (it is an ordinary table: only the status of a file moves), so
-- without a trigger any bug in any module could change the object key, the hash or the scan
-- status of a file a released report depends on, or flip a rejected upload to CLEAN.
--
-- The rules (error code LC003, "row is frozen", as the other immutability triggers):
--   1. Only a system job (the worker's scan processor, `app_is_system()`) may change the
--      columns that describe the stored object and its scan outcome. A tenant or platform
--      request cannot, whatever its row-level security lets it update.
--   2. Once a file is CLEAN, INFECTED or REJECTED those columns never change again, not even
--      for a system job. PENDING and ERROR files can still be decided (ERROR allows a re-scan).
-- Other columns (`original_filename`, `retention_class`, `customer_org_id`, `lab_org_id`,
-- the audit columns) are not frozen. There is no DELETE grant, so rows cannot be removed.
-- No new table, grant or policy.

CREATE FUNCTION trg_file_object_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_ignore text[] := ARRAY[
    'original_filename', 'retention_class', 'customer_org_id', 'lab_org_id',
    'uploaded_by_user_id', 'created_by_user_id', 'created_at', 'updated_at'
  ];
BEGIN
  IF (to_jsonb(NEW) - v_ignore) = (to_jsonb(OLD) - v_ignore) THEN
    RETURN NEW;
  END IF;
  IF OLD.scan_status IN ('CLEAN', 'INFECTED', 'REJECTED') THEN
    RAISE EXCEPTION 'a % file cannot be changed', OLD.scan_status USING ERRCODE = 'LC003';
  END IF;
  IF NOT app_is_system() THEN
    RAISE EXCEPTION 'only the scan job may change the stored object or scan outcome of a file'
      USING ERRCODE = 'LC003';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_file_object_frozen BEFORE UPDATE ON file_object
  FOR EACH ROW EXECUTE FUNCTION trg_file_object_frozen();
