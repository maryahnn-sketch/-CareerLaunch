-- ============================================================
-- iFindWorth private beta — invite + redemption schema
-- Run in Supabase SQL Editor (staging first, then prod)
--
-- Anonymous beta access is tied to the Supabase anonymous user/session in each
-- browser. Single-use codes bind to that user id; another browser cannot reuse
-- the same redemption in this phase (no cross-browser recovery).
--
-- revoked_at revokes existing access (including OWNER). expires_at applies only
-- to the redemption window — testers who already redeemed keep access after expiry.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------
-- Tables
-- ------------------------------------------------------------

CREATE TABLE public.beta_invites (
  id            text PRIMARY KEY,
  code_hash     text NOT NULL UNIQUE,
  reusable      boolean NOT NULL DEFAULT false,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  redeemed_at   timestamptz,
  redeemed_by   uuid REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT beta_invites_reusable_owner_chk CHECK (
    (id = 'OWNER' AND reusable = true)
    OR (id <> 'OWNER' AND reusable = false)
  )
);

CREATE TABLE public.beta_redemptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id     text NOT NULL REFERENCES public.beta_invites(id),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status        text NOT NULL CHECK (status IN ('in_progress', 'completed')),
  granted_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT beta_redemptions_one_per_user UNIQUE (user_id)
);

CREATE INDEX beta_redemptions_invite_id_idx ON public.beta_redemptions (invite_id);
CREATE INDEX beta_invites_unredeemed_idx
  ON public.beta_invites (id)
  WHERE reusable = false AND redeemed_at IS NULL;

-- ------------------------------------------------------------
-- Seed invites (hashes from api/beta-access.mjs @ 4c23f9c)
-- ------------------------------------------------------------

INSERT INTO public.beta_invites (id, code_hash, reusable) VALUES
  ('BETA-001', 'dd8f9bfc318026a9c6796a8a16ff68a51020cc0be6cbb5ce2918d2f8557eb5ee', false),
  ('BETA-002', '538d289e6f053e25c56a35d00a48298f80faa402acab8d96d06c96f32f649f1c', false),
  ('BETA-003', 'bff1b730a3531f1c5ddd350a3498360d85723316208dce383b897f0b60306605', false),
  ('BETA-004', 'e4f4d7aee57b5905838672cdc4b76191985e92b402035d8e729e5a81a72d6c09', false),
  ('BETA-005', 'd439740ec9f8f4066ef5d77241cf159ed9af84844c96a7c1466a52940e4ef7c7', false),
  ('BETA-006', '1e1513bd7584b4116867244d823235d69c83be420e1c53bf472305c1d42f847b', false),
  ('BETA-007', 'f5444c0693337015d0d4c29e20be61f5fbc19eade795b1a1aff24789c7e3ad02', false),
  ('BETA-008', '8b45e48870b417b9f9d70100c0dc65fc0da054be5520555b7b78cce34a01f5f7', false),
  ('BETA-009', '7e2857c7567f1a70849859aff6c52cc7d66a549d29e3bd69dad32da5b77f641c', false),
  ('BETA-010', 'a0419a443aaa7a2d0392a2d634d9ed48a2e73f8d477f6d39283745db1bfe709d', false),
  ('BETA-011', '3ad76c48bbf5a93730e46da849d24f547468c9ace4f91f563a7668ee452d5aba', false),
  ('BETA-012', 'e1619ce67e0d2e56dc4b6b370108c057e8fb2d9ef82b52de60844385bf9f5ebd', false),
  ('BETA-013', '484ab57215980868903457b914852cbc27f5f8b621433d7a40f5579013478c99', false),
  ('BETA-014', '38f5c8e71bcde67b168479b2fac2ae8648da8cd0aca091c6247e47133f84ed2d', false),
  ('BETA-015', 'b8deacfe66e8dd7a97f016ac206588cedc725236fd0c4f6f7fdddd7defc7bdba', false),
  ('BETA-016', 'f04540358d7a40e2a462795389aea46a0cfcaf8172172fde1eb0be10bb7f112a', false),
  ('BETA-017', 'aa1de3dd2207bf0e96164f2f7cfc5fba21432358d106cb3b766a6f19539f24be', false),
  ('BETA-018', '7dd49e06c73bceec8292bc8552f6dd5cd377231d027f72dd2bd162f491640b5d', false),
  ('BETA-019', 'eaffdbd4f440f0370dfeb634fc288194312d2f34450f588b1e389232c3ae18aa', false),
  ('BETA-020', '7853c36c6b37f197bbe65cc50d835f87460a231d2d18ab5450e6fda22245f6aa', false),
  ('BETA-021', 'e571a3cc2c7e603e161f5fbfeef2d6e31723b3c42a8a82110af90c29e4f62533', false),
  ('BETA-022', 'f3bfe940020bada83e6649ec7d561e1627329aabc52e7925ae780f7bec214171', false),
  ('BETA-023', 'b0605d3052adf8a20900892979cf4eb1110b9559ae48d67b55c714071dbc49b1', false),
  ('BETA-024', '2f5a7489097e8d01cea1d37eea8bc4f090e14f21bcf3ddbfba372aa90079e100', false),
  ('BETA-025', '81b58d390d7655683e50a723b01e3aebf7c7fbaaa5fcfd9a7de7b61b53b41ba1', false),
  ('OWNER',    '6a91a67cbb8d4b224f78ba9219b677c022da567593aa47d562cbb05e373441df', true);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------

