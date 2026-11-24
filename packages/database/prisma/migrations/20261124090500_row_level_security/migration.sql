-- Row-level security: defence in depth for tenant isolation (ADR-005,
-- docs/02-architecture/TENANT_ISOLATION.md section 3). Hand-written.
--
-- The application sets, per transaction (SET LOCAL):
--   app.org_id       the organisation of the active membership
--   app.user_id      the signed-in user
--   app.is_platform  'true' for platform staff
--   app.is_system    'true' for worker and SYSTEM jobs (and pre-login identity lookups)
--
-- Policies apply to app_rw and app_worker. The owner role that runs migrations is not
-- subject to them (no FORCE ROW LEVEL SECURITY): the SECURITY DEFINER validation
-- triggers must see every row to do their job. The owner role is never used by the
-- application.
--
-- Whether Prisma + SET LOCAL + connection pooling carries these settings reliably is
-- the subject of the P1-08 spike. Until then repositories remain the primary control.

-- ===================================================================
-- Helpers. An unset or empty setting means "no access": on a pooled connection a
-- setting that was used earlier comes back as '' rather than NULL.
-- ===================================================================
CREATE FUNCTION app_org_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.org_id', true), '')::uuid $$;

CREATE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION app_is_platform() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('app.is_platform', true), '') = 'true', false) $$;

CREATE FUNCTION app_is_system() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('app.is_system', true), '') = 'true', false) $$;

-- Platform staff or a system job.
CREATE FUNCTION app_is_privileged() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT app_is_platform() OR app_is_system() $$;

