/**
 * Migration-owned SQL. None of these definitions initialize Agent services or
 * the job journal. Row guards also lock the barrier because PostgreSQL clones
 * row, but not statement, triggers onto newly attached job partitions.
 */
export const NP_AGENT_REFERENCE_FENCE_SQL_V1 = `
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
  bound_owner boolean := false;
  audit_metadata_update boolean := false;
  action_detachment boolean := false;
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

  bound_owner_kind := CASE WHEN TG_TABLE_SCHEMA='public' THEN CASE TG_TABLE_NAME
    WHEN 'np_audit_events' THEN 'runtime-audit'
    WHEN 'np_agent_actions' THEN 'read-action'
    WHEN 'np_agent_invocations' THEN 'read-invocation'
    ELSE NULL END ELSE NULL END;
  IF TG_OP <> 'INSERT' AND bound_owner_kind IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.np_agent_source_release_edges e
      WHERE e.owner_kind=bound_owner_kind AND e.owner_id=(previous_body->>'id')::uuid
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
          AND previous_body->>'idempotency_key'=
            'runtime:'||r.source_id::text||':'||(previous_body->>'sequence')
          AND e.owner_kind='read-action' AND e.owner_id=(previous_body->>'id')::uuid
          AND e.edge_code='action-run'
      ) INTO action_detachment;
    END IF;
    IF NOT audit_metadata_update AND NOT action_detachment THEN
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
  ELSIF action_detachment THEN
    -- The exact owner-bound runtime:<Run>:<sequence> key remains immutable
    -- history. No other occurrence or key shape receives this exemption.
    reference_body := reference_body-'idempotency_key';
  ELSIF TG_OP='UPDATE' AND NOT action_detachment THEN
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

function identifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/u.test(value)) throw new Error("Invalid reference guard table.");
  return `"${value}"`;
}

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** Compare persisted bodies as well as names: CREATE OR REPLACE keeps the OID. */
function expectedFunctionRows(): string {
  const definitions = [
    ...NP_AGENT_REFERENCE_FENCE_SQL_V1.matchAll(
      /CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)\(\)\nRETURNS (void|trigger)[^$]+\$np\$([\s\S]*?)\$np\$;/gu,
    ),
  ];
  if (definitions.length !== 4) throw new Error("Invalid reference guard function inventory.");
  return definitions
    .map(
      (definition) =>
        `(${literal(definition[1])},${literal(definition[2])},${literal(definition[3])})`,
    )
    .join(",");
}

/** Called only by reviewed migrations with the canonical table inventory. */
export function npAgentReferenceFenceTriggersSqlV1(tableName: string): string {
  const table = `public.${identifier(tableName)}`;
  if (tableName === "np_agent_reference_fence") throw new Error("Cannot guard the fence itself.");
  const receipt = ["np_agent_source_releases", "np_agent_source_release_edges"].includes(tableName);
  return `CREATE OR REPLACE TRIGGER np_agent_reference_statement_v1
