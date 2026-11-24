-- Triggers. Hand-written. C-xx numbers refer to docs/03-database/INDEXES_AND_CONSTRAINTS.md.
--
-- Error codes raised here (SQLSTATE), so the application and the tests can tell them apart:
--   LC001  append-only table
--   LC002  booking status change that is not a legal transition
--   LC003  row is frozen (published, decided, released, or totals after acceptance)
--   LC004  cross-row rule violated (wrong organisation, site, booking, taxonomy, amount)
--
-- Validation functions that read other tables are SECURITY DEFINER, so the check sees
-- every row even when the calling role is limited by row-level security.

-- ===================================================================
-- updated_at
-- ===================================================================
CREATE FUNCTION trg_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'config_parameter','holiday_calendar','timer','idempotency_record','organisation','app_user','membership',
    'membership_role','membership_site','invitation','otp_challenge','mfa_factor','mfa_recovery_code','user_session',
    'invitation_site','organisation_private','file_object','file_link','md_taxonomy','md_node_type',
    'md_attribute_definition','md_node','md_change_set','md_change_item','import_mapping_template','import_job',
    'import_row','accreditation_body','accreditation_standard','search_synonym','lab_site','accreditation',
    'scope_line','lab_claim_request','kyc_document','bank_account','receiving_hours','site_closure','retention_rule',
    'price_list','price_item','slot_template','slot','lab_site_private','customer_site','customer_settings',
    'lead_request','booking','booking_line','counter_offer','slot_hold','qr_signing_key','package','receipt_record',
    'receipt_package','hold_case','report','report_version','report_parameter_result','report_share_link',
    'break_glass_grant','payment_order','refund','payout','payout_item','payout_hold','ledger_account',
    'document_series','fee_rule','settlement_report_line','dispute','rating','notification_template','notification',
    'notification_preference'
  ] LOOP
    EXECUTE format('CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at()', t);
  END LOOP;
END
$$;

-- ===================================================================
-- C-25  append-only tables
-- ===================================================================
CREATE FUNCTION trg_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only: % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = 'LC001';
END
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'audit_log','processed_event','audit_log_chain','organisation_version','md_node_version','search_synonym_version',
    'lab_site_version','accreditation_version','scope_line_version','lab_penalty','trf','booking_status_history',
    'custody_event','label_print','custody_event_photo','report_access_log','verification_event',
    'payment_transaction','ledger_journal','ledger_entry','financial_document','dispute_message','dispute_evidence'
  ] LOOP
    EXECUTE format('CREATE TRIGGER trg_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION trg_append_only()', t);
    EXECUTE format('CREATE TRIGGER trg_append_only_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION trg_append_only()', t);
  END LOOP;
END
$$;

-- ===================================================================
-- C-06, C-07, C-31, C-37  identity
-- ===================================================================
CREATE FUNCTION trg_role_matches_org_type() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_org_type org_type;
BEGIN
  SELECT o.org_type INTO v_org_type
    FROM membership m JOIN organisation o ON o.id = m.organisation_id
   WHERE m.id = NEW.membership_id;
  IF split_part(NEW.role::text, '_', 1) <> v_org_type::text THEN
    RAISE EXCEPTION 'role % cannot be granted in a % organisation', NEW.role, v_org_type USING ERRCODE = 'LC004';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_role_matches_org_type BEFORE INSERT OR UPDATE OF role, membership_id ON membership_role
  FOR EACH ROW EXECUTE FUNCTION trg_role_matches_org_type();

CREATE FUNCTION trg_membership_platform_staff() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_is_staff boolean;
  v_org_type org_type;
BEGIN
  SELECT is_platform_staff INTO v_is_staff FROM app_user WHERE id = NEW.user_id;
  SELECT org_type INTO v_org_type FROM organisation WHERE id = NEW.organisation_id;
  IF v_is_staff <> (v_org_type = 'PLATFORM') THEN
    RAISE EXCEPTION 'platform staff may join only the platform organisation, and nobody else may join it (RR-5)'
      USING ERRCODE = 'LC004';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_membership_platform_staff BEFORE INSERT OR UPDATE OF user_id, organisation_id ON membership
  FOR EACH ROW EXECUTE FUNCTION trg_membership_platform_staff();

