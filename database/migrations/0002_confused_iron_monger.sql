ALTER TABLE "file_transfer_imports" ADD COLUMN "request_fingerprint" varchar(64);--> statement-breakpoint
COMMENT ON COLUMN "file_transfer_imports"."request_fingerprint" IS '复制请求身份、空间、目标与源文件参数摘要，阻止幂等编号复用于不同请求';
