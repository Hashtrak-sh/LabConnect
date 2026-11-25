-- P3-02: cancelling timers from the API role. Hand-written.
--
-- Why: row-level security lets any request INSERT a timer, but SELECT and UPDATE only in
-- the system context (migration 20261124090500). The API (app_rw, tenant context) must
-- cancel the timers of a booking when it leaves a state, for example when the lab accepts
-- before LAB_DECISION_DUE. An UPDATE from that context silently touches zero rows.
-- Loosening the UPDATE policy would let any request rewrite any column of any timer, and
-- Postgres cannot restrict a policy to a status transition. So the cancel is two narrow
-- SECURITY DEFINER functions that can only move PENDING -> CANCELLED and nothing else.
-- The tables and policies are unchanged.

CREATE FUNCTION cancel_timer(p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE timer SET status = 'CANCELLED', lock_version = lock_version + 1
   WHERE id = p_id AND status = 'PENDING';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

-- p_types NULL cancels every pending timer of the aggregate.
CREATE FUNCTION cancel_timers(p_aggregate_type text, p_aggregate_id uuid, p_types timer_type[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE timer SET status = 'CANCELLED', lock_version = lock_version + 1
   WHERE aggregate_type = p_aggregate_type AND aggregate_id = p_aggregate_id
     AND status = 'PENDING' AND (p_types IS NULL OR timer_type = ANY (p_types));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

REVOKE ALL ON FUNCTION cancel_timer(uuid), cancel_timers(text, uuid, timer_type[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_timer(uuid), cancel_timers(text, uuid, timer_type[]) TO app_rw, app_worker;