CREATE FUNCTION trg_membership_site_same_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM membership m JOIN lab_site s ON s.organisation_id = m.organisation_id
     WHERE m.id = NEW.membership_id AND s.id = NEW.lab_site_id
  ) THEN
    RAISE EXCEPTION 'the lab site does not belong to the organisation of the membership' USING ERRCODE = 'LC004';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_membership_site_same_org BEFORE INSERT OR UPDATE OF membership_id, lab_site_id ON membership_site
  FOR EACH ROW EXECUTE FUNCTION trg_membership_site_same_org();

CREATE FUNCTION trg_invitation_site_same_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM invitation i JOIN lab_site s ON s.organisation_id = i.organisation_id
     WHERE i.id = NEW.invitation_id AND s.id = NEW.lab_site_id
  ) THEN
    RAISE EXCEPTION 'the lab site does not belong to the organisation of the invitation' USING ERRCODE = 'LC004';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_invitation_site_same_org BEFORE INSERT OR UPDATE ON invitation_site
  FOR EACH ROW EXECUTE FUNCTION trg_invitation_site_same_org();

-- ===================================================================
-- C-76  master-data tree; C-77  taxonomy-typed references
-- ===================================================================
CREATE FUNCTION trg_md_node_path() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_parent md_node%ROWTYPE;
  v_level int;
  v_parent_level int;
  v_label text := replace(NEW.id::text, '-', '');
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.parent_id IS DISTINCT FROM OLD.parent_id
     AND EXISTS (SELECT 1 FROM md_node WHERE parent_id = NEW.id) THEN
    RAISE EXCEPTION 'a node that has children cannot be moved' USING ERRCODE = 'LC004';
  END IF;
  IF NEW.parent_id IS NULL THEN
    NEW.path := v_label::ltree;
    RETURN NEW;
  END IF;
  SELECT * INTO v_parent FROM md_node WHERE id = NEW.parent_id;
  IF v_parent.taxonomy_id <> NEW.taxonomy_id THEN
    RAISE EXCEPTION 'parent node belongs to a different taxonomy' USING ERRCODE = 'LC004';
  END IF;
  SELECT level INTO v_level FROM md_node_type WHERE id = NEW.node_type_id;
  SELECT level INTO v_parent_level FROM md_node_type WHERE id = v_parent.node_type_id;
  IF v_parent_level <> v_level - 1 THEN
    RAISE EXCEPTION 'parent node must be at the level directly above (parent level %, node level %)', v_parent_level, v_level
      USING ERRCODE = 'LC004';
  END IF;
  NEW.path := v_parent.path || v_label::ltree;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_md_node_path BEFORE INSERT OR UPDATE OF parent_id, node_type_id, taxonomy_id ON md_node
  FOR EACH ROW EXECUTE FUNCTION trg_md_node_path();

-- Arguments come in threes: column name, taxonomy code, node type code ('' = any type).
CREATE FUNCTION trg_assert_md_node() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  i int;
  v_row jsonb := to_jsonb(NEW);
  v_id uuid;
BEGIN
  FOR i IN 0 .. (TG_NARGS / 3) - 1 LOOP
    v_id := (v_row ->> TG_ARGV[i * 3])::uuid;
    IF v_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
        FROM md_node n
        JOIN md_taxonomy x ON x.id = n.taxonomy_id
        JOIN md_node_type nt ON nt.id = n.node_type_id
       WHERE n.id = v_id
         AND x.code = TG_ARGV[i * 3 + 1]
         AND (TG_ARGV[i * 3 + 2] = '' OR nt.code = TG_ARGV[i * 3 + 2])
    ) THEN
      RAISE EXCEPTION '%.% must reference a % node%', TG_TABLE_NAME, TG_ARGV[i * 3], TG_ARGV[i * 3 + 1],
        CASE WHEN TG_ARGV[i * 3 + 2] = '' THEN '' ELSE ' of type ' || TG_ARGV[i * 3 + 2] END
        USING ERRCODE = 'LC004';
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_assert_md_node BEFORE INSERT OR UPDATE ON scope_line FOR EACH ROW EXECUTE FUNCTION trg_assert_md_node(
  'discipline_node_id', 'SCOPE', 'DISCIPLINE', 'group_node_id', 'SCOPE', 'GROUP', 'product_node_id', 'SCOPE', 'PRODUCT',
  'parameter_node_id', 'SCOPE', 'PARAMETER', 'method_node_id', 'METHOD', '', 'range_unit_node_id', 'UNIT', '');
CREATE TRIGGER trg_assert_md_node BEFORE INSERT OR UPDATE ON price_item FOR EACH ROW EXECUTE FUNCTION trg_assert_md_node(
  'sample_unit_node_id', 'UNIT', '');
