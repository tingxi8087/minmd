ALTER TABLE "api_keys" ADD COLUMN "encrypted_secret" varchar(512);--> statement-breakpoint
COMMENT ON COLUMN "api_keys"."encrypted_secret" IS 'AES-256-GCM加密密钥原文；旧密钥为空，哈希仍用于认证';
--> statement-breakpoint
UPDATE api_keys k SET permissions = COALESCE((
  SELECT jsonb_agg(item.value ORDER BY item.position)
  FROM jsonb_array_elements(k.permissions) WITH ORDINALITY AS item(value, position)
  JOIN space_ai_policies p ON p.space_id = k.space_id AND p.enabled = true
  WHERE p.permissions @> jsonb_build_array(item.value)
), '[]'::jsonb);
--> statement-breakpoint
UPDATE api_keys SET revoked_at = COALESCE(revoked_at, now()) WHERE permissions = '[]'::jsonb;
