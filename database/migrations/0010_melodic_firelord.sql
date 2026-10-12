ALTER TABLE "assets" ADD COLUMN "uploaded_for_file_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_uploaded_for_file_id_files_id_fk" FOREIGN KEY ("uploaded_for_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
COMMENT ON COLUMN "assets"."uploaded_for_file_id" IS '上传时绑定的编辑目标，用于临时附件授权，不授予匿名访问';