-- One of the two parties of a booking, or privileged.
CREATE FUNCTION app_is_party(customer_org uuid, lab_org uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app_is_privileged() OR customer_org = app_org_id() OR lab_org = app_org_id()
$$;

-- The owning organisation, or privileged.
CREATE FUNCTION app_is_org(org uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT app_is_privileged() OR org = app_org_id() $$;

GRANT EXECUTE ON FUNCTION app_org_id(), app_user_id(), app_is_platform(), app_is_system(), app_is_privileged(),
  app_is_party(uuid, uuid), app_is_org(uuid) TO app_rw, app_worker, app_ro;

-- ===================================================================
-- Shared transactional tables: both parties of the booking (+TK tables)
-- ===================================================================
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'booking','booking_line','trf','booking_status_history','counter_offer','slot_hold','package','custody_event',
    'custody_event_photo','receipt_record','receipt_package','hold_case','label_print','report','report_version',
    'report_parameter_result','report_share_link','report_access_log','payment_order','payment_transaction',
    'refund','payout_item','payout_hold','financial_document','dispute','dispute_evidence'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_parties ON %I USING (app_is_party(customer_org_id, lab_org_id)) WITH CHECK (app_is_party(customer_org_id, lab_org_id))',
      t);
  END LOOP;
END
$$;

-- Narrower than "both parties" (review finding E-05).
ALTER TABLE dispute_message ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_parties ON dispute_message
  USING (app_is_privileged() OR (visibility = 'ALL' AND (customer_org_id = app_org_id() OR lab_org_id = app_org_id())))
  WITH CHECK (app_is_privileged() OR (visibility = 'ALL' AND (customer_org_id = app_org_id() OR lab_org_id = app_org_id())));

ALTER TABLE rating ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_parties ON rating
  USING (app_is_privileged() OR lab_org_id = app_org_id() OR (customer_org_id = app_org_id() AND direction = 'CUSTOMER_TO_LAB'))
  WITH CHECK (app_is_privileged() OR lab_org_id = app_org_id() OR (customer_org_id = app_org_id() AND direction = 'CUSTOMER_TO_LAB'));

ALTER TABLE break_glass_grant ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_only ON break_glass_grant USING (app_is_privileged()) WITH CHECK (app_is_privileged());

-- Journals carry tenant keys only when they belong to a booking.
ALTER TABLE ledger_journal ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_parties ON ledger_journal
  USING (app_is_party(customer_org_id, lab_org_id)) WITH CHECK (app_is_privileged());

-- ===================================================================
-- Tables owned by one organisation
-- ===================================================================
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organisation_private','invitation','customer_site','customer_settings','kyc_document','bank_account',
    'lab_claim_request','lab_site_private','slot_template','notification'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_org ON %I USING (app_is_org(organisation_id)) WITH CHECK (app_is_org(organisation_id))', t);
  END LOOP;
END
$$;

ALTER TABLE payout ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_org ON payout USING (app_is_org(lab_org_id)) WITH CHECK (app_is_privileged());

ALTER TABLE lab_penalty ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_org ON lab_penalty USING (app_is_org(lab_org_id)) WITH CHECK (app_is_privileged());

ALTER TABLE document_series ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_org ON document_series USING (app_is_org(issuer_org_id)) WITH CHECK (app_is_org(issuer_org_id));

ALTER TABLE import_job ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_org ON import_job
  USING (app_is_privileged() OR organisation_id = app_org_id())
  WITH CHECK (app_is_privileged() OR organisation_id = app_org_id());

ALTER TABLE import_row ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_org ON import_row
  USING (app_is_privileged() OR organisation_id = app_org_id())
  WITH CHECK (app_is_privileged() OR organisation_id = app_org_id());

-- Platform templates (no owner) are readable by everyone; a lab's own templates only by that lab.
ALTER TABLE import_mapping_template ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_org ON import_mapping_template
  USING (app_is_privileged() OR owner_org_id IS NULL OR owner_org_id = app_org_id())
  WITH CHECK (app_is_privileged() OR owner_org_id = app_org_id());

-- ===================================================================
-- Price lists: drafts are private to the lab, published lists are public
-- ===================================================================
ALTER TABLE price_list ENABLE ROW LEVEL SECURITY;
CREATE POLICY price_list_visibility ON price_list
  USING (status IN ('PUBLISHED', 'SUPERSEDED') OR app_is_org(organisation_id))
  WITH CHECK (app_is_org(organisation_id));

ALTER TABLE price_item ENABLE ROW LEVEL SECURITY;
CREATE POLICY price_item_visibility ON price_item
  USING (app_is_org(organisation_id) OR EXISTS (SELECT 1 FROM price_list l WHERE l.id = price_item.price_list_id))
  WITH CHECK (app_is_org(organisation_id));

-- ===================================================================
-- Master-data change sets: the platform, and the lab that proposed the set (E-09)
-- ===================================================================
ALTER TABLE md_change_set ENABLE ROW LEVEL SECURITY;
CREATE POLICY change_set_visibility ON md_change_set
  USING (app_is_privileged() OR proposed_by_org_id = app_org_id())
  WITH CHECK (app_is_privileged() OR proposed_by_org_id = app_org_id());

ALTER TABLE md_change_item ENABLE ROW LEVEL SECURITY;
CREATE POLICY change_item_visibility ON md_change_item
  USING (EXISTS (SELECT 1 FROM md_change_set s WHERE s.id = md_change_item.change_set_id))
  WITH CHECK (EXISTS (SELECT 1 FROM md_change_set s WHERE s.id = md_change_item.change_set_id));

-- ===================================================================
-- Files: the owner or either booking party. The API still checks the owning entity (E-07).
-- ===================================================================
ALTER TABLE file_object ENABLE ROW LEVEL SECURITY;
CREATE POLICY file_visibility ON file_object
  USING (app_is_privileged() OR owner_org_id = app_org_id() OR customer_org_id = app_org_id() OR lab_org_id = app_org_id())
  WITH CHECK (app_is_privileged() OR owner_org_id = app_org_id());

ALTER TABLE file_link ENABLE ROW LEVEL SECURITY;
CREATE POLICY file_link_visibility ON file_link
  USING (EXISTS (SELECT 1 FROM file_object f WHERE f.id = file_link.file_id))
  WITH CHECK (EXISTS (SELECT 1 FROM file_object f WHERE f.id = file_link.file_id));

-- ===================================================================
-- Identity
-- ===================================================================
ALTER TABLE membership ENABLE ROW LEVEL SECURITY;
CREATE POLICY membership_visibility ON membership
  USING (app_is_privileged() OR organisation_id = app_org_id() OR user_id = app_user_id())
  WITH CHECK (app_is_privileged() OR organisation_id = app_org_id());

ALTER TABLE membership_role ENABLE ROW LEVEL SECURITY;
CREATE POLICY membership_visibility ON membership_role
  USING (EXISTS (SELECT 1 FROM membership m WHERE m.id = membership_role.membership_id))
  WITH CHECK (EXISTS (SELECT 1 FROM membership m WHERE m.id = membership_role.membership_id AND (app_is_privileged() OR m.organisation_id = app_org_id())));

ALTER TABLE membership_site ENABLE ROW LEVEL SECURITY;
CREATE POLICY membership_visibility ON membership_site
  USING (EXISTS (SELECT 1 FROM membership m WHERE m.id = membership_site.membership_id))
  WITH CHECK (EXISTS (SELECT 1 FROM membership m WHERE m.id = membership_site.membership_id AND (app_is_privileged() OR m.organisation_id = app_org_id())));

ALTER TABLE invitation_site ENABLE ROW LEVEL SECURITY;
CREATE POLICY invitation_visibility ON invitation_site
  USING (EXISTS (SELECT 1 FROM invitation i WHERE i.id = invitation_site.invitation_id))
  WITH CHECK (EXISTS (SELECT 1 FROM invitation i WHERE i.id = invitation_site.invitation_id));

-- A user sees themselves and the members of the active organisation. Names of the
-- other party's users (for example the Checker shown on a report) are served by the
-- API from snapshots or under a system scope, never by widening this policy.
ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_visibility ON app_user
  USING (app_is_privileged() OR id = app_user_id()
         OR EXISTS (SELECT 1 FROM membership m WHERE m.user_id = app_user.id AND m.organisation_id = app_org_id()))
  WITH CHECK (app_is_privileged() OR id = app_user_id());

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mfa_factor', 'mfa_recovery_code', 'user_session', 'notification_preference'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY own_user ON %I USING (app_is_system() OR user_id = app_user_id()) WITH CHECK (app_is_system() OR user_id = app_user_id())',
      t);
  END LOOP;