ALTER TABLE public.beta_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beta_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY beta_redemptions_select_own
  ON public.beta_redemptions
  FOR SELECT
  TO authenticated, anon
  USING (auth.uid() = user_id);

-- ------------------------------------------------------------
-- RPC: redeem invite (atomic single-use)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.redeem_beta_invite(
  p_code_hash text,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite public.beta_invites%ROWTYPE;
  v_existing public.beta_redemptions%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR p_code_hash IS NULL OR length(p_code_hash) <> 64 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid');
  END IF;

  SELECT * INTO v_existing
  FROM public.beta_redemptions
  WHERE user_id = p_user_id;

  IF FOUND THEN
    SELECT * INTO v_invite FROM public.beta_invites WHERE id = v_existing.invite_id;
    IF v_invite.revoked_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'revoked', 'invite_id', v_invite.id);
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'invite_id', v_invite.id,
      'reusable', v_invite.reusable,
      'status', v_existing.status,
      'granted_at', v_existing.granted_at,
      'completed_at', v_existing.completed_at,
      'already_assigned', true
    );
  END IF;

  SELECT * INTO v_invite
  FROM public.beta_invites
  WHERE code_hash = p_code_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid');
  END IF;

  IF v_invite.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'revoked');
  END IF;

  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'expired');
  END IF;

  IF NOT v_invite.reusable THEN
    IF v_invite.redeemed_at IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error_code', 'already_redeemed',
        'invite_id', v_invite.id
      );
    END IF;

    UPDATE public.beta_invites
    SET redeemed_at = now(),
        redeemed_by = p_user_id
    WHERE id = v_invite.id
      AND redeemed_at IS NULL;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error_code', 'already_redeemed',
        'invite_id', v_invite.id
      );
    END IF;
  END IF;

  INSERT INTO public.beta_redemptions (invite_id, user_id, status)
  VALUES (v_invite.id, p_user_id, 'in_progress');

  RETURN jsonb_build_object(
    'ok', true,
    'invite_id', v_invite.id,
    'reusable', v_invite.reusable,
    'status', 'in_progress',
    'granted_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_beta_invite(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_beta_invite(text, uuid) TO service_role;

-- ------------------------------------------------------------
-- RPC: complete journey
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_beta_journey(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.beta_redemptions%ROWTYPE;
  v_invite public.beta_invites%ROWTYPE;
BEGIN
  SELECT r.* INTO v_row
  FROM public.beta_redemptions r
  WHERE r.user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'no_access');
  END IF;

  SELECT * INTO v_invite FROM public.beta_invites WHERE id = v_row.invite_id;

  IF v_invite.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'revoked', 'invite_id', v_invite.id);
  END IF;

  IF v_invite.reusable THEN
    RETURN jsonb_build_object(
      'ok', true,
      'invite_id', v_invite.id,
      'reusable', true,
      'status', v_row.status,
      'skipped', true
    );
  END IF;

  IF v_row.status = 'completed' THEN
    RETURN jsonb_build_object('ok', true, 'status', 'completed', 'already_completed', true);
  END IF;

  UPDATE public.beta_redemptions
  SET status = 'completed',
      completed_at = now(),
      updated_at = now()
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object('ok', true, 'status', 'completed');
END;
$$;

REVOKE ALL ON FUNCTION public.complete_beta_journey(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_beta_journey(uuid) TO service_role;

-- ------------------------------------------------------------
-- RPC: read access (status hydration)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_beta_access(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_build_object(
        'has_access', true,
        'invite_id', i.id,
        'reusable', i.reusable,
        'status', r.status,
        'granted_at', r.granted_at,
        'completed_at', r.completed_at
      )
      FROM public.beta_redemptions r
      JOIN public.beta_invites i ON i.id = r.invite_id
      WHERE r.user_id = p_user_id
        AND i.revoked_at IS NULL
    ),
    jsonb_build_object('has_access', false)
  );
$$;

REVOKE ALL ON FUNCTION public.get_beta_access(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_beta_access(uuid) TO service_role;
