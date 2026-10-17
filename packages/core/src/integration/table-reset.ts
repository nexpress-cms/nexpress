/**
 * Preserve TRUNCATE isolation without rewriting an already empty heap. Lock the
 * complete FK/inheritance closure before inspecting physical storage: row-count
 * estimates or a SELECT through RLS cannot establish that a table is empty.
 * Nonempty heaps include deleted/rolled-back tuples, so those are truncated too.
 * Owned sequences are always reset; custom TRUNCATE triggers retain the exact
 * original full-table command and its trigger order.
 */
export function createIntegrationTruncateSql(tables: readonly string[]): string {
  const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const roots = tables.map((t) => `'${identifier(t).replaceAll("'", "''")}'::regclass`).join(", ");
  const all = tables.map(identifier).join(", ");
  let delimiter = "$np_integration_reset$";
  while (roots.includes(delimiter) || all.includes(delimiter)) {
    delimiter = delimiter.slice(0, -1) + "_x$";
  }
  return `DO ${delimiter}
DECLARE
  targets oid[] := ARRAY[${roots}]::oid[];
  expanded oid[];
  locked_names text;
  selected_names text;
BEGIN
  -- Repeat discovery under the locks: DDL may have added a referencing table
  -- before its parent was locked. Every inspected relation must be locked.
  LOOP
    SELECT string_agg(t::regclass::text, ', ' ORDER BY t)
      INTO locked_names FROM unnest(targets) t;
    EXECUTE 'LOCK TABLE ' || locked_names || ' IN ACCESS EXCLUSIVE MODE';
    WITH RECURSIVE edges(parent, child) AS (
      SELECT confrelid, conrelid FROM pg_constraint WHERE contype = 'f'
      UNION
      SELECT inhparent, inhrelid FROM pg_inherits
    ), closure(id) AS (
      SELECT unnest(targets)
      UNION
      SELECT e.child FROM edges e JOIN closure c ON c.id = e.parent
    )
    SELECT array_agg(id ORDER BY id) INTO expanded FROM closure;
    EXIT WHEN expanded <@ targets;
    targets := expanded;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = ANY(targets) AND (tgtype::integer & 32) <> 0 AND tgenabled <> 'D'
  ) THEN
    selected_names := '${all.replaceAll("'", "''")}';
  ELSE
    -- Zero heap bytes prove there can be no retained tuple. An unknown storage
    -- kind/size and every owned sequence stay in the reset conservatively.
    SELECT string_agg(c.oid::regclass::text, ', ' ORDER BY c.oid)
      INTO selected_names
      FROM pg_class c
     WHERE c.oid = ANY(targets)
       AND (c.relkind <> 'r'
         OR c.relam <> (SELECT oid FROM pg_am WHERE amname = 'heap')
         OR coalesce(pg_relation_size(c.oid), 1) > 0
         OR EXISTS (
           SELECT 1 FROM pg_depend d JOIN pg_class seq ON seq.oid = d.objid AND seq.relkind = 'S'
           WHERE d.refclassid = 'pg_class'::regclass AND d.refobjid = c.oid
             AND d.classid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
         ));
  END IF;
  IF selected_names IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE ' || selected_names || ' RESTART IDENTITY CASCADE';
  END IF;
END
${delimiter};`;
}