BEFORE INSERT OR UPDATE OR DELETE ON ${table}
FOR EACH STATEMENT EXECUTE FUNCTION public.np_agent_reference_statement_v1();
CREATE OR REPLACE TRIGGER np_agent_reference_row_v1
BEFORE INSERT OR UPDATE OR DELETE ON ${table}
FOR EACH ROW EXECUTE FUNCTION public.np_agent_reference_row_v1();${
    receipt
      ? `
DROP TRIGGER IF EXISTS np_agent_reference_receipt_delete_v1 ON ${table};
CREATE CONSTRAINT TRIGGER np_agent_reference_receipt_delete_v1
AFTER DELETE ON ${table} DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.np_agent_reference_receipt_delete_v1();`
      : ""
  }`;
}

/**
 * One atomic pg-boss-owned statement, after its journal/queue creation. It does
 * nothing on an older CMS schema and never creates the journal or framework
 * tables. Parent row guards protect later partitions before this installer
 * supplies their missing statement guards.
 */
export const NP_AGENT_JOB_REFERENCE_FENCE_INSTALL_SQL_V1 = `DO $np$
DECLARE target record;
BEGIN
  IF to_regclass('public.np_agent_reference_fence') IS NULL OR
    to_regprocedure('public.np_agent_reference_row_v1()') IS NULL OR
    to_regclass('pgboss.job') IS NULL THEN RETURN; END IF;
  LOCK TABLE pgboss.job IN SHARE ROW EXCLUSIVE MODE;
  CREATE OR REPLACE TRIGGER np_agent_reference_row_v1
    BEFORE INSERT OR UPDATE OR DELETE ON pgboss.job
    FOR EACH ROW EXECUTE FUNCTION public.np_agent_reference_row_v1();
  FOR target IN
    WITH RECURSIVE family AS (
      SELECT 'pgboss.job'::regclass::oid AS id
      UNION SELECT i.inhrelid FROM pg_inherits i JOIN family f ON i.inhparent=f.id
    ) SELECT n.nspname, c.relname FROM family f
      JOIN pg_class c ON c.oid=f.id JOIN pg_namespace n ON n.oid=c.relnamespace
      ORDER BY c.oid
  LOOP
    EXECUTE format('CREATE OR REPLACE TRIGGER np_agent_reference_statement_v1
      BEFORE INSERT OR UPDATE OR DELETE ON %I.%I FOR EACH STATEMENT
      EXECUTE FUNCTION public.np_agent_reference_statement_v1()', target.nspname, target.relname);
  END LOOP;
END
$np$;`;

/** Caller first checks relation readiness; maintenance also locks job topology. */
export function npAgentReferenceFenceCoverageSqlV1(tableNames: readonly string[]): string {
  if (!tableNames.length) throw new Error("Reference guard inventory must not be empty.");
  for (const name of tableNames) identifier(name);
  const rows = [...new Set(tableNames)].map((name) => `('public.${name}')`).join(",");
  return `WITH RECURSIVE job_family AS (
  SELECT to_regclass('pgboss.job')::oid AS id
  UNION SELECT i.inhrelid FROM pg_inherits i JOIN job_family f ON i.inhparent=f.id
), expected AS (
  SELECT to_regclass(name)::oid AS id FROM (VALUES ${rows}) ordinary(name)
  UNION SELECT id FROM job_family WHERE id IS NOT NULL
), missing AS (
  SELECT 1 FROM expected e CROSS JOIN (VALUES
    ('np_agent_reference_statement_v1',30),('np_agent_reference_row_v1',31)
  ) required(name,bits)
  WHERE e.id IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_trigger t WHERE t.tgrelid=e.id AND t.tgname=required.name
      AND t.tgtype=required.bits AND t.tgenabled IN ('O','A')
      AND t.tgfoid=to_regprocedure('public.'||required.name||'()')
  )
  UNION ALL SELECT 1 WHERE NOT EXISTS (
    SELECT 1 FROM public.np_agent_reference_fence WHERE id=1 AND epoch>=0
  )
  UNION ALL SELECT 1 FROM (VALUES ${expectedFunctionRows()}) functions(name,result,body)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
    WHERE p.oid=to_regprocedure('public.'||functions.name||'()')
      AND p.prosrc=functions.body AND p.prorettype=to_regtype(functions.result)
      AND p.provolatile='v' AND p.prokind='f' AND NOT p.prosecdef
      AND NOT p.proleakproof AND p.proparallel='u' AND l.lanname='plpgsql'
      AND p.proconfig=ARRAY['search_path=pg_catalog, public']::text[]
  )
  UNION ALL SELECT 1 FROM (VALUES
    ('public.np_agent_source_releases'),('public.np_agent_source_release_edges')
  ) receipts(name) WHERE NOT EXISTS (
    SELECT 1 FROM pg_trigger t WHERE t.tgrelid=to_regclass(receipts.name)
      AND t.tgname='np_agent_reference_receipt_delete_v1' AND t.tgtype=9
      AND t.tgenabled IN ('O','A') AND t.tgdeferrable AND t.tginitdeferred
      AND t.tgfoid=to_regprocedure('public.np_agent_reference_receipt_delete_v1()')
  )
) SELECT count(*)::text AS missing_count FROM missing`;
}
