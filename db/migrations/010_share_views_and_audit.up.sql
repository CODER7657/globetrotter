-- ============================================================================
-- 010_share_views_and_audit — the two db/ gaps @Ayush3422 named in #55
-- ============================================================================

-- ── 1. view counting ────────────────────────────────────────────────────────
-- trip_shares_write is FOR ALL keyed on ownership, so an anonymous share
-- transaction UPDATEing view_count matches zero rows. RLS cannot express
-- "this role may increment this one column", which is a real limit of policies
-- as an authorization model rather than an oversight in 005.
--
-- His diagnosis was right and so was his proposed shape. Kept as written, and
-- he included the REVOKE FROM PUBLIC unprompted.
CREATE FUNCTION app.record_share_view(p_slug text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
  UPDATE trip_shares
     SET view_count = view_count + 1
   WHERE slug = p_slug
     AND revoked_at IS NULL
$$;

COMMENT ON FUNCTION app.record_share_view IS
  'Increments a live share''s view counter. The slug is the capability; a revoked '
  'slug matches nothing, so revocation still needs no application-side predicate.';

REVOKE ALL ON FUNCTION app.record_share_view(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_share_view(text) TO globetrotter_app;

-- ── 2. the audit trail ──────────────────────────────────────────────────────
-- #20 asks for an audit row per visibility transition. Rather than a bare log
-- table, this is HASH-CHAINED: each row's hash covers the previous row's hash,
-- so removing or editing any event breaks every hash after it.
--
-- Why bother in a hackathon: a plain audit table proves nothing — whoever can
-- write the rows can rewrite them. A chain makes tampering *detectable* without
-- trusting the writer, and app.verify_trip_chain() turns that into a single
-- boolean we can show on screen. It is also the honest version of the
-- "tamper-evident log" idea rather than a claim on a slide.
CREATE TABLE trip_events (
  seq         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trip_id     uuid        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  actor_id    uuid        REFERENCES users(id) ON DELETE SET NULL,
  event_type  text        NOT NULL,
  payload     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  prev_hash   bytea,
  hash        bytea       NOT NULL,

  CONSTRAINT trip_events_type_shape CHECK (event_type ~ '^[a-z]+(\.[a-z_]+)+$'),
  CONSTRAINT trip_events_payload_obj CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX trip_events_trip_idx ON trip_events (trip_id, seq);

COMMENT ON TABLE trip_events IS
  'Append-only, hash-chained. Editing or deleting any row invalidates every hash after it.';
COMMENT ON COLUMN trip_events.hash IS
  'sha256(prev_hash || trip_id || event_type || payload || occurred_at)';

-- The chain is computed in a BEFORE trigger, not by the caller. If the API
-- supplied the hash, the API could forge it.
CREATE FUNCTION app.chain_trip_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE v_prev bytea;
BEGIN
  SELECT e.hash INTO v_prev
    FROM trip_events e
   WHERE e.trip_id = NEW.trip_id
   ORDER BY e.seq DESC
   LIMIT 1;

  NEW.prev_hash := v_prev;
  NEW.hash := sha256(
      coalesce(v_prev, ''::bytea)
   || NEW.trip_id::text::bytea
   || NEW.event_type::bytea
   || NEW.payload::text::bytea
   || NEW.occurred_at::text::bytea
  );
  RETURN NEW;
END
$$;

-- A trigger function fires in the table owner's context and needs no EXECUTE
-- grant, so revoking is free. Caught by the 008 assertion that no SECURITY
-- DEFINER function in schema app is executable by PUBLIC — which is exactly
-- what that test is for.
REVOKE ALL ON FUNCTION app.chain_trip_event() FROM PUBLIC;

CREATE TRIGGER trip_events_chain
  BEFORE INSERT ON trip_events
  FOR EACH ROW EXECUTE FUNCTION app.chain_trip_event();

-- Append-only is enforced, not merely intended. Without this, "append-only" is
-- a naming convention.
--
-- UPDATE ONLY, deliberately. The first version guarded DELETE too, and that made
-- trips UNDELETABLE: trip_id is ON DELETE CASCADE, the cascade fires this
-- trigger on each child row, and the whole delete aborts. Verified.
--
-- The distinction is principled rather than a climbdown. Rewriting one event to
-- say something it never said is tampering, and is refused. Deleting a trip
-- removes the subject the events are about — that is erasure, not falsification,
-- and a user deleting their own trip should not leave its history behind.
--
-- Deleting an INDIVIDUAL event while keeping its trip is the dangerous case, and
-- that is blocked by RLS: trip_events has a SELECT policy and no DELETE policy,
-- so globetrotter_app cannot remove a row at all. Asserted in the tests.
CREATE FUNCTION app.reject_trip_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trip_events is append-only (attempted %)', TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;

CREATE TRIGGER trip_events_no_update
  BEFORE UPDATE ON trip_events
  FOR EACH ROW EXECUTE FUNCTION app.reject_trip_event_mutation();

-- The API appends through this, never by INSERTing directly: an event must be
-- recordable while the caller is anonymous (a share view) or mid-transition.
CREATE FUNCTION app.append_trip_event(
  p_trip       uuid,
  p_event_type text,
  p_payload    jsonb DEFAULT '{}'::jsonb
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE v_seq bigint;
BEGIN
  INSERT INTO trip_events (trip_id, actor_id, event_type, payload)
  VALUES (p_trip, app.current_user_id(), p_event_type, coalesce(p_payload, '{}'::jsonb))
  RETURNING seq INTO v_seq;
  RETURN v_seq;
END
$$;

REVOKE ALL ON FUNCTION app.append_trip_event(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.append_trip_event(uuid, text, jsonb) TO globetrotter_app;

-- Recomputes the whole chain and reports the first seq that does not match.
-- Returns NULL for intact. This is the demo asset: tamper with a row, run this,
-- and it names the exact event that was altered.
CREATE FUNCTION app.verify_trip_chain(p_trip uuid) RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE
  r        record;
  v_prev   bytea := NULL;
  v_expect bytea;
BEGIN
  FOR r IN SELECT * FROM trip_events WHERE trip_id = p_trip ORDER BY seq LOOP
    v_expect := sha256(
        coalesce(v_prev, ''::bytea)
     || r.trip_id::text::bytea
     || r.event_type::bytea
     || r.payload::text::bytea
     || r.occurred_at::text::bytea
    );
    IF r.hash IS DISTINCT FROM v_expect OR r.prev_hash IS DISTINCT FROM v_prev THEN
      RETURN r.seq;
    END IF;
    v_prev := r.hash;
  END LOOP;
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION app.verify_trip_chain IS
  'Returns the seq of the first tampered event, or NULL if the chain is intact.';

REVOKE ALL ON FUNCTION app.verify_trip_chain(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.verify_trip_chain(uuid) TO globetrotter_app;

ALTER TABLE trip_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_events FORCE  ROW LEVEL SECURITY;

-- Readable by anyone who can read the trip; writable only through the function
-- above, which is why there is no INSERT policy here.
CREATE POLICY trip_events_read ON trip_events FOR SELECT
  USING (app.can_read_trip(trip_id));

GRANT SELECT ON trip_events TO globetrotter_app;
