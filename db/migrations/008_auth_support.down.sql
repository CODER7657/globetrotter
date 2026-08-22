DROP POLICY IF EXISTS rtf_delete ON refresh_token_families;
DROP POLICY IF EXISTS rtf_update ON refresh_token_families;
DROP POLICY IF EXISTS rtf_insert ON refresh_token_families;
DROP POLICY IF EXISTS rtf_read   ON refresh_token_families;
CREATE POLICY rtf_owner ON refresh_token_families FOR ALL
  USING (user_id = app.current_user_id() OR app.is_admin())
  WITH CHECK (user_id = app.current_user_id());
DROP FUNCTION IF EXISTS app.auth_find_refresh_token(bytea);
DROP FUNCTION IF EXISTS app.auth_find_user_by_email(citext);
