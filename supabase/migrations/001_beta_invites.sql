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
  ('BETA-001', '5a50f1d66be34adbc8781191a16a6e2a595a8fc42946982ab40ba4669c73f1bb', false),
  ('BETA-002', 'f3dd25e1d32a33511a03e06664fb814065be7e28c12289155b3a84acb7eeea73', false),
  ('BETA-003', 'e51a5cee6392e14cf146155db8cb6a9cd7c75a6deaa6f5c3fa9fa888fd3e41f0', false),
  ('BETA-004', '78ba7000a7754735a3ba14b3d8f15fc0a7019066dc8e5ff508d47eafb3e786af', false),
  ('BETA-005', 'b420d7864c1c9824b7cdc882f593e4beff9d3b93f9a0e423b399b4f4dd5241a0', false),
  ('BETA-006', '7f64af0e2b4ef634540ea117e3c0f327618d795ed36072a11c243be6c3ffda65', false),
  ('BETA-007', '5c124be4c7508cf7df3c8f1e717df56f6a7e65edb1cd876d848e50f72357849e', false),
  ('BETA-008', '9784b7beca2f6b08cba16e46ae2724f2112a23f6ce41fd17c018d43213142505', false),
  ('BETA-009', 'aa6c70141471b99b6373e43deee9f785df040b07600211a28fa0890ee6eeee0b', false),
  ('BETA-010', 'bb3fb1ca2ee83867169b2d05a3fc7cf1e3fcd1114f05a9f10cd3c9ce31349ee9', false),
  ('BETA-011', 'f4f091a6b15eba9bf0095bfa474117e19cb6926119f5293a971ab1dff0ee728b', false),
  ('BETA-012', 'ce7257a515a77bd6371dfc248b0540b5379101af7bf3f315d8a4c4f8f6486e47', false),
  ('BETA-013', '7f376900cb9eb5852ea7aa5b90b54791757a8c3cce9273f20e26322ca80f9c84', false),
  ('BETA-014', '01701554d1359f707612eb3b1450b59d783b8009eba5e74b277c815b560646fa', false),
  ('BETA-015', 'e3a8f7228075743174bc761d5bc7b709eab291b9129f74582494036ee4f0c49a', false),
  ('BETA-016', '46716fe83d8bdf8aabebcf7e39be7ee77e0daf15b33a9a014152cfe2ea040725', false),
  ('BETA-017', 'c0a151947ad79bcbada7cdfa96e88c8b9df43e9ac54d49585bdeee04b59d2865', false),
  ('BETA-018', 'd683aae44dcbc4fa20664b4ec0545f4f14d72758f73831c53e9c708a4c2e91ff', false),
  ('BETA-019', '955e9c49cce65dd35c94f5ca72cb505e3f1c8ffd208987f42046c4b5fbeb313d', false),
  ('BETA-020', '38cb2009afb8c25159a17f920257cf6bd52b3324c0e9a29730aa4bd951204d0f', false),
  ('BETA-021', '80e236b206ca2cb029cc300cace0fa4b91a8bca0807171d7bf8eebb526e59dfc', false),
  ('BETA-022', '24fd08942a35c98a1e538539ff98d91631c84d0d0d6587364706c8d9fe56680b', false),
  ('BETA-023', 'b0aba8e8a981c1c7683cb4156674d1560cb7f23783ac4f6d095683b4219ddf36', false),
  ('BETA-024', '904581294dcc0d855d04d289c7d0c1950c96146a570ef63738bd20029abf78a6', false),
  ('BETA-025', '631cf47175e131ddcb3af48383ffbf2824e262bce869e3012337102b4d34ba23', false),
  ('OWNER',    'fb8824971a848e16922eb80b74bfefeb30bb65a528555ef9a531ba75c3c41ace', true);

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

REVOKE ALL ON FUNCTION public.redeem_beta_invite(text, uuid) FROM PUBLIC;
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

REVOKE ALL ON FUNCTION public.complete_beta_journey(uuid) FROM PUBLIC;
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

REVOKE ALL ON FUNCTION public.get_beta_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_beta_access(uuid) TO service_role;