CREATE TRIGGER trg_assert_md_node BEFORE INSERT OR UPDATE ON retention_rule FOR EACH ROW EXECUTE FUNCTION trg_assert_md_node(
  'discipline_node_id', 'SCOPE', 'DISCIPLINE');
CREATE TRIGGER trg_assert_md_node BEFORE INSERT OR UPDATE ON slot_template FOR EACH ROW EXECUTE FUNCTION trg_assert_md_node(
  'discipline_node_id', 'SCOPE', 'DISCIPLINE');
CREATE TRIGGER trg_assert_md_node BEFORE INSERT OR UPDATE OF discipline_node_id ON slot FOR EACH ROW EXECUTE FUNCTION trg_assert_md_node(
  'discipline_node_id', 'SCOPE', 'DISCIPLINE');
CREATE TRIGGER trg_assert_md_node BEFORE INSERT OR UPDATE ON kyc_document FOR EACH ROW EXECUTE FUNCTION trg_assert_md_node(
  'document_type_node_id', 'KYC_DOCUMENT_TYPE', '');
CREATE TRIGGER trg_assert_md_node BEFORE INSERT OR UPDATE OF product_node_id, cancellation_code_node_id, rejection_reason_node_id ON booking
  FOR EACH ROW EXECUTE FUNCTION trg_assert_md_node(
  'product_node_id', 'SCOPE', 'PRODUCT', 'cancellation_code_node_id', 'CANCELLATION_REASON', '',
  'rejection_reason_node_id', 'REJECTION_REASON', '');
CREATE TRIGGER trg_assert_md_node BEFORE INSERT OR UPDATE OF condition_node_id ON receipt_record FOR EACH ROW EXECUTE FUNCTION trg_assert_md_node(
  'condition_node_id', 'SAMPLE_CONDITION', '');
CREATE TRIGGER trg_assert_md_node BEFORE INSERT OR UPDATE OF condition_node_id ON receipt_package FOR EACH ROW EXECUTE FUNCTION trg_assert_md_node(
  'condition_node_id', 'SAMPLE_CONDITION', '');
CREATE TRIGGER trg_assert_md_node BEFORE INSERT OR UPDATE OF reason_node_id ON hold_case FOR EACH ROW EXECUTE FUNCTION trg_assert_md_node(
  'reason_node_id', 'HOLD_REASON', '');
CREATE TRIGGER trg_assert_md_node BEFORE INSERT OR UPDATE OF type_node_id ON dispute FOR EACH ROW EXECUTE FUNCTION trg_assert_md_node(
  'type_node_id', 'DISPUTE_TYPE', '');
CREATE TRIGGER trg_assert_md_node BEFORE INSERT OR UPDATE OF reason_code_node_id ON refund FOR EACH ROW EXECUTE FUNCTION trg_assert_md_node(
  'reason_code_node_id', 'REFUND_REASON', '');

-- ===================================================================
-- C-13, C-58  price lists
-- ===================================================================
CREATE FUNCTION trg_price_list_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_ignore text[] := ARRAY['status', 'effective_to', 'updated_at', 'lock_version'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'a % price list cannot be deleted', OLD.status USING ERRCODE = 'LC003';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('SUPERSEDED', 'DISCARDED') THEN
    RAISE EXCEPTION 'a % price list cannot be changed', OLD.status USING ERRCODE = 'LC003';
  END IF;
  IF OLD.status = 'PUBLISHED'
     AND NOT (NEW.status = 'SUPERSEDED' AND (to_jsonb(NEW) - v_ignore) = (to_jsonb(OLD) - v_ignore)) THEN
    RAISE EXCEPTION 'a published price list can only be superseded' USING ERRCODE = 'LC003';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_price_list_immutable BEFORE UPDATE OR DELETE ON price_list
  FOR EACH ROW EXECUTE FUNCTION trg_price_list_immutable();

CREATE FUNCTION trg_price_item_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_list price_list%ROWTYPE;
BEGIN
  SELECT * INTO v_list FROM price_list WHERE id = COALESCE(NEW.price_list_id, OLD.price_list_id);
  IF v_list.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'items of a % price list cannot be changed', v_list.status USING ERRCODE = 'LC003';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM scope_line WHERE id = NEW.scope_line_id AND lab_site_id = v_list.lab_site_id) THEN
    RAISE EXCEPTION 'the scope line is not on the site of the price list' USING ERRCODE = 'LC004';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_price_item_guard BEFORE INSERT OR UPDATE OR DELETE ON price_item
  FOR EACH ROW EXECUTE FUNCTION trg_price_item_guard();

