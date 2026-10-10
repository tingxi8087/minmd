CREATE TABLE "example_book" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(100) NOT NULL,
	"author" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "examples";
--> statement-breakpoint
COMMENT ON TABLE "example_book" IS '图书示例';
--> statement-breakpoint
COMMENT ON COLUMN "example_book"."title" IS '书名';
--> statement-breakpoint
COMMENT ON COLUMN "example_book"."author" IS '作者';
