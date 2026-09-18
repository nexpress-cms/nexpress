/** Frozen installed V3 migration; append upgrades in reference-fence-sql.ts. */
export const NP_AGENT_REFERENCE_FENCE_SQL_V3 = `
CREATE OR REPLACE FUNCTION public.np_agent_reference_lock_v1()
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public AS $np$
DECLARE current_epoch bigint;
BEGIN
  SELECT epoch INTO STRICT current_epoch
    FROM public.np_agent_reference_fence WHERE id=1 FOR SHARE;
  IF current_epoch < 0 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Agent reference fence is unavailable.';
  END IF;
EXCEPTION WHEN no_data_found OR too_many_rows THEN
  RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Agent reference fence is unavailable.';
END
$np$;

CREATE OR REPLACE FUNCTION public.np_agent_reference_statement_v1()
RETURNS trigger LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public AS $np$
BEGIN
  PERFORM public.np_agent_reference_lock_v1();
  RETURN NULL;
END
$np$;

CREATE OR REPLACE FUNCTION public.np_agent_reference_row_v1()
RETURNS trigger LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public AS $np$
DECLARE
  next_body jsonb;
  previous_body jsonb;
  reference_body jsonb;
  row_site text;
  bound_owner_kind text;
  bound_owner_kinds text[];
  invocation_metadata_update boolean := false;
  bound_owner boolean := false;
  audit_metadata_update boolean := false;
  action_detachment boolean := false;
  changeset_detachment boolean := false;
  has_released_reference boolean := false;
  reference_text text;
  reference_chunk text;
  reference_window text;
  carry text := '';
  scan_from integer := 1;
  match_at integer;
  incoming_id uuid;
BEGIN
  PERFORM public.np_agent_reference_lock_v1();
  IF TG_OP <> 'INSERT' THEN previous_body := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN next_body := to_jsonb(NEW); END IF;

  IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME IN
      ('np_agent_source_releases','np_agent_source_release_edges') THEN
    IF TG_OP='UPDATE' AND next_body IS DISTINCT FROM previous_body THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Agent source evidence is immutable.';
    END IF;
    -- The owning verifier checks these exact canonical historical records.
    -- Their source identities deliberately do not create new live references.
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- Once a cancelled draft source is released, its retained operations stay
  -- immutable and no lifecycle generation can begin using only the ChangeSet
  -- identity (without spelling the former Run identity).
  IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME IN (
    'np_agent_changeset_operations','np_agent_changeset_validation_attempts',
    'np_agent_changeset_previews','np_agent_changeset_executions',
    'np_agent_changeset_rollback_plans','np_agent_changeset_rollback_operations',
    'np_agent_approvals'
  ) AND (TG_OP<>'UPDATE' OR next_body IS DISTINCT FROM previous_body) THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(jsonb_build_array(previous_body,next_body)) b(body)
      JOIN public.np_agent_changesets c ON c.site_id=b.body->>'site_id'
        AND c.id=CASE WHEN TG_TABLE_NAME='np_agent_approvals' THEN
          COALESCE((b.body->>'target_changeset_id')::uuid,
            CASE WHEN b.body->>'target_kind'='changeset' THEN (b.body->>'target_id')::uuid END)
          ELSE (b.body->>'changeset_id')::uuid END
      WHERE c.run_source_release_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.np_agent_source_release_edges e
          WHERE e.site_id=c.site_id AND e.source_release_id=c.run_source_release_id
            AND e.owner_kind='changeset-source' AND e.owner_id=c.id)
    ) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Agent source evidence is retained.';
    END IF;
  END IF;

  bound_owner_kind := CASE WHEN TG_TABLE_SCHEMA='public' THEN CASE TG_TABLE_NAME
    WHEN 'np_audit_events' THEN 'runtime-audit'
    WHEN 'np_agent_actions' THEN 'read-action'
    WHEN 'np_agent_invocations' THEN 'read-invocation'
    WHEN 'np_agent_changesets' THEN 'changeset-source'
    ELSE NULL END ELSE NULL END;
  bound_owner_kinds := CASE bound_owner_kind
    WHEN 'runtime-audit' THEN ARRAY['runtime-audit','studio-audit','changeset-audit']
    WHEN 'read-invocation' THEN ARRAY['read-invocation','admin-invocation','changeset-invocation']
    WHEN 'read-action' THEN ARRAY['read-action','changeset-action']
    ELSE ARRAY[bound_owner_kind] END;
  IF TG_OP <> 'INSERT' AND bound_owner_kind IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.np_agent_source_release_edges e
      WHERE e.owner_kind=ANY(bound_owner_kinds) AND e.owner_id=(previous_body->>'id')::uuid
        AND e.site_id=previous_body->>'site_id'
    ) INTO bound_owner;
  END IF;
  IF TG_OP='DELETE' THEN
    IF bound_owner THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Agent source evidence is retained.';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP='UPDATE' AND bound_owner AND next_body IS DISTINCT FROM previous_body THEN
    audit_metadata_update := bound_owner_kind='runtime-audit' AND
      (next_body-'actor_user_id'-'actor_member_id') =
      (previous_body-'actor_user_id'-'actor_member_id');
    invocation_metadata_update := bound_owner_kind='read-invocation'
      AND next_body->'staff_user_id'='null'::jsonb
      AND previous_body->'staff_user_id'<>'null'::jsonb
      AND previous_body->'actor_deleted_at'='null'::jsonb
      AND next_body->'actor_deleted_at'<>'null'::jsonb
      AND (next_body-'staff_user_id'-'actor_deleted_at')=(previous_body-'staff_user_id'-'actor_deleted_at')
      AND EXISTS (SELECT 1 FROM public.np_agent_source_release_edges e
        WHERE e.site_id=previous_body->>'site_id'
          AND e.owner_id=(previous_body->>'id')::uuid
          AND e.owner_kind='admin-invocation');
    IF bound_owner_kind='read-action' AND previous_body->>'run_id' IS NOT NULL
      AND previous_body->>'run_source_release_id' IS NULL
      AND next_body->>'run_id' IS NULL
      AND (next_body-'run_id'-'run_source_release_id') =
        (previous_body-'run_id'-'run_source_release_id') THEN
      SELECT EXISTS (
        SELECT 1 FROM public.np_agent_source_releases r
        JOIN public.np_agent_source_release_edges e ON e.source_release_id=r.id AND e.site_id=r.site_id
        JOIN public.np_agent_runs live ON live.id=r.source_id AND live.site_id=r.site_id
        WHERE r.id=(next_body->>'run_source_release_id')::uuid
          AND r.site_id=previous_body->>'site_id' AND r.source_kind='runtime-run'
          AND r.source_id=(previous_body->>'run_id')::uuid
          AND r.evidence_body->>'admissionFingerprint'=previous_body->>'run_fingerprint'
          AND live.admission_fingerprint=previous_body->>'run_fingerprint'
          AND (e.owner_kind='changeset-action' OR (e.owner_kind='read-action'
            AND previous_body->>'idempotency_key'=
              'runtime:'||r.source_id::text||':'||(previous_body->>'sequence')))
          AND e.owner_id=(previous_body->>'id')::uuid
          AND e.edge_code='action-run'
      ) INTO action_detachment;
    END IF;
    IF bound_owner_kind='changeset-source' AND previous_body->>'run_id' IS NOT NULL
      AND previous_body->>'run_source_release_id' IS NULL
      AND next_body->>'run_id' IS NULL
      AND (next_body-'run_id'-'run_source_release_id') =
        (previous_body-'run_id'-'run_source_release_id') THEN
      SELECT EXISTS (
        SELECT 1 FROM public.np_agent_source_releases r
        JOIN public.np_agent_source_release_edges e ON e.source_release_id=r.id AND e.site_id=r.site_id
        JOIN public.np_agent_runs live ON live.id=r.source_id AND live.site_id=r.site_id
        WHERE r.id=(next_body->>'run_source_release_id')::uuid
          AND r.site_id=previous_body->>'site_id' AND r.source_kind='runtime-run'
          AND r.source_id=(previous_body->>'run_id')::uuid
          AND r.evidence_body->>'admissionFingerprint'=previous_body->>'run_fingerprint'
          AND live.admission_fingerprint=previous_body->>'run_fingerprint'
          AND e.owner_kind='changeset-source' AND e.owner_id=(previous_body->>'id')::uuid
          AND e.edge_code='changeset-run'
      ) INTO changeset_detachment;
    END IF;
    IF NOT audit_metadata_update AND NOT invocation_metadata_update
      AND NOT action_detachment AND NOT changeset_detachment THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Agent source evidence is immutable.';
    END IF;
  END IF;

  IF TG_TABLE_SCHEMA='pgboss' THEN
    reference_body := next_body->'data';
    row_site := reference_body->>'siteId';
  ELSE
    reference_body := next_body;
    row_site := next_body->>'site_id';
  END IF;
  IF audit_metadata_update THEN
    -- These two actor metadata columns are not part of audit release evidence.
    -- Still reject any new source reference in them; all other bytes are frozen.
    reference_body := jsonb_build_object('actor_user_id',next_body->'actor_user_id',
      'actor_member_id',next_body->'actor_member_id');
  ELSIF invocation_metadata_update THEN
    reference_body := jsonb_build_object('staff_user_id',next_body->'staff_user_id',
      'actor_deleted_at',next_body->'actor_deleted_at');
  ELSIF action_detachment THEN
    -- The exact owner-bound runtime:<Run>:<sequence> key remains immutable
    -- history. No other occurrence or key shape receives this exemption.
    IF previous_body->>'idempotency_key'=
      'runtime:'||(previous_body->>'run_id')||':'||(previous_body->>'sequence') THEN
      reference_body := reference_body-'idempotency_key';
    END IF;
  ELSIF TG_OP='UPDATE' AND NOT changeset_detachment THEN
    -- Looking only at NEW would let a caller erase the final historical UUID.
    reference_body := jsonb_build_array(reference_body,
      CASE WHEN TG_TABLE_SCHEMA='pgboss' THEN previous_body->'data' ELSE previous_body END);
  END IF;
  -- Match the conservative literal scanner, including keys and substrings.
  -- Advance from the match START, not its end: two UUID substrings can
  -- overlap, and regexp_matches(...,'g') would silently skip the second one.
  -- PostgreSQL regexp_instr processes its input on every call. Scan bounded
  -- windows to avoid quadratic work for dense UUID payloads. A 35-character
  -- carry covers every crossing 36-character UUID, without duplicating a full
  -- prior match. Each identity uses the source-id index, never a history scan.
  reference_text := reference_body::text;
  FOR reference_chunk IN
    SELECT matched[1] FROM regexp_matches(reference_text,'.{1,240}','gs') AS matched
  LOOP
    reference_window := carry||reference_chunk;
    scan_from := 1;
    LOOP
      match_at := regexp_instr(reference_window,
        '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', scan_from);
      EXIT WHEN match_at=0;
      incoming_id := substr(reference_window,match_at,36)::uuid;
      SELECT EXISTS (
        SELECT 1 FROM public.np_agent_source_releases r
        WHERE r.source_id=incoming_id AND (row_site IS NULL OR r.site_id=row_site)
      ) INTO has_released_reference;
      IF NOT has_released_reference AND TG_TABLE_SCHEMA='pgboss'
        AND next_body->>'state' IN ('created','retry','active') THEN
        -- ChangeSet-only work must not revive a released draft. Resolve the
        -- primary key first so global jobs also use bounded indexed lookups.
        SELECT EXISTS (
          SELECT 1 FROM public.np_agent_changesets c
          JOIN public.np_agent_source_release_edges e ON e.site_id=c.site_id
            AND e.owner_kind='changeset-source' AND e.owner_id=c.id
            AND e.source_release_id=c.run_source_release_id
          WHERE c.id=incoming_id AND (row_site IS NULL OR c.site_id=row_site)
        ) INTO has_released_reference;
      END IF;
      EXIT WHEN has_released_reference;
      scan_from := match_at+1;
    END LOOP;
    EXIT WHEN has_released_reference;
    carry := right(reference_window,35);
  END LOOP;
  IF has_released_reference AND NOT (TG_OP='UPDATE' AND next_body=previous_body) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Agent source reference is unavailable.';
  END IF;
  RETURN NEW;
END
$np$;

CREATE OR REPLACE FUNCTION public.np_agent_reference_receipt_delete_v1()
RETURNS trigger LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public AS $np$
BEGIN
  -- Deferred until transaction completion: only full site deletion can remove
  -- consumed keys or historical attribution. No session flag grants a bypass.
  IF EXISTS (SELECT 1 FROM public.np_sites WHERE id=OLD.site_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Agent source evidence is retained.';
  END IF;
  RETURN OLD;
END
$np$;
`;