-- ===================================================================
-- C-09, C-43  booking status guard and frozen totals
-- ===================================================================
CREATE FUNCTION trg_booking_status_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_transition text := NULLIF(current_setting('app.transition_id', true), '');
  v_from booking_status := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    IF v_transition IS NULL THEN
      RAISE EXCEPTION 'booking status can only be changed by the booking engine (app.transition_id is not set)'
        USING ERRCODE = 'LC002';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM booking_transition
       WHERE transition_id = v_transition AND from_status IS NOT DISTINCT FROM v_from AND to_status = NEW.status
    ) THEN
      RAISE EXCEPTION 'transition % does not lead from % to %', v_transition, COALESCE(v_from::text, '(new)'), NEW.status
        USING ERRCODE = 'LC002';
    END IF;
    NEW.status_changed_at := now();
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'REQUESTED'
     AND (NEW.subtotal_paise, NEW.gst_paise, NEW.platform_fee_paise, NEW.total_paise)
         IS DISTINCT FROM (OLD.subtotal_paise, OLD.gst_paise, OLD.platform_fee_paise, OLD.total_paise) THEN
    RAISE EXCEPTION 'booking totals are frozen once the booking is no longer REQUESTED' USING ERRCODE = 'LC003';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_booking_status_guard BEFORE INSERT OR UPDATE ON booking
  FOR EACH ROW EXECUTE FUNCTION trg_booking_status_guard();

-- ===================================================================
-- C-11, C-46  booking lines
-- ===================================================================
CREATE FUNCTION trg_booking_line_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_booking booking%ROWTYPE;
  v_frozen text[] := ARRAY['line_no', 'scope_line_id', 'scope_line_version_id', 'price_item_id', 'snapshot',
                           'unit_price_paise', 'sample_prep_paise', 'gst_rate_bp', 'gst_paise', 'line_total_paise'];
  k text;
BEGIN
  SELECT * INTO v_booking FROM booking WHERE id = COALESCE(NEW.booking_id, OLD.booking_id);
  IF v_booking.status <> 'REQUESTED' THEN
    IF TG_OP IN ('INSERT', 'DELETE') THEN
      RAISE EXCEPTION 'lines cannot be added or removed once the booking is no longer REQUESTED' USING ERRCODE = 'LC003';
    END IF;
    FOREACH k IN ARRAY v_frozen LOOP
      IF (to_jsonb(NEW) -> k) IS DISTINCT FROM (to_jsonb(OLD) -> k) THEN
        RAISE EXCEPTION 'booking_line.% is frozen once the booking is no longer REQUESTED', k USING ERRCODE = 'LC003';
      END IF;
    END LOOP;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM scope_line WHERE id = NEW.scope_line_id AND lab_site_id = v_booking.lab_site_id) THEN
    RAISE EXCEPTION 'the scope line is not on the lab site of the booking' USING ERRCODE = 'LC004';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM price_item
     WHERE id = NEW.price_item_id AND price_list_id = v_booking.price_list_id AND scope_line_id = NEW.scope_line_id
  ) THEN
    RAISE EXCEPTION 'the price item is not the price of this scope line in the price list of the booking' USING ERRCODE = 'LC004';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_booking_line_guard BEFORE INSERT OR UPDATE OR DELETE ON booking_line
  FOR EACH ROW EXECUTE FUNCTION trg_booking_line_guard();

-- ===================================================================
-- C-52, C-56, C-73  frozen once decided or released
-- ===================================================================
CREATE FUNCTION trg_receipt_record_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.decided_at IS NOT NULL THEN
    RAISE EXCEPTION 'a decided receipt record cannot be changed' USING ERRCODE = 'LC003';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_receipt_record_frozen BEFORE UPDATE ON receipt_record
  FOR EACH ROW EXECUTE FUNCTION trg_receipt_record_frozen();

