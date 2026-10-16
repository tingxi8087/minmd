CREATE TABLE "file_transfer_imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"target_file_id" uuid,
	"file_ids" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file_transfer_imports" ADD CONSTRAINT "file_transfer_imports_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_transfer_imports" ADD CONSTRAINT "file_transfer_imports_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_transfer_imports" ADD CONSTRAINT "file_transfer_imports_target_file_id_files_id_fk" FOREIGN KEY ("target_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
COMMENT ON TABLE "file_transfer_imports" IS '成功文件导入的身份限定幂等结果，不保存压缩包或正文';
--> statement-breakpoint
COMMENT ON COLUMN "file_transfer_imports"."file_ids" IS '本批次新建或替换的文件标识';
--> statement-breakpoint
COMMENT ON COLUMN "file_transfer_imports"."target_file_id" IS '单文档替换目标，批量新建时为空';
--> statement-breakpoint
COMMENT ON COLUMN "file_transfer_imports"."imported_at" IS '实际导入时间，与源文件业务时间分开';