END
$$;

-- The notification inbox is per recipient, not per organisation.
DROP POLICY tenant_org ON notification;
CREATE POLICY own_user ON notification
  USING (app_is_privileged() OR recipient_user_id = app_user_id())
  WITH CHECK (app_is_privileged());

ALTER TABLE idempotency_record ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_user ON idempotency_record
  USING (app_is_system() OR actor_user_id IS NOT DISTINCT FROM app_user_id())
  WITH CHECK (app_is_system() OR actor_user_id IS NOT DISTINCT FROM app_user_id());

-- ===================================================================
-- Platform and system only
-- ===================================================================
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'audit_log','audit_log_chain','otp_challenge','timer','processed_event','gateway_webhook_event',
    'settlement_report_line','ledger_account','ledger_entry','lead_request'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY platform_only ON %I USING (app_is_privileged()) WITH CHECK (app_is_privileged())', t);
  END LOOP;
END
$$;

-- Any request may write an audit row or schedule a timer; reading stays restricted.
DROP POLICY platform_only ON audit_log;
CREATE POLICY audit_read ON audit_log FOR SELECT USING (app_is_privileged());
CREATE POLICY audit_write ON audit_log FOR INSERT WITH CHECK (true);

DROP POLICY platform_only ON timer;
CREATE POLICY timer_read ON timer FOR SELECT USING (app_is_system());
CREATE POLICY timer_write ON timer FOR INSERT WITH CHECK (true);
CREATE POLICY timer_update ON timer FOR UPDATE USING (app_is_system()) WITH CHECK (app_is_system());

-- A visitor can leave a lead; only the platform reads them.
DROP POLICY platform_only ON lead_request;
CREATE POLICY lead_read ON lead_request FOR SELECT USING (app_is_privileged() OR requester_user_id = app_user_id());
CREATE POLICY lead_write ON lead_request FOR INSERT WITH CHECK (true);
CREATE POLICY lead_update ON lead_request FOR UPDATE USING (app_is_privileged()) WITH CHECK (app_is_privileged());

-- Outbox: inserts only for the API (it has no SELECT privilege either); the relay runs as a system job.
ALTER TABLE outbox_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY outbox_read ON outbox_event FOR SELECT USING (app_is_system());
CREATE POLICY outbox_write ON outbox_event FOR INSERT WITH CHECK (true);
CREATE POLICY outbox_update ON outbox_event FOR UPDATE USING (app_is_system()) WITH CHECK (app_is_system());