CREATE FUNCTION trg_report_version_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_ignore text[] := ARRAY['status', 'superseded_by_version_id', 'updated_at', 'lock_version'];
BEGIN
  IF OLD.status = 'SUPERSEDED' THEN
    RAISE EXCEPTION 'a superseded report version cannot be changed' USING ERRCODE = 'LC003';
  END IF;
  IF OLD.status = 'RELEASED'
     AND NOT (NEW.status = 'SUPERSEDED' AND NEW.superseded_by_version_id IS NOT NULL
              AND (to_jsonb(NEW) - v_ignore) = (to_jsonb(OLD) - v_ignore)) THEN
    RAISE EXCEPTION 'a released report version can only be superseded' USING ERRCODE = 'LC003';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_report_version_frozen BEFORE UPDATE ON report_version
  FOR EACH ROW EXECUTE FUNCTION trg_report_version_frozen();

CREATE FUNCTION trg_dispute_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_ignore text[] := ARRAY['status', 'updated_at', 'lock_version'];
BEGIN
  IF OLD.decided_at IS NOT NULL
     AND NOT (NEW.status IN (OLD.status, 'CLOSED') AND (to_jsonb(NEW) - v_ignore) = (to_jsonb(OLD) - v_ignore)) THEN
    RAISE EXCEPTION 'a decided dispute can only be closed' USING ERRCODE = 'LC003';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_dispute_frozen BEFORE UPDATE ON dispute
  FOR EACH ROW EXECUTE FUNCTION trg_dispute_frozen();

-- ===================================================================
-- C-30  report parameters are a subset of the active booking lines (BR-061)
-- ===================================================================
CREATE FUNCTION trg_report_parameter_line_active() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM booking_line WHERE id = NEW.booking_line_id AND status = 'CANCELLED') THEN
    RAISE EXCEPTION 'a cancelled booking line cannot be reported' USING ERRCODE = 'LC004';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_report_parameter_line_active BEFORE INSERT OR UPDATE ON report_parameter_result
  FOR EACH ROW EXECUTE FUNCTION trg_report_parameter_line_active();

-- ===================================================================
-- C-65  a payment order charges exactly the booking total
-- ===================================================================
CREATE FUNCTION trg_payment_order_amount() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_total bigint;
BEGIN
  SELECT total_paise INTO v_total FROM booking WHERE id = NEW.booking_id;
  IF NEW.amount_paise <> v_total THEN
    RAISE EXCEPTION 'payment order amount % differs from the booking total %', NEW.amount_paise, v_total
      USING ERRCODE = 'LC004';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_payment_order_amount BEFORE INSERT OR UPDATE OF amount_paise, booking_id ON payment_order
  FOR EACH ROW EXECUTE FUNCTION trg_payment_order_amount();

-- ===================================================================
-- C-19  refunds never exceed what was captured, counting refunds in flight
-- ===================================================================
CREATE FUNCTION trg_refund_cap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_captured bigint;
  v_refunds bigint;
BEGIN
  -- Serialise refunds of one payment order.
  PERFORM 1 FROM payment_order WHERE id = NEW.payment_order_id FOR UPDATE;
  SELECT COALESCE(SUM(amount_paise), 0) INTO v_captured
    FROM payment_transaction
   WHERE payment_order_id = NEW.payment_order_id AND txn_type = 'CAPTURE' AND status = 'SUCCESS' AND NOT is_duplicate;
  SELECT COALESCE(SUM(amount_paise), 0) INTO v_refunds
    FROM refund
   WHERE payment_order_id = NEW.payment_order_id AND status <> 'FAILED' AND id <> NEW.id;
  IF NEW.status <> 'FAILED' THEN
    v_refunds := v_refunds + NEW.amount_paise;
  END IF;
  IF v_refunds > v_captured THEN
    RAISE EXCEPTION 'refunds of % would exceed the captured amount %', v_refunds, v_captured USING ERRCODE = 'LC004';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_refund_cap BEFORE INSERT OR UPDATE OF amount_paise, status, payment_order_id ON refund
  FOR EACH ROW EXECUTE FUNCTION trg_refund_cap();

-- ===================================================================
-- C-18  every journal balances, checked at commit
-- ===================================================================
CREATE FUNCTION trg_ledger_journal_balanced() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_debit numeric;
  v_credit numeric;
BEGIN
  SELECT COALESCE(SUM(debit_paise), 0), COALESCE(SUM(credit_paise), 0) INTO v_debit, v_credit
    FROM ledger_entry WHERE journal_id = NEW.journal_id;
  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'ledger journal % does not balance: debit %, credit %', NEW.journal_id, v_debit, v_credit
      USING ERRCODE = 'LC004';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER trg_ledger_journal_balanced AFTER INSERT ON ledger_entry
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_ledger_journal_balanced();
