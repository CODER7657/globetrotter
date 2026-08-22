-- ============================================================================
-- _harness.sql — a 40-line assertion harness.
--
-- Deliberately not pgTAP: pgTAP is a compiled extension that is not in the
-- pgvector image, and adding a build step to CI to test four constraints is a
-- bad trade. Everything below is plain PL/pgSQL and runs anywhere.
--
-- Each assertion runs the statement in a subtransaction, so a deliberate
-- failure does not poison the session.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS test;

DROP TABLE IF EXISTS test.results;
CREATE TABLE test.results (
  id     serial PRIMARY KEY,
  label  text    NOT NULL,
  passed boolean NOT NULL,
  detail text
);

-- Assert that `stmt` fails with exactly `expected` SQLSTATE.
CREATE OR REPLACE FUNCTION test.expect_error(stmt text, expected text, label text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE got text;
BEGIN
  BEGIN
    EXECUTE stmt;
    INSERT INTO test.results(label, passed, detail)
      VALUES (label, false, format('expected SQLSTATE %s, but the statement SUCCEEDED', expected));
    RETURN;
  EXCEPTION WHEN others THEN
    got := SQLSTATE;
  END;

  INSERT INTO test.results(label, passed, detail)
    VALUES (label, got = expected,
            CASE WHEN got = expected THEN got
                 ELSE format('expected %s, got %s', expected, got) END);
END $$;

-- Assert that `stmt` succeeds.
CREATE OR REPLACE FUNCTION test.expect_ok(stmt text, label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN others THEN
    INSERT INTO test.results(label, passed, detail)
      VALUES (label, false, format('expected success, got %s: %s', SQLSTATE, SQLERRM));
    RETURN;
  END;
  INSERT INTO test.results(label, passed, detail) VALUES (label, true, 'ok');
END $$;

-- Assert a scalar query equals an expected value.
CREATE OR REPLACE FUNCTION test.expect_eq(query text, expected text, label text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE got text;
BEGIN
  EXECUTE query INTO got;
  INSERT INTO test.results(label, passed, detail)
    VALUES (label, got IS NOT DISTINCT FROM expected,
            CASE WHEN got IS NOT DISTINCT FROM expected THEN 'ok'
                 ELSE format('expected %L, got %L', expected, got) END);
EXCEPTION WHEN others THEN
  INSERT INTO test.results(label, passed, detail)
    VALUES (label, false, format('query raised %s: %s', SQLSTATE, SQLERRM));
END $$;

-- Print the report and fail the process if anything did not pass.
CREATE OR REPLACE FUNCTION test.report() RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record; failed int; total int;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM test.results;
  FOR r IN SELECT * FROM test.results ORDER BY id LOOP
    RAISE NOTICE '%  %  %',
      CASE WHEN r.passed THEN 'PASS' ELSE 'FAIL' END,
      rpad(r.label, 58),
      r.detail;
  END LOOP;
  RAISE NOTICE '─────────────────────────────────────────────────────────────';
  IF failed > 0 THEN
    RAISE EXCEPTION '% of % assertions FAILED', failed, total;
  END IF;
  RAISE NOTICE 'all % assertions passed', total;
END $$;
