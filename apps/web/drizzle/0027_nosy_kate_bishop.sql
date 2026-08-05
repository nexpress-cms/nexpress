CREATE TABLE "np_c_shop-promotions__categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_promotions_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "np_c_shop-promotions__products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_promotions_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "np_c_shop-promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"visibility" text DEFAULT 'public' NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"automatic" boolean DEFAULT false NOT NULL,
	"kind" text DEFAULT 'fixed' NOT NULL,
	"currency" text DEFAULT 'KRW' NOT NULL,
	"value" integer DEFAULT 1 NOT NULL,
	"maximum_discount_minor" integer,
	"minimum_subtotal_minor" integer DEFAULT 0 NOT NULL,
	"target" text DEFAULT 'order' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"priority" integer DEFAULT 0 NOT NULL,
	"stackable" boolean DEFAULT false NOT NULL,
	"total_usage_limit" integer DEFAULT 0 NOT NULL,
	"per_owner_usage_limit" integer DEFAULT 0 NOT NULL,
	"site_id" text DEFAULT 'default' NOT NULL,
	"published_at" timestamp with time zone,
	"search_vector" "tsvector"
);
--> statement-breakpoint
ALTER TABLE "np_c_shop-promotions__categories" ADD CONSTRAINT "np_c_shop-promotions__categories_shop_promotions_id_np_c_shop-promotions_id_fk" FOREIGN KEY ("shop_promotions_id") REFERENCES "public"."np_c_shop-promotions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_shop-promotions__categories" ADD CONSTRAINT "np_c_shop-promotions__categories_target_id_np_c_shop-categories_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."np_c_shop-categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_shop-promotions__products" ADD CONSTRAINT "np_c_shop-promotions__products_shop_promotions_id_np_c_shop-promotions_id_fk" FOREIGN KEY ("shop_promotions_id") REFERENCES "public"."np_c_shop-promotions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_shop-promotions__products" ADD CONSTRAINT "np_c_shop-promotions__products_target_id_np_c_shop-products_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."np_c_shop-products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_shop-promotions" ADD CONSTRAINT "np_c_shop-promotions_created_by_np_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_shop-promotions" ADD CONSTRAINT "np_c_shop-promotions_updated_by_np_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "np_c_shop-promotions__categories_shop_promotions_id_idx" ON "np_c_shop-promotions__categories" USING btree ("shop_promotions_id");--> statement-breakpoint
CREATE UNIQUE INDEX "np_c_shop-promotions__categories_parent_target_uidx" ON "np_c_shop-promotions__categories" USING btree ("shop_promotions_id","target_id");--> statement-breakpoint
CREATE INDEX "np_c_shop-promotions__products_shop_promotions_id_idx" ON "np_c_shop-promotions__products" USING btree ("shop_promotions_id");--> statement-breakpoint
CREATE UNIQUE INDEX "np_c_shop-promotions__products_parent_target_uidx" ON "np_c_shop-promotions__products" USING btree ("shop_promotions_id","target_id");--> statement-breakpoint
CREATE INDEX "np_c_shop-promotions_status_idx" ON "np_c_shop-promotions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "np_c_shop-promotions_site_code_uidx" ON "np_c_shop-promotions" USING btree ("site_id","code");--> statement-breakpoint
CREATE INDEX "np_c_shop-promotions_site_idx" ON "np_c_shop-promotions" USING btree ("site_id");